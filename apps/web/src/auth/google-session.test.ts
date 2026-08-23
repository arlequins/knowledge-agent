import { describe, expect, it } from "vitest";
import { authUserFromGoogleCredential } from "./google-session";

function credential(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("authUserFromGoogleCredential", () => {
  it("restores an unexpired Google session including UTF-8 profile data", () => {
    expect(
      authUserFromGoogleCredential(
        credential({
          email: "tiret.rouge@gmail.com",
          exp: 2_000,
          name: "테스트 사용자",
          sub: "google-subject",
        }),
        1_000_000,
      ),
    ).toMatchObject({
      expired: false,
      profile: {
        email: "tiret.rouge@gmail.com",
        name: "테스트 사용자",
        sub: "google-subject",
      },
    });
  });

  it("rejects expired and malformed credentials", () => {
    expect(
      authUserFromGoogleCredential(
        credential({ exp: 1_000, sub: "google-subject" }),
        1_000_000,
      ),
    ).toBeNull();
    expect(authUserFromGoogleCredential("not-a-jwt", 1_000_000)).toBeNull();
  });
});
