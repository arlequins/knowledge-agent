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
