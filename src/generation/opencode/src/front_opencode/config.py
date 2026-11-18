from __future__ import annotations

from copy import deepcopy
from typing import Any

from front_opencode.models import ModelConfig

PROVIDER_ID = "front-harness"


def build_opencode_config(
    model: ModelConfig,
    *,
    max_steps: int,
    credential_reference: str | None = None,
    api_base: str | None = None,
) -> dict[str, Any]:
    if max_steps < 1:
        raise ValueError("max_steps must be at least 1")

    api_key = credential_reference or f"{{env:{model.api_key_env}}}"
    model_options = deepcopy(model.request.extra_body)
    reasoning = model.reasoning_effort
    if reasoning and reasoning.selected:
        if model.wire_api == "anthropic.messages":
            model_options["thinking"] = {
                "type": "adaptive",
                "display": "summarized",
            }
            model_options["effort"] = reasoning.selected
        else:
            model_options["reasoningEffort"] = reasoning.selected

    provider_model: dict[str, Any] = {
        "name": model.label,
        "temperature": model.request.temperature is not None,
        "reasoning": _supports_reasoning(model),
        "tool_call": True,
        "limit": {
            "context": model.context_tokens,
            "output": model.request.max_tokens,
        },
        "options": model_options,
    }
    if model.request.extra_body.get("separate_reasoning") is True:
        provider_model["interleaved"] = {"field": "reasoning_content"}

    build_agent: dict[str, Any] = {
        "model": model.opencode_model,
        "steps": max_steps,
    }
    if model.request.temperature is not None:
        build_agent["temperature"] = model.request.temperature
    if model.request.top_p is not None:
        build_agent["top_p"] = model.request.top_p

    return {
        "$schema": "https://opencode.ai/config.json",
        "model": model.opencode_model,
        "small_model": model.opencode_model,
        "default_agent": "build",
        "enabled_providers": [PROVIDER_ID],
        "share": "disabled",
        "autoupdate": False,
        "permission": {
            "*": "allow",
            "external_directory": "deny",
            "question": "deny",
        },
        "provider": {
            PROVIDER_ID: {
                "name": "Front Harness",
                "npm": model.provider_npm,
                "options": {
                    "baseURL": api_base or model.provider_api_base,
                    "apiKey": api_key,
                    "timeout": model.timeout_ms,
                },
                "models": {
                    model.model: provider_model,
                },
            }
        },
        "agent": {
            "build": build_agent,
        },
    }


def _supports_reasoning(model: ModelConfig) -> bool:
    if model.reasoning_effort is not None:
        return True
    extra_body = model.request.extra_body
    return bool(
        extra_body.get("separate_reasoning")
        or extra_body.get("reasoning")
        or extra_body.get("reasoning_effort")
    )
