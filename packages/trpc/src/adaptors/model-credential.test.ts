import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  decryptModelCredential,
  encryptModelCredential,
} from "./model-credential";

describe("model credential encryption", () => {
  const encryptionKey = randomBytes(32).toString("base64");

  it("round-trips a credential without storing the plaintext", () => {
    const encrypted = encryptModelCredential(
      "provider-secret",
      encryptionKey,
      "11111111-1111-4111-8111-111111111111",
      "gemini",
    );

    expect(encrypted).not.toContain("provider-secret");
    expect(
      decryptModelCredential(
        encrypted,
        encryptionKey,
        "11111111-1111-4111-8111-111111111111",
        "gemini",
      ),
    ).toBe("provider-secret");
  });

  it("binds the ciphertext to the user and provider", () => {
    const encrypted = encryptModelCredential(
      "provider-secret",
      encryptionKey,
      "11111111-1111-4111-8111-111111111111",
      "gemini",
    );

    expect(() =>
      decryptModelCredential(
        encrypted,
        encryptionKey,
        "22222222-2222-4222-8222-222222222222",
        "gemini",
      ),
    ).toThrow();
    expect(() =>
      decryptModelCredential(
        encrypted,
        encryptionKey,
        "11111111-1111-4111-8111-111111111111",
        "openai",
      ),
    ).toThrow();
  });
});
