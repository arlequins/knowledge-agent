import { serverEnv } from "@arlequins/env/server-env";
import { errors } from "jose";
import type { AuthSession, OidcClaims } from "../../domain/session";
import type { AccessTokenVerifier } from "./verifier";
import { verifyConfiguredAccessToken } from "./verifier";

export type TRPCAuth = {
  getSession: (opts: { headers: Headers }) => Promise<AuthSession | null>;
};

export function parseBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

function isRejectedToken(error: unknown): boolean {
  if (!(error instanceof errors.JOSEError)) return false;
  return new Set([
    "ERR_JWT_EXPIRED",
    "ERR_JWT_CLAIM_VALIDATION_FAILED",
    "ERR_JWT_INVALID",
    "ERR_JWS_INVALID",
    "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    "ERR_JWKS_NO_MATCHING_KEY",
    "ERR_JOSE_ALG_NOT_ALLOWED",
  ]).has(error.code);
}

function stringClaim(claims: OidcClaims, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function createOidcAuth(
  verifyAccessToken: AccessTokenVerifier = verifyConfiguredAccessToken,
  options: { allowedEmails?: ReadonlySet<string> } = {},
): TRPCAuth {
  return {
    async getSession({ headers }) {
      const token = parseBearerToken(headers);
      if (!token) return null;
      let claims: OidcClaims;
      try {
        claims = await verifyAccessToken(token);
      } catch (error: unknown) {
        if (isRejectedToken(error)) return null;
        throw error;
      }
      if (typeof claims.sub !== "string" || claims.sub.length === 0)
        return null;
      const email = stringClaim(claims, "email");
      if (options.allowedEmails?.size) {
        if (
          !email ||
          claims.email_verified !== true ||
          !options.allowedEmails.has(email.trim().toLowerCase())
        )
          return null;
      }
      return {
        user: {
          id: claims.sub,
          issuer: claims.iss ?? "",
          subject: claims.sub,
          name:
            stringClaim(claims, "name") ??
            stringClaim(claims, "preferred_username"),
          email,
          roles: [],
        },
        claims,
      };
    },
  };
}

function configuredAllowedEmails(): ReadonlySet<string> {
  const allowedEmails = new Set(
    (serverEnv.AUTH_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  if (serverEnv.AUTH_PROVIDER === "google" && allowedEmails.size === 0) {
    throw new Error("Google authentication requires AUTH_ALLOWED_EMAILS");
  }
  return allowedEmails;
}

export const authApi = createOidcAuth(verifyConfiguredAccessToken, {
  allowedEmails: configuredAllowedEmails(),
});
