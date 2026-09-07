import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateAwsSmokeConfig,
  validateAwsSmokeEndpoint,
} from "./validate-aws-smoke-config.mjs";

describe("validateAwsSmokeEndpoint", () => {
  it("normalizes a public HTTPS endpoint", () => {
    assert.equal(
      validateAwsSmokeEndpoint("https://example.com/api", "ENDPOINT"),
      "https://example.com/api",
    );
  });

  it("rejects missing, malformed, insecure, credentialed, and local endpoints", () => {
    const invalidValues = [
      undefined,
      "not-a-url",
      "http://example.com",
      "https://user:password@example.com",
      "https://localhost/api",
      "https://127.0.0.1/api",
      "https://10.0.0.1/api",
      "https://192.168.1.10/api",
      "https://100.64.0.1/api",
      "https://[::1]/api",
      "https://[fc00::1]/api",
      "https://[fe80::1]/api",
      " https://example.com/api",
      "https://example.com/api\n",
    ];

    for (const value of invalidValues) {
      assert.throws(() => validateAwsSmokeEndpoint(value, "ENDPOINT"));
    }
  });
});

describe("validateAwsSmokeConfig", () => {
  it("returns both configured endpoints", () => {
    assert.deepEqual(
      validateAwsSmokeConfig({
        AWS_SMOKE_FUNCTION_URL: "https://function.example.com/",
        AWS_SMOKE_GATEWAY_URL: "https://gateway.example.com/v1",
      }),
      {
        function_url: "https://function.example.com/",
        gateway_url: "https://gateway.example.com/v1",
      },
    );
  });

  it("reports every missing endpoint in one actionable error", () => {
    assert.throws(
      () => validateAwsSmokeConfig({}),
      (error) =>
        error instanceof AggregateError &&
        error.message.includes("AWS_SMOKE_FUNCTION_URL") &&
        error.message.includes("AWS_SMOKE_GATEWAY_URL"),
    );
  });
});
