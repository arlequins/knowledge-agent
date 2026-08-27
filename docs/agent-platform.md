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
| Model provider | Ollama baseline; optional reviewed MLX, OpenAI, Gemini | Amazon Bedrock or another approved adapter |
| Persistence | PostgreSQL in Docker | Aurora PostgreSQL or the optional reviewed S3 profile |
| Retrieval | PostgreSQL metadata, keyword search, and locally stored embeddings | PostgreSQL plus optional S3 Vectors |
| Authentication | Google single-account allowlist or included OIDC mock | Google-compatible OIDC provider |

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

Live business questions are routed only to the explicitly registered
`notices.listRecent` and `vehicles.listSold` capabilities. The local pilot can
load a bounded `LIVE_CAPABILITIES_JSON` snapshot; production replaces this
adapter with an Aurora/tRPC implementation without changing the chat contract.
Only allowlisted fields are serialized, result counts are capped, and an
unavailable capability produces an explicit unknown answer instead of falling
back to static documentation.

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
promoted. The application never performs real-time fine-tuning.

The optional Apple-Silicon profile can export owner-approved investigations to
disjoint train, validation, and test data, train an MLX LoRA candidate, and
promote it only after held-out evidence and repetition gates pass. That process
is cumulative, scheduled, local, and separate from ordinary evaluation. A
promoted adapter still needs a model-process reload and an application-level
RAG replay. See [Reviewed feedback and local fine-tuning](local-finetuning.md).

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

The checked-in portable default is `knowledge-agent-gemma3:12b`, an Ollama
profile built from `gemma3:12b` with an 8K context window and bounded output.
The current Apple-Silicon reviewed profile uses
`ornith-ai/Ornith-1.5-9B-MLX-4bit` for chat while retaining Ollama embeddings.
Treat public cases as local quality gates, not a general model ranking, and
re-run them on the target machine before changing the default.

The reference local run on 2026-08-22 passed all 6 public cases. Individual
answers completed in roughly 19-64 seconds on the test machine.

## Provider policy

The local OpenAI adapter uses the Responses API with provider-side response
storage disabled. Application history remains in PostgreSQL. Production model
selection is an adapter and policy decision: Bedrock, OpenAI, Anthropic, Gemini,
and Ollama do not leak into the agent domain.

For model-specific settings and the EC2-versus-Bedrock production decision, see
[Model selection and operating playbook](model-playbook.md).

AWS deployment is optional and runs through protected GitHub Actions with OIDC.
Long-lived AWS credentials are not a supported repository configuration.
