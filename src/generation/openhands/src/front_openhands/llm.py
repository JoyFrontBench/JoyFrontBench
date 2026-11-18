from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import replace
from typing import Any, Literal

from litellm.llms.custom_httpx.http_handler import (
    AsyncHTTPHandler,
    HTTPHandler,
    MaskedHTTPStatusError,
)
from openhands.sdk import LLM
from pydantic import Field, SecretStr

from front_openhands.models import ModelConfig

MaxTokensField = Literal[
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
]
WireAuthType = Literal["bearer", "x-api-key"]


def _bearer_headers(
    headers: dict[str, Any] | None,
    api_key: str,
) -> dict[str, Any]:
    rewritten = {
        key: value
        for key, value in (headers or {}).items()
        if key.lower() not in {"authorization", "x-api-key"}
    }
    rewritten["Authorization"] = f"Bearer {api_key}"
    return rewritten


def _anthropic_reasoning_body(data: Any, reasoning_effort: str | None) -> Any:
    if reasoning_effort is None:
        return data
    body = json.loads(data) if isinstance(data, (str, bytes)) else dict(data)
    body["thinking"] = {"type": "adaptive"}
    body["output_config"] = {
        **(body.get("output_config") or {}),
        "effort": reasoning_effort,
    }
    if isinstance(data, bytes):
        return json.dumps(body).encode()
    if isinstance(data, str):
        return json.dumps(body)
    return body


class _AnthropicHTTPHandler(HTTPHandler):
    def __init__(
        self,
        api_key: str | None,
        *,
        modelservice_retries: int = 0,
        reasoning_effort: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._api_key = api_key
        self._modelservice_retries = modelservice_retries
        self._reasoning_effort = reasoning_effort

    def post(
        self,
        url: str,
        *args: Any,
        headers: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        rewritten_headers = (
            _bearer_headers(headers, self._api_key) if self._api_key else headers
        )
        if self._reasoning_effort is not None:
            body_field = "json" if "json" in kwargs else "data"
            kwargs[body_field] = _anthropic_reasoning_body(
                kwargs.get(body_field), self._reasoning_effort,
            )
        for attempt in range(self._modelservice_retries + 1):
            try:
                return super().post(
                    url,
                    *args,
                    headers=rewritten_headers,
                    **kwargs,
                )
            except MaskedHTTPStatusError as exc:
                if (
                    attempt >= self._modelservice_retries
                    or not _is_retryable_modelservice_error(exc)
                ):
                    raise
                time.sleep(_modelservice_retry_delay(attempt + 1))
        raise AssertionError("unreachable")


class _AsyncAnthropicHTTPHandler(AsyncHTTPHandler):
    def __init__(
        self,
        api_key: str | None,
        *,
        modelservice_retries: int = 0,
        reasoning_effort: str | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._api_key = api_key
        self._modelservice_retries = modelservice_retries
        self._reasoning_effort = reasoning_effort

    async def post(
        self,
        url: str,
        *args: Any,
        headers: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> Any:
        rewritten_headers = (
            _bearer_headers(headers, self._api_key) if self._api_key else headers
        )
        if self._reasoning_effort is not None:
            body_field = "json" if "json" in kwargs else "data"
            kwargs[body_field] = _anthropic_reasoning_body(
                kwargs.get(body_field), self._reasoning_effort,
            )
        for attempt in range(self._modelservice_retries + 1):
            try:
                return await super().post(
                    url,
                    *args,
                    headers=rewritten_headers,
                    **kwargs,
                )
            except MaskedHTTPStatusError as exc:
                if (
                    attempt >= self._modelservice_retries
                    or not _is_retryable_modelservice_error(exc)
                ):
                    raise
                await asyncio.sleep(_modelservice_retry_delay(attempt + 1))
        raise AssertionError("unreachable")


def _is_retryable_modelservice_error(
    error: MaskedHTTPStatusError,
) -> bool:
    status = error.response.status_code
    if status in {408, 425, 429, 500, 502, 503, 504}:
        return True
    if status != 400:
        return False
    text = error.response.text.lower()
    return (
        "failed_response" in text
        and "provider_error" in text
        and "request is invalid" in text
    )


def _modelservice_retry_delay(attempt: int) -> int:
    return min(30 * 2 ** max(0, attempt - 1), 120)


def remap_max_tokens(
    transport_kwargs: dict[str, Any], field_name: MaxTokensField
) -> dict[str, Any]:
    remapped = dict(transport_kwargs)
    if field_name in remapped:
        return remapped

    for source_name in (
        "max_tokens",
        "max_completion_tokens",
        "max_output_tokens",
    ):
        if source_name != field_name and source_name in remapped:
            remapped[field_name] = remapped.pop(source_name)
            break
    return remapped


class HarnessLLM(LLM):
    wire_max_tokens_field: MaxTokensField = Field(
        default="max_completion_tokens"
    )
    wire_auth_type: WireAuthType = Field(default="bearer")
    request_id_header: str | None = Field(default=None)
    flatten_text_content: bool = Field(default=False)
    retry_modelservice_errors: bool = Field(default=False)
    wire_send_reasoning_content: bool = Field(default=False)
    preserve_assistant_tool_content: bool = Field(default=False)

    def _model_features(self) -> Any:
        features = super()._model_features()
        if not self.wire_send_reasoning_content:
            return features
        return replace(features, send_reasoning_content=True)

    def _prepare_transport_kwargs(
        self,
        *,
        messages: list[dict[str, Any]],
        enable_streaming: bool,
        auth_values: tuple[str | None, dict[str, str]] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        prepared = super()._prepare_transport_kwargs(
            messages=messages,
            enable_streaming=enable_streaming,
            auth_values=auth_values,
            **kwargs,
        )
        prepared = remap_max_tokens(prepared, self.wire_max_tokens_field)
        if self.reasoning_effort is not None and self.model.startswith("openai/"):
            prepared["extra_body"] = {
                **(prepared.get("extra_body") or {}),
                "reasoning_effort": self.reasoning_effort,
            }
        if self.flatten_text_content:
            prepared["messages"] = flatten_text_message_content(
                prepared.get("messages")
            )
        if self.preserve_assistant_tool_content:
            prepared["messages"] = preserve_assistant_tool_content(
                prepared.get("messages")
            )
        if self.request_id_header:
            extra_headers = prepared.get("extra_headers")
            headers = (
                dict(extra_headers)
                if isinstance(extra_headers, dict)
                else {}
            )
            headers[self.request_id_header] = f"front-{uuid.uuid4().hex}"
            prepared["extra_headers"] = headers
        return prepared

    def _anthropic_bearer_api_key(self) -> str | None:
        if (
            self.wire_auth_type != "bearer"
            or not self.model.startswith("anthropic/")
        ):
            return None
        api_key = self.api_key
        if isinstance(api_key, SecretStr):
            return api_key.get_secret_value()
        return api_key

    def completion(self, *args: Any, **kwargs: Any) -> Any:
        api_key = self._anthropic_bearer_api_key()
        reasoning_effort = (
            self.reasoning_effort if self.model.startswith("anthropic/") else None
        )
        if not api_key and reasoning_effort is None:
            return super().completion(*args, **kwargs)
        client = _AnthropicHTTPHandler(
            api_key,
            reasoning_effort=reasoning_effort,
            modelservice_retries=(
                max(0, self.num_retries - 1)
                if self.retry_modelservice_errors
                else 0
            ),
            timeout=self.timeout,
        )
        kwargs["client"] = client
        try:
            return super().completion(*args, **kwargs)
        finally:
            client.close()

    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        api_key = self._anthropic_bearer_api_key()
        reasoning_effort = (
            self.reasoning_effort if self.model.startswith("anthropic/") else None
        )
        if not api_key and reasoning_effort is None:
            return await super().acompletion(*args, **kwargs)
        client = _AsyncAnthropicHTTPHandler(
            api_key,
            reasoning_effort=reasoning_effort,
            modelservice_retries=(
                max(0, self.num_retries - 1)
                if self.retry_modelservice_errors
                else 0
            ),
            timeout=self.timeout,
        )
        kwargs["client"] = client
        try:
            return await super().acompletion(*args, **kwargs)
        finally:
            await client.close()


def build_llm(model: ModelConfig) -> HarnessLLM:
    if not model.enabled:
        raise ValueError(
            f"{model.name} is disabled. Set {model.enabled_env}=true "
            "in the repository .env."
        )
    if not model.api_key:
        raise ValueError(
            f"Missing API key for {model.name}. Configure "
            f"{model.api_key_env} in the repository .env."
        )

    request = model.request
    reasoning_effort = model.reasoning_effort
    round_trip_reasoning_content = model.compatibility.get(
        "roundTripReasoningContent", False
    )
    capability_overrides: dict[str, bool] = {}
    if reasoning_effort:
        capability_overrides = {
            "supports_reasoning_effort": True,
            "supports_sampling_params": (
                request.temperature is not None or request.top_p is not None
            ),
        }
    if model.wire_api == "responses":
        capability_overrides["supports_responses_api"] = True

    kwargs: dict[str, Any] = {
        "usage_id": f"agent-{model.name}",
        "model": model.openhands_model,
        "api_key": SecretStr(model.api_key),
        "base_url": model.api_base,
        "num_retries": model.retries + 1,
        "retry_multiplier": 30,
        "retry_min_wait": 30,
        "retry_max_wait": 120,
        "timeout": max(1, model.timeout_ms // 1000),
        "max_input_tokens": model.context_tokens,
        "max_output_tokens": request.max_tokens,
        "litellm_extra_body": request.extra_body,
        "wire_max_tokens_field": request.max_tokens_field,
        "wire_auth_type": model.auth_type,
        "request_id_header": model.request_id_header,
        "flatten_text_content": model.compatibility.get("flattenTextContent", False),
        "retry_modelservice_errors": model.compatibility.get(
            "retryModelServiceErrors", False
        ),
        "wire_send_reasoning_content": round_trip_reasoning_content,
        "preserve_assistant_tool_content": round_trip_reasoning_content,
        "api_mode": (
            "responses" if model.wire_api == "responses" else "chat"
        ),
        "reasoning_effort": (
            reasoning_effort.selected if reasoning_effort else None
        ),
        "capability_overrides": capability_overrides,
        "stream": False,
    }
    if request.temperature is not None:
        kwargs["temperature"] = request.temperature
    if request.top_p is not None:
        kwargs["top_p"] = request.top_p
    return HarnessLLM(**kwargs)


def flatten_text_message_content(messages: Any) -> Any:
    if not isinstance(messages, list):
        return messages

    rewritten: list[Any] = []
    for message in messages:
        if not isinstance(message, dict):
            rewritten.append(message)
            continue
        content = message.get("content")
        if not isinstance(content, list):
            rewritten.append(message)
            continue

        text_parts: list[str] = []
        for part in content:
            if (
                not isinstance(part, dict)
                or part.get("type") != "text"
                or not isinstance(part.get("text"), str)
            ):
                break
            text_parts.append(part["text"])
        else:
            updated = dict(message)
            updated["content"] = "".join(text_parts)
            rewritten.append(updated)
            continue

        rewritten.append(message)
    return rewritten


def preserve_assistant_tool_content(messages: Any) -> Any:
    if not isinstance(messages, list):
        return messages

    rewritten: list[Any] = []
    for message in messages:
        if (
            isinstance(message, dict)
            and message.get("role") == "assistant"
            and message.get("tool_calls")
            and "content" not in message
        ):
            updated = dict(message)
            updated["content"] = ""
            rewritten.append(updated)
        else:
            rewritten.append(message)
    return rewritten
