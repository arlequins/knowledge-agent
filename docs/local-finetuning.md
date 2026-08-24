# Local reviewed fine-tuning

The local pilot can turn owner-reviewed, evidence-backed feedback into a LoRA
candidate. Raw reactions and comments are never training facts by themselves.

## Approval and promotion gates

1. A signed-in user submits `needs-investigation` feedback with a correction.
2. An owner verifies the correction against indexed source chunks.
3. The investigation is marked `approved` with an exact resolution,
   `evidenceChunkIds`, required answer terms, and forbidden claims.
4. `pnpm agent:tune:daily` requires at least six approved investigations with
   distinct normalized questions and answers. It makes deterministic,
   non-overlapping train, validation, and test splits before training.
5. The candidate is evaluated only against the held-out test split. Its system
   prompts contain the cited source text, never the expected resolution. Every
   probe must contain all required terms, omit forbidden claims, avoid an
   unexpected language switch, avoid repeated sentences and n-grams, and make
   no technical claim absent from the approved answer or evidence. A failed
   candidate is retained for diagnosis but is not promoted.
6. Only a passing versioned adapter becomes the new `.local/tuning/current`
   pointer. The base model stays immutable, avoiding lossy re-quantization when
   a LoRA adapter is fused back into a 4-bit model.

When no reviewed adapter exists, the server starts the base model without an
adapter. Rejected adapters belong under `.local/tuning/rejected` for audit and
must never remain behind the `current` pointer.

The training dataset, adapters, answers, and reports stay under
ignored `.local/tuning`; they are not committed to the public repository.

## Local schedule

`pnpm agent:tune:install-schedule` installs two user-scoped macOS launch agents:

- the reviewed MLX-LM model server on `127.0.0.1:8000`;
- the daily fine-tuning job at **03:00 in the Mac's local timezone**.

The job retrains from the configured base model using the cumulative approved
dataset. It does not promote merely because a user clicked a reaction. The same
question can change after the next successful 03:00 run only when its reviewed
example passes the evidence regression gate and the application is using the
promoted MLX model.

## Commands

```bash
pnpm agent:tune:setup
pnpm agent:tune:daily
pnpm agent:tune:install-schedule
pnpm agent:model:compare
```

The current local base is `ornith-ai/Ornith-1.5-9B-MLX-4bit`. The conservative
rollback target remains `mlx-community/Qwen2.5-14B-Instruct-4bit`. Override the
current base with
`LOCAL_TUNING_BASE_MODEL` and adjust the bounded training iteration count with
`LOCAL_TUNING_ITERS`. Memory-constrained machines can further bound activation
memory with `LOCAL_TUNING_MAX_SEQ_LENGTH` (default `768`) and
`LOCAL_TUNING_NUM_LAYERS` (default `2`). The sequence limit keeps the reviewed
evidence and answer tokens inside the masked training example on the local
memory-constrained profile.

## Ornith 1.5 local default

`ornith-ai/Ornith-1.5-9B-MLX-4bit` is the temporary memory-constrained local
default. Its
published MLX artifact is about 5.04 GB; the 8-bit artifact is about 9.51 GB and
does not fit an 8 GB budget with runtime and context cache headroom. Ornith is a
reasoning model, so the MLX provider removes `<think>` blocks from user-visible
content. It also stops generation before a repeated eight-token sequence and
cancels the remaining stream.

Keep comparing it with the Qwen fallback on this repository's held-out
grounded-answer cases, latency, peak memory, Korean output, citations, and
repetition rate. Any reviewed adapter still has to pass the same promotion
gate; selecting this base model does not bypass evidence or repetition checks.

The checked-in comparison suite treats English grounded and coding cases as the
main signal. Korean and Japanese cases are secondary translation checks. Its
local report stays private under `.local/evaluations/model-comparison.json`.

- Model card: <https://huggingface.co/ornith-ai/Ornith-1.5-9B>
- Official MLX 4-bit build:
  <https://huggingface.co/ornith-ai/Ornith-1.5-9B-MLX-4bit>
