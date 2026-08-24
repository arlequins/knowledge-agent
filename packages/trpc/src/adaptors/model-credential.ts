import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Database } from "@arlequins/db-backbone/client";
import { ModelCredential } from "@arlequins/db-backbone/schema";
import { and, eq } from "drizzle-orm";

export type PersonalModelProvider = "gemini" | "openai";

export type ModelCredentialMetadata = {
  modelId: string;
  provider: PersonalModelProvider;
  updatedAt: Date;
};

function keyBytes(encodedKey: string | undefined) {
  if (!encodedKey)
    throw new Error("Model credential encryption is not configured");
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32)
    throw new Error("Model credential encryption key must be 32 bytes");
  return key;
}

function additionalData(userId: string, provider: PersonalModelProvider) {
  return Buffer.from(`model-credential:v1:${userId}:${provider}`, "utf8");
}

export function encryptModelCredential(
  apiKey: string,
  encodedKey: string,
  userId: string,
  provider: PersonalModelProvider,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(encodedKey), iv);
  cipher.setAAD(additionalData(userId, provider));
  const encrypted = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptModelCredential(
  value: string,
  encodedKey: string,
  userId: string,
  provider: PersonalModelProvider,
) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue)
    throw new Error("Stored model credential is invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBytes(encodedKey),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAAD(additionalData(userId, provider));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createModelCredentialRepository(
  database: Database,
  encryptionKey?: string,
) {
  return {
    async delete(userId: string, provider: PersonalModelProvider) {
      await database
        .delete(ModelCredential)
        .where(
          and(
            eq(ModelCredential.userId, userId),
            eq(ModelCredential.provider, provider),
          ),
        );
    },
    async get(userId: string, provider: PersonalModelProvider) {
      const [credential] = await database
        .select({
          encryptedSecret: ModelCredential.encryptedSecret,
          modelId: ModelCredential.modelId,
        })
        .from(ModelCredential)
        .where(
          and(
            eq(ModelCredential.userId, userId),
            eq(ModelCredential.provider, provider),
          ),
        )
        .limit(1);
      if (!credential) return undefined;
      return {
        apiKey: decryptModelCredential(
          credential.encryptedSecret,
          encryptionKey ?? "",
          userId,
          provider,
        ),
        modelId: credential.modelId,
        provider,
      };
    },
    async list(userId: string): Promise<ModelCredentialMetadata[]> {
      const credentials = await database
        .select({
          modelId: ModelCredential.modelId,
          provider: ModelCredential.provider,
          updatedAt: ModelCredential.updatedAt,
        })
        .from(ModelCredential)
        .where(eq(ModelCredential.userId, userId));
      return credentials
        .filter(
          (credential): credential is ModelCredentialMetadata =>
            credential.provider === "gemini" ||
            credential.provider === "openai",
        )
        .map((credential) => ({
          modelId: credential.modelId,
          provider: credential.provider,
          updatedAt: credential.updatedAt,
        }));
    },
    async save(
      userId: string,
      input: {
        apiKey?: string;
        modelId: string;
        provider: PersonalModelProvider;
      },
    ): Promise<ModelCredentialMetadata> {
      const now = new Date();
      let encryptedSecret: string;
      if (input.apiKey) {
        encryptedSecret = encryptModelCredential(
          input.apiKey,
          encryptionKey ?? "",
          userId,
          input.provider,
        );
      } else {
        const [existing] = await database
          .select({ encryptedSecret: ModelCredential.encryptedSecret })
          .from(ModelCredential)
          .where(
            and(
              eq(ModelCredential.userId, userId),
              eq(ModelCredential.provider, input.provider),
            ),
          )
          .limit(1);
        if (!existing)
          throw new Error("An API key is required for a new model credential");
        encryptedSecret = existing.encryptedSecret;
      }
      const [credential] = await database
        .insert(ModelCredential)
        .values({
          encryptedSecret,
          modelId: input.modelId,
          provider: input.provider,
          updatedAt: now,
          userId,
        })
        .onConflictDoUpdate({
          set: {
            encryptedSecret,
            modelId: input.modelId,
            updatedAt: now,
          },
          target: [ModelCredential.userId, ModelCredential.provider],
        })
        .returning({
          modelId: ModelCredential.modelId,
          provider: ModelCredential.provider,
          updatedAt: ModelCredential.updatedAt,
        });
      if (
        !credential ||
        (credential.provider !== "gemini" && credential.provider !== "openai")
      )
        throw new Error("Model credential could not be saved");
      return {
        modelId: credential.modelId,
        provider: credential.provider,
        updatedAt: credential.updatedAt,
      };
    },
  };
}

export type ModelCredentialRepository = ReturnType<
  typeof createModelCredentialRepository
>;
