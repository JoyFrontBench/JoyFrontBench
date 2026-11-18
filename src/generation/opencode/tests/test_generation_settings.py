import json

import pytest

from front_opencode.models import build_model_config
from front_opencode.runner import _rewrite_request_body


@pytest.mark.parametrize(
    "wire_api",
    ["chat.completions", "responses", "anthropic.messages"],
)
def test_default_reasoning_is_forwarded_even_if_the_engine_omits_it(
    wire_api: str,
) -> None:
    model = build_model_config(
        "example-model", environment={"MODEL_WIRE_API": wire_api}
    )
    payload = json.dumps({"max_completion_tokens": 32_768, "messages": []}).encode()
    body = json.loads(
        _rewrite_request_body(
            payload,
            max_tokens_field=model.request.max_tokens_field,
            wire_api=model.wire_api,
            reasoning_effort=model.reasoning_effort.selected,
        )
    )
    assert body[model.request.max_tokens_field] == 32_768
    reasoning = body
    for segment in model.reasoning_effort.request_path:
        reasoning = reasoning[segment]
    assert reasoning == "high"
    if wire_api == "anthropic.messages":
        assert body["thinking"] == {"type": "adaptive"}


def test_effective_reasoning_overrides_engine_defaults_without_losing_other_fields():
    body = json.loads(
        _rewrite_request_body(
            json.dumps({"reasoning": {"effort": "low", "summary": "auto"}}).encode(),
            max_tokens_field="max_output_tokens",
            wire_api="responses",
            reasoning_effort="high",
        )
    )
    assert body["reasoning"] == {"effort": "high", "summary": "auto"}


def test_unspecified_legacy_reasoning_does_not_gain_a_new_default():
    body = json.loads(
        _rewrite_request_body(
            b'{"messages": []}',
            max_tokens_field="max_tokens",
        )
    )
    assert body == {"messages": []}
