import type { AuthUser } from "./context";

type GoogleTokenClaims = {
  email?: string;
  exp?: number;
  name?: string;
  sub?: string;
};

function decodeGoogleClaims(credential: string): GoogleTokenClaims | null {
  const payload = credential.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as GoogleTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Reads display and expiry data from Google's credential without trusting it.
 * The API remains the security boundary and verifies the token signature and claims.
 */
export function authUserFromGoogleCredential(
  credential: string,
  now = Date.now(),
): AuthUser | null {
  const claims = decodeGoogleClaims(credential);
  if (!claims?.sub || !claims.exp || claims.exp * 1_000 <= now) return null;
  return {
    access_token: credential,
    expired: false,
    profile: {
      sub: claims.sub,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.name ? { name: claims.name } : {}),
    },
  };
}
