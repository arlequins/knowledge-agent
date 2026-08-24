# Agent operations

Run the read-only readiness check from a trusted operator environment:

```bash
pnpm agent:readiness --api-url https://api.example.com
```

The check validates process liveness and S3-backed readiness. Do not use liveness
alone to declare the service healthy.

For the local PostgreSQL profile, verify the complete chain:

```bash
curl http://localhost:5000/health/live
curl http://localhost:5000/health/ready
curl http://127.0.0.1:8000/v1/models   # when MLX is selected
curl http://127.0.0.1:11434/api/tags   # when Ollama is selected
pnpm agent:readiness --api-url http://localhost:5000
```

`pnpm dev:next` starts the web application and its package dependencies; it
does not guarantee that the API is listening on port 5000. Prefer
`pnpm dev:local` for a complete first run. If the UI remains at
`로그인 확인 중…`, check API readiness before debugging Google authentication.

## Alert policy

| Signal | Warning | Urgent action |
| --- | --- | --- |
| `/health/ready` | One failed scheduled check | Three consecutive failures or five minutes unavailable |
| API 5xx rate | Above 1% for ten minutes | Above 5% for five minutes |
| Evaluation or indexing | Any failed run | Repeated failures; pause activation and inspect audit events |
| Workspace usage | 80% of product quota | 100%; reject new writes with a clear product error |
| Release checksum | Any mismatch | Stop release activation and restore a known-good head |
| Reviewed adapter | Any held-out failure or repeated output | Keep the current adapter; roll back before further training |

## Recovery

1. Verify the active release manifest and snapshot checksum.
2. Conditionally point the active head to a known-good release.
3. Rebuild damaged read models from immutable objects and events.
4. Restore an older versioned object as a new current version.
5. Re-run evaluation before activating another release.

Do not overwrite a live state object without an ETag precondition. S3 Versioning
inside one bucket is not an independent backup; add a separate backup bucket or
cross-region replication only when recovery objectives justify the cost.

Model rollback and daily-learning recovery are documented separately in
[Reviewed feedback and local fine-tuning](local-finetuning.md). Provider and
capacity decisions belong in the [model playbook](model-playbook.md).
