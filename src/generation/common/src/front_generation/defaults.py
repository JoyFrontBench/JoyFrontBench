from typing import Any

DEFAULT_CONTEXT_TOKENS = 1_000_000
DEFAULT_MAX_OUTPUT_TOKENS = 32_768
DEFAULT_REASONING_EFFORT = "high"
DEFAULT_MAX_STEPS = 500
DEFAULT_WIRE_API = "chat.completions"

MODEL_DEFAULTS = {
    "apiBase": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "authType": "bearer",
    "litellmProvider": "openai",
    "retries": 3,
    "timeoutMs": 3_600_000,
    "wireApi": DEFAULT_WIRE_API,
    "contextTokens": DEFAULT_CONTEXT_TOKENS,
    "request": {"maxTokens": DEFAULT_MAX_OUTPUT_TOKENS},
}

DEFAULT_WIRE_PATHS = {
    "chat.completions": "/chat/completions",
    "responses": "/responses",
    "anthropic.messages": "/v1/messages",
}


def reasoning_defaults(wire_api: str) -> dict[str, Any]:
    request_paths = {
        "chat.completions": ["reasoning_effort"],
        "responses": ["reasoning", "effort"],
        "anthropic.messages": ["output_config", "effort"],
    }
    if wire_api not in request_paths:
        raise ValueError(f"Unsupported wireApi: {wire_api}")
    return {
        "requestPath": request_paths[wire_api],
        "levels": ["minimal", "low", "medium", "high", "xhigh"],
        "default": DEFAULT_REASONING_EFFORT,
    }
