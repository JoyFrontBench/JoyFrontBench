import json
from types import SimpleNamespace

import pytest
from openhands.sdk.context.view import View
from openhands.sdk.conversation.state import ConversationState
from openhands.sdk.event import (
    ActionEvent,
    AgentErrorEvent,
    LLMConvertibleEvent,
    ObservationEvent,
)
from openhands.sdk.llm import TextContent
from openhands.tools.terminal import TerminalAction, TerminalObservation

from front_openhands.runner import _restore_pending_actions


@pytest.fixture
def tool_events():
    actions = []
    observations = []
    for index in range(2):
        tool_call_id = f"call-{index}"
        command = f"printf result-{index}"
        action = ActionEvent(
            thought=[],
            action=TerminalAction(command=command),
            tool_name="terminal",
            tool_call_id=tool_call_id,
            tool_call={
                "id": tool_call_id,
                "name": "terminal",
                "arguments": json.dumps({"command": command}),
                "origin": "completion",
            },
            llm_response_id="response-1",
        )
        actions.append(action)
        observations.append(ObservationEvent(
            tool_name="terminal",
            tool_call_id=tool_call_id,
            action_id=action.id,
            observation=TerminalObservation(
                command=command,
                exit_code=0,
                content=[TextContent(text=f"result-{index}")],
            ),
        ))
    return actions, observations


@pytest.mark.parametrize("observed_count", [0, 1, 2])
def test_resume_preserves_tool_call_pairs(tool_events, observed_count):
    actions, observations = tool_events
    events = [*actions, *observations[:observed_count]]
    state = SimpleNamespace(
        active_branch=lambda: events,
        get_unmatched_actions=ConversationState.get_unmatched_actions,
        view=View.from_events(events),
    )
    assert len(state.view.events) == (4 if observed_count == 2 else 0)

    _restore_pending_actions(state)
    _restore_pending_actions(state)

    assert state.view.events == events
    for observation in observations[observed_count:]:
        state.view.append_event(observation)
    messages = LLMConvertibleEvent.events_to_messages(state.view.events)
    assert [message.role for message in messages] == ["assistant", "tool", "tool"]
    assert [call.id for call in messages[0].tool_calls] == [
        message.tool_call_id for message in messages[1:]
    ]
    state.view.enforce_properties([*actions, *observations])
    assert len(state.view.events) == 4


def test_resume_leaves_live_pending_view_unchanged(tool_events):
    actions, _ = tool_events
    view = View()
    for action in actions:
        view.append_event(action)
    state = SimpleNamespace(
        active_branch=lambda: actions,
        get_unmatched_actions=ConversationState.get_unmatched_actions,
        view=view,
    )

    _restore_pending_actions(state)

    assert state.view is view
    assert view.events == actions


def test_resume_keeps_failed_tool_calls_paired(tool_events):
    actions, observations = tool_events
    error = AgentErrorEvent(
        source="agent",
        tool_name="terminal",
        tool_call_id=actions[0].tool_call_id,
        error="Tool execution failed",
    )
    events = [*actions, error]
    state = SimpleNamespace(
        active_branch=lambda: events,
        get_unmatched_actions=ConversationState.get_unmatched_actions,
        view=View.from_events(events),
    )

    _restore_pending_actions(state)
    state.view.append_event(observations[1])

    messages = LLMConvertibleEvent.events_to_messages(state.view.events)
    assert [message.role for message in messages] == ["assistant", "tool", "tool"]
    assert [call.id for call in messages[0].tool_calls] == [
        message.tool_call_id for message in messages[1:]
    ]
