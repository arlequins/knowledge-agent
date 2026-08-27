# Reviewed feedback and local fine-tuning

This runbook explains how a signed-in user's feedback can become a new local
LoRA adapter without treating the user's words, a previous assistant answer,
or an unverified correction as ground truth. It documents the current
Apple-Silicon/MLX pilot, including the successful reference run, failure modes,
promotion gates, rollback, and the boundary between retrieval improvement and
model training.

The public repository contains the workflow and safety controls. Questions,
answers, source excerpts, database rows, model credentials, adapters, and
evaluation reports remain in ignored `.local/` paths or local PostgreSQL.

## What changes an answer

An answer can change for several independent reasons:

1. **Knowledge changed:** documents were added, corrected, or reindexed.
2. **Retrieval changed:** query expansion, ranking, workspace scope, or stale
   document pruning changed which evidence reaches the model.
3. **Prompt or routing changed:** the grounded-answer policy or selected model
   changed.
4. **A reviewed adapter changed:** an evidence-backed LoRA candidate passed the
   held-out promotion gate and the MLX server loaded it.

Do not call every improvement "fine-tuning." In the reference repository-purpose
case, the reliable result required both a reviewed adapter and a retrieval fix:
the user's workspace was indexed, generated build output was excluded, Korean
repository-purpose aliases were added, and the root `README.md` was promoted for
overview questions. The base model still declined the same question when no
evidence was supplied. That is correct grounding behavior, not a failure to
memorize the answer.

## End-to-end lifecycle

```text
signed-in feedback
  -> queued investigation
  -> owner verifies active source chunks
  -> approved resolution + required/forbidden terms
  -> deterministic disjoint export
  -> LoRA candidate training
  -> held-out evidence regression probes
  -> reject or atomically promote adapter
  -> restart/reload MLX server
  -> replay application-level RAG evaluation
```

### 1. Capture feedback

The signed-in user selects `incorrect`, `missing`, or `needs-investigation` and
adds a concise correction. The application stores the feedback under that
user's workspace and message. A `needs-investigation` reaction also creates a
queued investigation.

Feedback is a report, not a training example. Do not approve it merely because
the user is the owner, repeats it, or receives the same bad answer more than
once.

### 2. Verify the evidence

An owner or trusted operator must:

- recover the exact user question immediately preceding the rated answer;
- inspect the cited chunks and independently search the active workspace;
- reject generated output, deleted/superseded documents, old snapshots, and
  assistant prose as evidence;
- distinguish intended design, checked-in configuration, installed schedule,
  and observed runtime state;
- write a concise corrected answer in the user's language;
- record at least one active `evidenceChunkId`;
- record `expectedTerms` that a valid answer must contain; and
- record `forbiddenTerms` for known hallucinations or unsafe conflations.

The pilot exposes an owner-only investigation review workbench in the chat
sidebar. It lists queued investigations, preserves the user's feedback as a
report, and records a completed or rejected resolution through an audited
workspace-scoped API. It never promotes a correction directly into model
weights. Automatic model-process reload after a promoted adapter remains a
deployment-specific step.

An approved investigation has this logical shape:

```json
{
  "status": "approved",
  "resolution": "A concise answer supported by the selected source chunks.",
  "findings": {
    "evidenceChunkIds": ["<active-chunk-uuid>"],
    "expectedTerms": ["required exact term"],
    "forbiddenTerms": ["known unsupported claim"]
  }
}
```

Reject an investigation when the correction cannot be proved, the source is
stale, the question is a personal preference, or the requested behavior should
be implemented as retrieval/tooling rather than model training.

### 3. Build a leakage-resistant dataset

`pnpm agent:tune:daily` calls the approved-example exporter. The exporter:

- reads only investigations whose status is `approved`;
- requires a non-empty resolution and valid findings;
- verifies every referenced chunk still belongs to a completed, non-deleted
  document;
- truncates each source excerpt to 2,000 characters for the local profile;
- uses one compact grounded system prompt so the answer remains inside the
  masked training sequence;
- normalizes questions and answers with NFKC, case folding, and whitespace
  folding;
- rejects duplicate normalized questions or answers;
- requires at least six distinct approved examples; and
- sorts by a stable hash of the investigation ID before splitting.

The split is deterministic and non-overlapping. Twenty percent (at least one)
is held out for test, the next twenty percent for validation, and the remainder
for training. With the minimum six examples, the split is `4 train / 1 valid /
1 test`. The test example is not used by MLX-LM training or validation.

Exported JSONL and `manifest.json` are written with owner-only permissions under
the run directory. Never commit or copy them into a public issue or PR.

### 4. Train the candidate

Prepare the isolated MLX-LM environment once:

```bash
pnpm agent:tune:setup
```

Run a candidate immediately:

```bash
pnpm agent:tune:daily
```

Current defaults are intentionally conservative:

| Setting | Default | Reason |
| --- | --- | --- |
| Base model | `ornith-ai/Ornith-1.5-9B-MLX-4bit` | Current local coding/grounding candidate |
| Iterations | `40` | Small reviewed pilot, not a general corpus training run |
| Batch size | `1` | Bounds activation memory |
| LoRA layers | `2` | Avoids the observed Metal out-of-memory profile |
| Maximum sequence | `768` | Keeps the compact evidence and answer in the example |
| Learning rate | `1e-5` | Conservative adapter update |
| Prompt masking | enabled | Loss is computed on the assistant answer |
| Gradient checkpointing | enabled | Trades time for lower activation memory |

Override only for a measured experiment:

```bash
LOCAL_TUNING_BASE_MODEL=<local-path-or-hugging-face-id> \
LOCAL_TUNING_ITERS=40 \
LOCAL_TUNING_MAX_SEQ_LENGTH=768 \
LOCAL_TUNING_NUM_LAYERS=2 \
pnpm agent:tune:daily
```

Do not raise sequence length, layers, and batch size together. "4-bit" or a
model artifact size is not a promise that training fits in the same amount of
RAM; optimizer state, activations, context cache, and the host process require
additional memory.

### 5. Evaluate before promotion

The candidate is probed only with the manifest's held-out test examples. Each
prompt includes the approved evidence but never the expected resolution. A
candidate passes only when every probe:

- contains every required term;
- omits every forbidden term;
- avoids repeated sentences;
- avoids a repeated eight-token n-gram;
- introduces no detected filename, URL, cron, time, snake_case identifier, or
  numeric technical claim absent from the approved answer or evidence; and
- does not switch a Korean question into unexpected Chinese output.

The gate is deliberately conservative and incomplete. It catches the observed
failure class; it does not prove general correctness. Add domain-specific
semantic judges and more held-out cases before increasing autonomy.

On failure, the run remains under `.local/tuning/runs/<timestamp>` for local
diagnosis and the `current` pointer is unchanged. Move known-bad adapters under
`.local/tuning/rejected` when retaining them for audit. Never delete the
previous good adapter until rollback has been tested.

On success, the adapter directory is promoted atomically through the
`.local/tuning/current` symlink. The base model remains immutable; the workflow
does not fuse and re-quantize LoRA weights into the 4-bit model.

### 6. Load and verify the promoted adapter

Promotion changes the pointer, not a model already loaded in memory. Restart
or reinstall the local MLX launch agents after a successful manual run:

```bash
pnpm agent:tune:install-schedule
```

This installs or refreshes:

- `com.arlequins.knowledge-agent.mlx-server` on `127.0.0.1:8000`; and
- `com.arlequins.knowledge-agent.daily-tuning` at 03:00 in the Mac user's local
  timezone.

The installer configures `.env.localhost` with the loopback MLX endpoint and
current base model. The running API must then read that environment. If the API
was already running with a different provider configuration, restart it.

Current limitation: the daily job promotes a successful adapter but does not
restart an already loaded MLX server by itself. Until an explicit safe reload
step is implemented, verify the daily log and refresh the launch agents before
expecting a newly promoted adapter in application responses.

Verify all layers, not just the model endpoint:

```bash
curl http://127.0.0.1:8000/v1/models
pnpm agent:readiness --api-url http://localhost:5000
pnpm agent:evaluate
```

Then repeat the exact question in a new conversation and confirm:

- the expected answer changed;
- the highest-ranked citation is the intended active source;
- no hidden reasoning or `<think>` block is visible;
- there is no repeated sentence or truncated loop; and
- the answer still refuses unsupported detail when evidence is removed.

## Daily schedule semantics

The schedule is local, user-scoped, and installed only when
`pnpm agent:tune:install-schedule` succeeds. Documentation that describes 03:00
does not prove the job is installed or that the latest run passed. Check the
LaunchAgent status and ignored logs under `.local/tuning/logs`.

A question asked today can produce a reviewed change tomorrow only if all of
the following are true:

1. the feedback becomes an approved, evidence-backed investigation;
2. the cumulative dataset still satisfies distinctness and split rules;
3. the scheduled run completes after 03:00 local time;
4. every held-out probe passes;
5. the MLX server loads the newly promoted adapter; and
6. the application's RAG path retrieves the correct current evidence.

No condition guarantees different wording. The quality target is a more
accurate, evidence-grounded answer, not forced variation.

## Reference run: 2026-08-24

The first accepted Ornith pilot used six explicitly approved, source-reviewed
examples and a `4/1/1` split. The final 40-iteration run used two LoRA layers and
a maximum sequence length of 768. Training loss decreased from `1.810` at
iteration 10 to `0.203` at iteration 40; validation loss decreased from `1.424`
to `1.168`. Observed peak memory was approximately `15.5 GB` on the test Mac.
The held-out gate passed before promotion.

Three failed attempts produced the operating rules above:

| Attempt | Result | Lesson |
| --- | --- | --- |
| 8 layers, sequence 1,024 | Metal out of memory | Quantized weights do not define training RAM |
| 4 layers, sequence 512 | `NaN` loss | Long evidence truncated the assistant answer behind the prompt |
| 2 layers, sequence 768, three redundant prompts | `NaN` loss | Duplicate long system prompts wasted the usable token budget |
| 2 layers, sequence 768, one prompt, 2,000-character evidence cap | Passed | Keep evidence compact and verify token placement before training |

These measurements are a reproducibility note, not a universal benchmark.
Repeat held-out evaluation on the target machine and dataset.

## Rollback

Rollback is the default response to repetition, unsupported facts, leakage, or
an evaluation regression:

1. stop using the promoted adapter;
2. point the runtime to the last known-good adapter or the immutable base model;
3. restart the MLX server and API;
4. archive the rejected run and its evaluation locally;
5. prune stale documents and reindex the authorized workspace;
6. correct dataset leakage or evidence selection; and
7. require a fresh held-out pass before any later promotion.

The conservative base-model fallback is
`mlx-community/Qwen2.5-14B-Instruct-4bit`. A fallback answer that says evidence
is insufficient is preferable to a fluent unsupported answer.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Same repeated paragraph | Overfit/bad adapter or generation loop | Roll back, inspect repetition gate, restart without adapter |
| Correct direct model probe but wrong app answer | Retrieval/workspace/ranking mismatch | Inspect citations, workspace membership, active chunks, and reindex with `--prune` |
| Direct model refuses repository-purpose question | No repository evidence was supplied | Expected; test through the grounded application path |
| `NaN` training loss | Assistant tokens were truncated or dataset is malformed | Inspect token counts, shorten evidence, keep one prompt |
| Metal out of memory | Activation/context budget is too large | Reduce layers and sequence length; keep batch size 1 |
| Adapter promoted but answer unchanged | Old adapter remains loaded | Refresh launch agents and restart the API |
| Page stays at `로그인 확인 중…` | API is down while the web dev server is up | Check `/health/ready`; restart `apps/api` or use `pnpm dev:local` |
| Training does not start at 03:00 | LaunchAgent missing, asleep, or failed | Inspect `launchctl` status and `.local/tuning/logs` |

## Security and privacy checklist

- Keep `.env.localhost`, `.local/tuning`, private questions, adapters, and
  reports ignored.
- Never send private training rows to a hosted model for judging without an
  explicit data-handling decision.
- Scope evidence, feedback, and approval to the same authorized workspace.
- Preserve an audit record for approval, rejection, promotion, and rollback.
- Do not expose chain-of-thought. The MLX adapter removes `<think>` blocks and
  the runtime stops before a repeated eight-token sequence.
- Treat personal provider keys as per-user encrypted credentials; never commit
  or log them.

See [Model selection and operating playbook](model-playbook.md) for provider and
model-specific guidance.
