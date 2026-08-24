CREATE TABLE "agent"."model_credential" (
  "user_id" uuid NOT NULL,
  "provider" varchar(32) NOT NULL,
  "model_id" varchar(96) NOT NULL,
  "encrypted_secret" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "model_credential_user_id_provider_pk" PRIMARY KEY("user_id", "provider")
);
