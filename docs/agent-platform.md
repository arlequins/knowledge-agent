# Knowledge agent platform

This repository is a reusable foundation for evidence-grounded conversations
about application documentation, source code, official technology references,
and approved live business capabilities.

## Runtime boundary

`@arlequins/agent-core` owns a provider-neutral loop:

```text
question
  -> workspace-scoped approved memory
  -> workspace-scoped project and official-document retrieval
  -> approved live capability when current data is required
  -> model provider stream
  -> answer, citations, feedback, and evaluation record
```

| Port | Local pilot | AWS profile |
| --- | --- | --- |
| Model provider | OpenAI Responses API; optional Ollama fallback | Amazon Bedrock or another approved adapter |
| Persistence | PostgreSQL in Docker | Aurora PostgreSQL or the optional reviewed S3 profile |
| Retrieval | PostgreSQL metadata, keyword search, and locally stored embeddings | PostgreSQL plus optional S3 Vectors |
| Authentication | Included OIDC mock | Google-compatible OIDC provider |

The API streams model output over HTTP. tRPC remains the typed transport for
workspaces, conversations, documents, memory, feedback, and evaluation.

## Knowledge classes

- Project knowledge comes from explicitly selected Markdown, MDX, TypeScript,
  configuration, schema, migration, and test files.
- Official stack knowledge comes only from the canonical URL and exact host
  allowlists in `config/official-knowledge-sources.json`.
- Live business knowledge comes only from explicitly registered read-only
  capabilities such as `notices.listRecent` and `vehicles.listSold`.

Downloaded official pages, private repositories, embeddings, database exports,
and evaluation questions remain in local PostgreSQL or ignored `.local/`
paths. The public repository contains configuration and public fixtures only.

## Authorization and citations

Every database query is scoped by a verified OIDC identity and workspace
membership. Retrieved chunks retain a document label and a file, heading, line,
or canonical URL locator. The model receives these labels with the evidence,
and the UI stores the exact citations with the assistant message.

Static documents are not evidence for current business state. If the question
requires current records and an approved live tool is unavailable, the runtime
must say so rather than infer from code or old documentation.

## Improvement loop

Feedback kinds are `helpful`, `incorrect`, `missing`, and
`needs-investigation`. They are signals, not facts. Reviewed retrieval cases
record the expected evidence chunks, and scheduled evaluations compare citation
recall, answer quality, latency, and cost before a prompt or routing change is
promoted. The initial profile does not perform real-time fine-tuning.

Owners can expand an answer's citations, review the evidence, and save that
question plus the expected chunks as an evaluation case. The **Evaluation
loop** panel replays approved cases against retrieval and records citation
recall. For a reproducible local answer-quality baseline, keep the local server
running and execute:

```bash
pnpm agent:evaluate
```

The public cases in `config/local-agent-evaluation.json` verify representative
code, architecture, legacy-language, live-capability, and official-stack
questions. Full answers and timings are written to ignored
`.local/evaluations/latest.json`; credentials and private questions are never
committed. A model or retrieval change passes only when it meets the configured
pass-rate gate.

The current local default is `knowledge-agent-gemma3:12b`, an Ollama profile
built from `gemma3:12b` with an 8K context window and bounded output. It avoids
thinking-mode compatibility differences across Ollama versions while remaining
practical for a quality-first single-user local demo. The adapter also removes
tagged reasoning if a future model emits it. Treat the six public cases as a
local quality gate, not a general model ranking, and re-run them on the target
machine before changing the default.

The reference local run on 2026-08-22 passed all 6 public cases. Individual
answers completed in roughly 19-64 seconds on the test machine.

## Provider policy

The local OpenAI adapter uses the Responses API with provider-side response
storage disabled. Application history remains in PostgreSQL. Production model
selection is an adapter and policy decision: Bedrock, OpenAI, Anthropic, Gemini,
and Ollama do not leak into the agent domain.

AWS deployment is optional and runs through protected GitHub Actions with OIDC.
Long-lived AWS credentials are not a supported repository configuration.
