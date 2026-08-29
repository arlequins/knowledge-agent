# knowledge-agent

An AWS-ready, provider-neutral template for evidence-grounded chat over
Fumadocs documentation, T3 monorepos, approved live application data, and
eventually legacy codebases.

The same conversation and knowledge core serves three delivery surfaces:

- a Google-authenticated chat application with conversation history;
- an origin-allowlisted embedded chat widget; and
- an OAuth-protected remote MCP server.

The first runnable profile is intentionally local: PostgreSQL stores
conversations and indexed knowledge, Ollama provides the portable chat and
embedding baseline, and an optional Apple-Silicon MLX profile runs reviewed
Ornith LoRA adapters. OpenAI, Gemini, and Amazon Bedrock stay behind the same
provider boundary. Real documents, source snapshots, database exports,
evaluation questions, credentials, and adapters belong in ignored local paths
and are never part of the public template.

## Design priorities

- Start with TypeScript, T3, and Fumadocs; add Java, Ruby, and C# through stable
  analyzer plugin contracts after the primary path is reliable.
- Keep model providers replaceable through clean-architecture adapters. OpenAI
  is the first hosted adapter; Amazon Bedrock is the intended AWS production
  adapter, with Anthropic and Gemini available by policy.
- Ground answers in repository locations, source excerpts, and live tool
  results. If the available evidence is insufficient, say so.
- Use PostgreSQL full-text and vector retrieval; OpenSearch is not required.
- Read changing business data through allowlisted, read-only tRPC tools rather
  than generated SQL or page scraping.
- Improve quality through replayable evaluations and source-reviewed promotion
  gates. Optional local LoRA training is scheduled, never real-time, and raw
  reactions are not training facts.

## Stack

| Area | Technology |
| --- | --- |
| Workspace | pnpm catalogs, Turborepo, TypeScript, Biome |
| Web | Next.js App Router, React, Tailwind CSS |
| API | Hono and tRPC, local Node.js server, optional AWS Lambda |
| Local persistence | PostgreSQL with Drizzle migrations |
| Model boundary | Provider-neutral core with MLX, Ollama, OpenAI, Gemini, and Bedrock adapters |
| Authentication | Google local allowlist or local OIDC mock; multi-provider OIDC for deployment |
| Testing | Vitest, PostgreSQL integration tests, Playwright, accessibility checks |

## Local pilot

Requirements are Node.js and pnpm versions matching `package.json`, Docker, and
Ollama. Phase 1 uses the local `knowledge-agent-gemma3:12b` profile and
`nomic-embed-text` embedding
models by default, so no hosted-model API key is required. Start from the
checked-in examples; do not commit the local environment file.

```bash
pnpm install
pnpm agent:setup
ollama pull gemma3:12b
ollama pull nomic-embed-text
pnpm agent:model:setup
pnpm db:start
pnpm db:setup
pnpm knowledge:bootstrap
pnpm knowledge:index -- --source /absolute/path/to/your/repository --workspace-id <uuid-from-ui>
pnpm knowledge:sync-official -- --workspace-id <uuid-from-ui>
pnpm dev:local
```

Open `http://localhost:3000`. The API is available at `http://localhost:5000`,
with liveness at `/health/live`, readiness at `/health/ready`, and tRPC at
`/api/trpc`.

### Local authentication modes

The generated `.env.localhost` is configured for **Google mode** so the local
pilot exercises the same verified identity path as deployment. Only the exact
address in `AUTH_ALLOWED_EMAILS` can use the application. Configure the client
ID and address before starting the app:

```bash
pnpm auth:google:local -- <client-id>.apps.googleusercontent.com owner@example.com
pnpm dev:local
```

For a fully offline browser test, use the checked-in `.env.e2e` profile instead.
It starts the development-only OIDC mock on an isolated port and accepts any
non-empty username/password. The mock is intended for Playwright and local
debugging only; it must never be deployed or used with production data:

```bash
pnpm test:e2e
```

`pnpm agent:evaluate` replays the grounded-answer suite against an already
running app and therefore requires the OIDC test profile. It intentionally
fails with an explanatory message when the app is running in Google mode; use
the browser manually for Google sign-in or run the isolated E2E profile.

To use real Google authentication locally, create a Google OAuth 2.0 client of
type **Web application**, add `http://localhost:3000` to its authorized
JavaScript origins, then run the configuration command above with its public
client ID and the single allowed account before restarting the app.

The browser keeps the short-lived Google credential only for the current tab.
The API independently verifies Google's signature, issuer, audience, expiry,
`email_verified` claim, and the exact email allowlist before loading any data.

The public example corpus lives under `examples/knowledge`. Private material is
loaded from ignored `.local/` paths or an explicitly supplied absolute source
path. The indexer reads files; it does not run repository lifecycle scripts.
The official documentation catalog in `config/official-knowledge-sources.json`
contains only public canonical URLs and host allowlists; downloaded text and
embeddings stay in the local database.

Apple-Silicon operators can add the reviewed MLX/Ornith profile after the
portable baseline works:

```bash
pnpm agent:tune:setup
pnpm agent:tune:install-schedule
```

Read the [fine-tuning runbook](docs/local-finetuning.md) before approving data
or promoting an adapter. For model-specific Mac, EC2, and Bedrock guidance, use
the [model playbook](docs/model-playbook.md).

The optional remote integration is documented in [MCP operations](docs/mcp.md).
It remains disabled until `MCP_ENABLED=true` is explicitly configured.

## Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev:local` | Start the local database, identity provider, API, and web app. |
| `pnpm agent:setup` | Create `.env.localhost` without overwriting existing values. |
| `pnpm auth:google:local` | Configure real Google login and an exact local email allowlist. |
| `pnpm agent:evaluate` | Replay the application-level grounded-answer suite. |
| `pnpm agent:model:compare` | Compare checked-in local MLX model profiles. |
| `pnpm agent:tune:daily` | Train and gate a candidate from approved evidence-backed feedback. |
| `pnpm knowledge:index` | Index an approved document or source tree. |
| `pnpm knowledge:bootstrap` | Create the repeatable local test workspace. |
| `pnpm knowledge:sync-official` | Index allowlisted official stack documentation. |
| `pnpm check` | Run Biome formatting and lint checks. |
| `pnpm typecheck` | Typecheck every workspace. |
| `pnpm test` | Run unit and contract tests. |
| `pnpm test:integration` | Test PostgreSQL-backed repositories. |
| `pnpm test:e2e` | Run the browser flow. |

## Architecture and operations

Start with [the product architecture](docs/architecture.md), [the delivery
roadmap](docs/roadmap.md), and [the documentation index](docs/README.md).
Deployment-specific controls are documented in
[deployment security](docs/deployment-security.md). AWS deployments use GitHub
Actions with OIDC; no long-lived AWS credential belongs in this repository.

## Releases

Releases follow [Semantic Versioning](https://semver.org/) and are automated by
Release Please from Conventional Commits. Merging the reviewed release pull
request publishes the tag, changelog, and GitHub release.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Direct
changes to `main` are not part of the normal workflow. The project is available
under the [MIT License](LICENSE), with upstream attribution in [NOTICE](NOTICE).
