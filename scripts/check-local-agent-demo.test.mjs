import assert from "node:assert/strict";
import test from "node:test";

import {
  checkLocalAgentDemo,
  missingRequiredModels,
  parseOllamaModels,
} from "./check-local-agent-demo.mjs";

test("parses Ollama model names", () => {
  assert.deepEqual(
    parseOllamaModels(
      "NAME ID SIZE MODIFIED\nknowledge-agent-gemma3:12b abc 8.1 GB now\nnomic-embed-text def 274 MB now\n",
    ),
    ["knowledge-agent-gemma3:12b", "nomic-embed-text"],
  );
});

test("identifies a missing embedding model", () => {
  assert.deepEqual(missingRequiredModels(["knowledge-agent-gemma3:12b"]), [
    "nomic-embed-text",
  ]);
});

test("accepts Ollama's explicit latest tag for an untagged requirement", () => {
  assert.deepEqual(
    missingRequiredModels([
      "knowledge-agent-gemma3:12b",
      "nomic-embed-text:latest",
    ]),
    [],
  );
});

test("checks all required local models", () => {
  assert.deepEqual(
    checkLocalAgentDemo({
      execFile: () =>
        "NAME ID SIZE MODIFIED\nknowledge-agent-gemma3:12b abc 8.1 GB now\nnomic-embed-text def 274 MB now\n",
    }),
    { models: ["knowledge-agent-gemma3:12b", "nomic-embed-text"] },
  );
});
