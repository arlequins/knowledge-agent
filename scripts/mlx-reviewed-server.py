#!/usr/bin/env python3
"""Run MLX-LM's local server while preserving its configured LoRA adapter.

MLX-LM 0.31.3 resolves the default model alias before looking up the adapter
alias. A normal OpenAI-compatible request names the base model, so the adapter
can otherwise be dropped silently. Keep this compatibility shim local and
remove it once the upstream server resolves the adapter before the model alias.
"""

from mlx_lm import server


def load_with_default_adapter(
    provider: server.ModelProvider,
    model_path: str,
    adapter_path: str | None = None,
    draft_model_path: str | None = None,
):
    requested_model = model_path
    default_model = provider._model_map.get("default_model")
    if requested_model in ("default_model", default_model):
        model_path = default_model
        if adapter_path is None:
            adapter_path = provider._adapter_map.get("default_model")
        if draft_model_path in (None, "default_model"):
            draft_model_path = provider._draft_model_map.get("default_model")
    else:
        model_path = provider._model_map.get(requested_model, requested_model)
        draft_model_path = provider._draft_model_map.get(
            draft_model_path, draft_model_path
        )

    model_key = (model_path, adapter_path, draft_model_path)
    if provider.model_key != model_key:
        provider._load(*model_key)
    return provider.model, provider.tokenizer


server.ModelProvider.load = load_with_default_adapter
server.main()
