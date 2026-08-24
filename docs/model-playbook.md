# Model selection and operating playbook

This guide records the repository's model-specific operating knowledge. Model
names, availability, prices, and regional support change; treat checked-in IDs
as tested configuration, then verify the provider catalog and target region
before deployment.

Model choice does not replace evidence quality. Compare providers through the
same approved RAG cases, citations, unsupported-claim checks, repetition checks,
latency, and cost envelope.

## Current adapter boundary

The agent core depends on streaming completion and embedding ports. Provider
packages translate those ports to MLX, Ollama, OpenAI, Gemini, or Amazon
Bedrock. The server-side default is the first configured provider in this
order: MLX, OpenAI, Bedrock, then Ollama. A signed-in user can select a configured
provider and can store an encrypted personal Gemini or OpenAI credential.

| Provider | Current role | Credentials | Embeddings |
| --- | --- | --- | --- |
| MLX | Local Apple-Silicon default and reviewed LoRA runtime | None; loopback only | No |
| Ollama | Portable local fallback and local embeddings | None; loopback only | Yes |
| OpenAI | Hosted pilot or personal user model | Server or encrypted per-user key | Yes |
| Gemini | Personal user model | Encrypted per-user key | No current adapter |
| Bedrock | AWS production candidate | AWS IAM role | Separate embedding model/policy required |

The UI model label is operational evidence: record the provider and model ID in
evaluation reports. Never compare answers without also recording retrieval
inputs and generation settings.

## Local models

### `ornith-ai/Ornith-1.5-9B-MLX-4bit`

Use when:

- the target is an Apple-Silicon Mac;
- local/private inference is required;
- coding and repository-analysis cases are primary; and
- the team is prepared to maintain a reviewed LoRA and MLX-specific runtime.

Current profile:

- thinking mode disabled;
- temperature `0.6`, top-k `20`, and top-p `0.95`;
- repetition context `512` and repetition penalty `1`;
- user-visible `<think>` blocks removed; and
- streaming stops before a repeated eight-token sequence.

English grounded and coding cases are the primary qualification signal.
Korean and Japanese are secondary output-language checks. Do not hide weak
multilingual performance with a translation adapter until the English grounded
answer and citations pass independently; otherwise translation can mask a
reasoning or retrieval regression.

The 4-bit artifact is roughly a 5 GB download, but the accepted local LoRA run
peaked near 15.5 GB of system memory. Artifact size, inference memory, and
training memory are different budgets. See
[Reviewed feedback and local fine-tuning](local-finetuning.md).

Known operational risks:

- MLX is Apple-Silicon-specific and is not the EC2 Linux runtime;
- reasoning-tag formats can leak unless output filtering is tested;
- small reviewed datasets can overfit into repeated prose; and
- a newly promoted adapter is not active until the model process reloads it.

### `mlx-community/Qwen2.5-14B-Instruct-4bit`

Use as the conservative local fallback when the Ornith adapter or generation
profile regresses. The comparison profile uses temperature `0.1` and the MLX
adapter applies a repetition penalty of `1.18` to non-Ornith models.

Qwen is larger than the 9B candidate and therefore leaves less memory headroom.
Prefer it as an immutable base-model rollback target, not as proof that a failed
dataset or retrieval path has been fixed. Re-run the same held-out cases before
changing the default.

### `knowledge-agent-gemma3:12b` through Ollama

This is the portable local chat profile built from `gemma3:12b`. Ollama works on
supported Mac and Linux hosts and uses `/api/chat`; the adapter defaults to
temperature `0.1`, seed `42`, a 768-token output bound, a 120-second timeout,
and thinking disabled.

Use when:

- a simple cross-platform local runtime matters more than MLX tuning;
- the deployment already operates Ollama securely on loopback; or
- a deterministic baseline is needed for regression comparison.

Do not expose Ollama directly to an untrusted network. The repository validates
that the configured base URL resolves to a loopback host.

### `nomic-embed-text` through Ollama

This is the current no-hosted-key embedding default. Keep the embedding model
stable across an index generation: changing dimensions or semantic space
requires a complete re-embedding and explicit old-document pruning. Keyword
retrieval remains a deliberate fallback when the embedding service is absent,
but it is not evidence that semantic retrieval quality is unchanged.

## Hosted models

### OpenAI

The adapter uses the Responses API with `store: false`. The server default in
code is `gpt-5.6-luna`; the UI also supports saved personal model IDs. OpenAI
embeddings default to `text-embedding-3-small` when a server key is configured.

Use when fast iteration, strong general instruction following, and a managed
endpoint matter more than a fully local data path. Keep application conversation
history in PostgreSQL and review provider data handling separately. Never use a
personal key as a shared server secret.

### Google Gemini

The current adapter is completion-only and calls streaming Generate Content.
It excludes parts marked as thoughts from user-visible output. The model catalog
offers checked-in examples, but the saved model ID remains the user's explicit
choice and must match the encrypted credential record.

Use when users want to pay with their own Gemini account or when Gemini wins the
same grounded evaluation suite. Do not silently fall back from a failed personal
credential to another user's or server credential. Since Gemini is not the
current embedding provider, changing only chat models does not require
re-embedding.

### Amazon Bedrock

The Bedrock adapter uses the AWS Converse boundary and a server-side model ID.
It is the preferred initial AWS production route when the selected Bedrock
model passes quality gates because AWS manages model hosting, scaling, IAM, and
regional access. On-demand inference avoids paying for an idle GPU instance;
Provisioned Throughput is a later capacity decision, not a default for a
lightly used pilot.

Verify model ID, API compatibility, lifecycle, and region at deployment time:

- <https://docs.aws.amazon.com/bedrock/latest/userguide/models.html>
- <https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html>
- <https://aws.amazon.com/bedrock/pricing/>

Bedrock fine-tuning supports only listed model families and regions. It cannot
be assumed to train or host the Ornith MLX artifact. If daily customization is
required, either select a currently supported Bedrock base model and rebuild
the same evidence/split/promotion gates, or self-host the exact open model.

## EC2 self-hosting versus Bedrock

MLX cannot be copied unchanged to an EC2 GPU instance. An EC2 Ornith deployment
needs a Linux/NVIDIA artifact and a runtime such as vLLM, Text Generation
Inference, or llama.cpp, plus a new adapter implementation and a fresh
evaluation baseline. Do not treat an MLX 4-bit LoRA as automatically compatible
with CUDA quantization formats.

### Practical EC2 starting points

AWS G6 instances use NVIDIA L4 GPUs with 24 GB of GPU memory per full GPU and
are positioned for inference. G5 instances use NVIDIA A10G GPUs with 24 GB per
GPU and are also positioned for moderately complex single-node training.

For a 9B-class 4-bit model:

| Workload | Starting point | Notes |
| --- | --- | --- |
| Development smoke | Local Mac | Cheapest while one owner is validating quality |
| Always-on inference pilot | `g6.2xlarge` class | One 24 GB L4 plus 32 GiB host RAM; benchmark context and concurrency |
| More host headroom | `g6.4xlarge` class | Same 24 GB GPU with 64 GiB host RAM |
| CUDA LoRA/QLoRA experiment | `g5.4xlarge` or `g6.4xlarge` class | Validate framework support and measured peak GPU/host memory |
| Larger model or long-context concurrency | Multi-GPU/larger-memory class | Select only after load testing proves the need |

These are qualification starting points, not capacity guarantees. KV-cache
memory grows with context length and concurrent sequences. Benchmark the exact
quantization, runtime, prompt length, output length, and batch scheduler. Keep
training separate from the serving instance so a daily job cannot exhaust
memory or interrupt active conversations.

Relevant AWS specifications:

- <https://aws.amazon.com/ec2/instance-types/g6/>
- <https://aws.amazon.com/ec2/instance-types/g5/>

### Decision for the initial 100-user profile

For roughly 100 users making light, intermittent requests, start with **Bedrock
on-demand**, not an always-on EC2 GPU, unless the exact Ornith model is a hard
product requirement. The reason is utilization: an EC2 GPU accrues cost while
idle and requires patching, autoscaling, model loading, observability, and
capacity management. Bedrock charges by the selected model's inference usage
and provides managed scaling.

Recommended production progression:

1. keep local Mac MLX for private experiments and reviewed adapter research;
2. run the public application through the existing Bedrock adapter with an
   economical model that passes the grounded evaluation suite;
3. perform the daily loop as retrieval, prompt, routing, and evaluation updates
   first—do not require daily weight training;
4. route difficult coding questions to a stronger model only when a policy or
   evaluation case justifies the additional cost; and
5. consider EC2/SageMaker self-hosting only after measured Bedrock spend or a
   strict model/data requirement exceeds the operational cost of a GPU service.

Choose EC2 self-hosting when at least one of these is true:

- the exact open model or LoRA adapter is mandatory and unavailable in Bedrock;
- sustained utilization is high enough to amortize an always-on GPU;
- offline or unusually strict model-isolation requirements apply; or
- custom CUDA kernels, quantization, or continuous adapter loading are core
  product features.

Choose Bedrock when:

- traffic is intermittent or uncertain;
- the team wants IAM, managed scaling, and no GPU host operations;
- a supported model meets the grounded quality bar; and
- model flexibility through the provider adapter is more important than exact
  weight ownership.

## Comparison protocol

Run the checked-in local model comparison for MLX profiles:

```bash
pnpm agent:model:compare
```

Run the application-level RAG evaluation for every provider candidate:

```bash
pnpm agent:evaluate
```

Record at minimum:

- model provider, exact model ID/version, region, and quantization;
- prompt/context/output token counts;
- retrieval chunk IDs and citation recall;
- required/forbidden term results and unsupported claims;
- repeated sentence/n-gram detections;
- first-token and total latency;
- peak host/GPU memory for self-hosted models;
- input/output token cost or instance-hours; and
- failure/timeout rate under representative concurrency.

Promote a model only when the primary English grounded/coding cases pass and
secondary Korean/Japanese checks show no unacceptable regression. Cost or
speed alone cannot override evidence, authorization, citation, or privacy
failures.
