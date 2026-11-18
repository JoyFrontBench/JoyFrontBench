import pytest
from front_generation.locking import RUN_LOCK_PROTOCOL, is_supported_lock_protocol


def test_new_runs_use_an_unversioned_lock_protocol() -> None:
    assert RUN_LOCK_PROTOCOL == "flock"
    assert is_supported_lock_protocol(RUN_LOCK_PROTOCOL)


@pytest.mark.parametrize("revision", [0, 1, 2, 10])
def test_only_the_supported_legacy_lock_revision_is_accepted(revision: int) -> None:
    protocol = f"{RUN_LOCK_PROTOCOL}-v{revision}"
    assert is_supported_lock_protocol(protocol) is (revision == 1)


@pytest.mark.parametrize(
    "protocol", [None, False, 1, {}, [], "", "unknown", "flock-", "flock-v", "flock-1"],
)
def test_missing_or_unknown_lock_protocols_are_rejected(protocol: object) -> None:
    assert not is_supported_lock_protocol(protocol)
