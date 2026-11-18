RUN_LOCK_PROTOCOL = "flock"


def is_supported_lock_protocol(protocol: object) -> bool:
    if protocol == RUN_LOCK_PROTOCOL:
        return True
    if not isinstance(protocol, str):
        return False
    name, separator, revision = protocol.partition("-v")
    return name == RUN_LOCK_PROTOCOL and separator == "-v" and revision == "1"
