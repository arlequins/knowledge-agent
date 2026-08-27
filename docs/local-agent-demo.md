# Local knowledge-agent demo

The local pilot keeps conversations, feedback, and indexed knowledge in Docker
PostgreSQL. Ollama is the portable chat/embedding baseline. On Apple Silicon,
the optional reviewed profile uses MLX/Ornith for chat and keeps
`nomic-embed-text` in Ollama for embeddings. No hosted-model key is required.

## Portable baseline

Requirements are the repository's Node.js and pnpm versions, Docker, and
Ollama.

```bash
pnpm install
pnpm agent:setup
ollama pull gemma3:12b
ollama pull nomic-embed-text
pnpm agent:model:setup
pnpm dev:local
```

Open `http://localhost:3000`. With the checked-in local profile, use the OIDC
mock. For real Google sign-in with one allowed account, configure a Google Web
OAuth client whose authorized JavaScript origin includes
`http://localhost:3000`, then run:

```bash
pnpm auth:google:local -- <client-id>.apps.googleusercontent.com owner@example.com
pnpm dev:local
```

Google credentials and the allowed email stay in ignored `.env.localhost`.

## Apple-Silicon reviewed profile

After the portable baseline works, install the MLX-LM environment and model
server:

```bash
pnpm agent:tune:setup
pnpm agent:tune:install-schedule
```

The installer selects `ornith-ai/Ornith-1.5-9B-MLX-4bit` unless
`LOCAL_TUNING_BASE_MODEL` overrides it, loads the current reviewed adapter when
one exists, and sets the loopback endpoint in `.env.localhost`. Restart the API
after changing model-provider environment values.

Do not run `pnpm agent:tune:daily` until the approval, split, held-out gate, and
rollback rules in [Reviewed feedback and local fine-tuning](local-finetuning.md)
are understood.

## Index an authorized workspace

The repeatable CLI bootstrap can create the matching workspace before or after
the app starts:

```bash
pnpm knowledge:bootstrap
pnpm knowledge:index -- \
  --source /absolute/path/to/an/approved/repository \
  --workspace-id <workspace-uuid> \
  --prune
pnpm knowledge:sync-official -- \
  --sources react,drizzle \
  --workspace-id <workspace-uuid>
```

The workspace ID is shown in the UI's operations section and by the bootstrap
command. Index into the same workspace used by the signed-in conversation. A
healthy global index in another workspace is intentionally invisible.

The indexer ignores symlinks, dependencies, `.next-*` build outputs, Git
metadata, and private local directories. It never executes scripts from the
target repository. `--prune` should be used only after a complete successful
scan; it marks missing active documents as superseded so stale chunks cannot
win retrieval.

## Verify the application

Test three question classes:

1. project documentation: ask about a rule present in an indexed Markdown/MDX
   file;
2. source code: ask which route, procedure, or schema owns a behavior; and
3. stack documentation: ask a React or Drizzle question supported by an
   allowlisted official page.

Each supported answer should show citations. A question about a current notice
or sold vehicle must decline unless the corresponding approved live capability
is configured.

Run the readiness and application-level evaluation:

```bash
pnpm agent:readiness --api-url http://localhost:5000
pnpm agent:evaluate
```

The service endpoints are:

| Service | URL |
| --- | --- |
| Web | `http://localhost:3000` |
| API liveness | `http://localhost:5000/health/live` |
| API readiness | `http://localhost:5000/health/ready` |
| API explorer | `http://localhost:5000/docs` |
| Ollama | `http://127.0.0.1:11434` |
| Optional MLX | `http://127.0.0.1:8000/v1/models` |

## Try a current-data question locally

The pilot includes a bounded, read-only JSON adapter so current-data routing can
be exercised without copying production records into the public repository.
Put a small, synthetic snapshot in the ignored `.env.localhost` file (never in
`.env.localhost.example` or Git):

```dotenv
LIVE_CAPABILITIES_JSON={"notices":[{"id":"notice-1","publishedAt":"2026-08-27T01:00:00.000Z","title":"휴무 안내","summary":"이번 주 금요일은 휴무입니다.","url":"https://example.com/notices/notice-1"}],"soldVehicles":[{"id":"vehicle-1","soldAt":"2026-08-26T09:30:00.000Z","make":"Toyota","model":"Prius","year":2022,"price":2885297}]}
```

Ask `새로운 공지사항이 있으면 알려줘` or `일주일 이내에 판매된 차량을
보여줘`. The answer receives only the allowlisted fields, a bounded number of
rows, and an `observedAt` label. If the capability is absent, the assistant
must say that current data cannot be checked; it must not infer a result from
old documentation. The production adapter should replace this fixture with
workspace-scoped Aurora/tRPC queries and retain the same port contract.

`pnpm db:stop` stops the local database while preserving its Docker volume.

## Common startup failures

| Symptom | Check |
| --- | --- |
| Web page does not open | Confirm the web dev process owns port 3000 |
| UI remains at `로그인 확인 중…` | The API is usually absent; check `/health/ready` |
| Web works but all tRPC queries fail | Start the API too; `pnpm dev:next` alone is not the full stack |
| Google button reports an origin error | Add exactly `http://localhost:3000` to the Web OAuth client's authorized JavaScript origins |
| No repository answer | Confirm the conversation and indexed documents share a workspace, then inspect citations |
| No embeddings | Pull `nomic-embed-text` and verify Ollama `/api/tags` |
| MLX model responds but app uses another model | Restart the API after installing the MLX profile and confirm the model label in the composer |

See [Model selection and operating playbook](model-playbook.md) before moving
the same workload to EC2 or Bedrock.
