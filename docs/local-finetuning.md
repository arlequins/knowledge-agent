# Local reviewed fine-tuning

The local pilot can turn owner-reviewed, evidence-backed feedback into a LoRA
candidate. Raw reactions and comments are never training facts by themselves.

## Approval and promotion gates

1. A signed-in user submits `needs-investigation` feedback with a correction.
2. An owner verifies the correction against indexed source chunks.
3. The investigation is marked `approved` with an exact resolution,
   `evidenceChunkIds`, required answer terms, and forbidden claims.
4. `pnpm agent:tune:daily` exports only those approved investigations to a
   private `.local/tuning` dataset and trains a QLoRA adapter with MLX-LM.
5. The candidate must answer every approved probe with all required terms and
   none of the forbidden claims. A failed candidate is retained for diagnosis
   but is not promoted.
6. Only a passing versioned adapter becomes the new `.local/tuning/current`
   pointer. The base model stays immutable, avoiding lossy re-quantization when
   a LoRA adapter is fused back into a 4-bit model.

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
```

The default local base is `mlx-community/Qwen2.5-14B-Instruct-4bit`. Override it
with `LOCAL_TUNING_BASE_MODEL` and adjust the bounded training iteration count
with `LOCAL_TUNING_ITERS`.
