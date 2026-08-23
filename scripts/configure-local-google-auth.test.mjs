import assert from "node:assert/strict";
import test from "node:test";
import { configureGoogleAuthEnv } from "./configure-local-google-auth.mjs";

test("configures Google auth and a single normalized email", () => {
  const configured = configureGoogleAuthEnv(
    "OIDC_ISSUER_URL=http://localhost:5556\nAUTH_PROVIDER=oidc\nNEXT_PUBLIC_AUTH_PROVIDER=oidc\n",
    {
      clientId: "123-example.apps.googleusercontent.com",
      email: "Tiret.Rouge@Gmail.com",
    },
  );
  assert.match(
    configured,
    /^OIDC_ISSUER_URL=https:\/\/accounts\.google\.com$/m,
  );
  assert.match(
    configured,
    /^OIDC_AUDIENCE=123-example\.apps\.googleusercontent\.com$/m,
  );
  assert.match(configured, /^AUTH_PROVIDER=google$/m);
  assert.match(configured, /^AUTH_ALLOWED_EMAILS=tiret\.rouge@gmail\.com$/m);
  assert.match(configured, /^NEXT_PUBLIC_AUTH_PROVIDER=google$/m);
  assert.match(
    configured,
    /^NEXT_PUBLIC_GOOGLE_CLIENT_ID=123-example\.apps\.googleusercontent\.com$/m,
  );
});

test("rejects invalid client ids and email addresses", () => {
  assert.throws(() =>
    configureGoogleAuthEnv("", {
      clientId: "not-a-google-client",
      email: "tiret.rouge@gmail.com",
    }),
  );
  assert.throws(() =>
    configureGoogleAuthEnv("", {
      clientId: "123-example.apps.googleusercontent.com",
      email: "not-an-email",
    }),
  );
});
