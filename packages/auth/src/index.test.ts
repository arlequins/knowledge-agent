import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  AppRole,
  hasPermission,
  Permission,
  provisionSessionUser,
} from "./authorization";
import type { OidcConfig } from "./index";
import {
  createJwtAccessTokenVerifier,
  createOidcAuth,
  parseBearerToken,
} from "./index";

const config: OidcConfig = {
  id: "primary",
  issuer: "https://idp.knowledge-agent.localhost",
  audience: ["example-api"],
  algorithms: ["RS256"],
};
const expectedAudience = "example-api";

async function signedAccessToken(
  overrides: {
    issuer?: string;
    audience?: string;
    subject?: string;
    expiration?: string | number;
    email?: string;
    emailVerified?: boolean;
  } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await new SignJWT({
    name: "Example User",
    email: overrides.email ?? "user@knowledge-agent.localhost",
    email_verified: overrides.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? config.issuer)
    .setAudience(overrides.audience ?? expectedAudience)
    .setSubject(overrides.subject ?? "user-123")
    .setIssuedAt()
    .setExpirationTime(overrides.expiration ?? "5m")
    .sign(privateKey);

  return { token, publicKey };
}

describe("parseBearerToken", () => {
  it("parses a case-insensitive Bearer scheme", () => {
    expect(
      parseBearerToken(new Headers({ Authorization: "bearer access-token" })),
    ).toBe("access-token");
  });

  it("rejects missing and malformed authorization headers", () => {
    expect(parseBearerToken(new Headers())).toBeNull();
    expect(
      parseBearerToken(new Headers({ Authorization: "Basic credentials" })),
    ).toBeNull();
    expect(
      parseBearerToken(new Headers({ Authorization: "Bearer one two" })),
    ).toBeNull();
  });
});

describe("OIDC access token verification", () => {
  it("validates signature, issuer, audience, expiry, and subject", async () => {
    const { token, publicKey } = await signedAccessToken();
    const verifier = createJwtAccessTokenVerifier(
      config,
      async () => publicKey,
    );

    await expect(verifier(token)).resolves.toMatchObject({
      sub: "user-123",
      iss: config.issuer,
      aud: expectedAudience,
    });
  });

  it("rejects a token for another audience", async () => {
    const { token, publicKey } = await signedAccessToken({
      audience: "another-api",
    });
    const verifier = createJwtAccessTokenVerifier(
      config,
      async () => publicKey,
    );
    const auth = createOidcAuth(verifier);

    await expect(
      auth.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      }),
    ).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const { token, publicKey } = await signedAccessToken({
      expiration: Math.floor(Date.now() / 1000) - 60,
    });
    const auth = createOidcAuth(
      createJwtAccessTokenVerifier(config, async () => publicKey),
    );
    await expect(
      auth.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      }),
    ).resolves.toBeNull();
  });

  it("maps validated OIDC claims to the application session", async () => {
    const { token, publicKey } = await signedAccessToken();
    const auth = createOidcAuth(
      createJwtAccessTokenVerifier(config, async () => publicKey),
    );

    await expect(
      auth.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      }),
    ).resolves.toMatchObject({
      user: {
        id: "user-123",
        name: "Example User",
        email: "user@knowledge-agent.localhost",
      },
    });
  });

  it("accepts only a cryptographically verified token for an allowed email", async () => {
    const allowedEmail = "owner@knowledge-agent.localhost";
    const { token, publicKey } = await signedAccessToken({
      email: allowedEmail.toUpperCase(),
    });
    const auth = createOidcAuth(
      createJwtAccessTokenVerifier(config, async () => publicKey),
      { allowedEmails: new Set([allowedEmail]) },
    );

    await expect(
      auth.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      }),
    ).resolves.toMatchObject({ user: { email: allowedEmail.toUpperCase() } });
  });

  it("rejects unverified or non-allowlisted email claims", async () => {
    const allowedEmails = new Set(["owner@knowledge-agent.localhost"]);
    const unverified = await signedAccessToken({
      email: "owner@knowledge-agent.localhost",
      emailVerified: false,
    });
    const other = await signedAccessToken({ email: "other@example.com" });

    await expect(
      createOidcAuth(
        createJwtAccessTokenVerifier(config, async () => unverified.publicKey),
        { allowedEmails },
      ).getSession({
        headers: new Headers({ Authorization: `Bearer ${unverified.token}` }),
      }),
    ).resolves.toBeNull();
    await expect(
      createOidcAuth(
        createJwtAccessTokenVerifier(config, async () => other.publicKey),
        { allowedEmails },
      ).getSession({
        headers: new Headers({ Authorization: `Bearer ${other.token}` }),
      }),
    ).resolves.toBeNull();
  });

  it("propagates provider availability failures", async () => {
    const auth = createOidcAuth(async () => {
      throw new Error("discovery unavailable");
    });

    await expect(
      auth.getSession({
        headers: new Headers({ Authorization: "Bearer token" }),
      }),
    ).rejects.toThrow("discovery unavailable");
  });
});

describe("application authorization", () => {
  it("provisions an internal user and evaluates role permissions", async () => {
    const session = await provisionSessionUser(
      {
        provision: async (input) => ({
          ...input,
          id: "internal-user-id",
          roles: [AppRole.VIEWER],
        }),
      },
      {
        user: {
          id: "subject-1",
          issuer: config.issuer,
          subject: "subject-1",
          name: "Example User",
          email: "user@knowledge-agent.localhost",
          roles: [],
        },
        claims: { sub: "subject-1", iss: config.issuer },
      },
    );

    expect(session.user.id).toBe("internal-user-id");
    expect(hasPermission(session.user.roles, Permission.POST_READ)).toBe(true);
    expect(hasPermission(session.user.roles, Permission.POST_WRITE)).toBe(
      false,
    );
  });
});
