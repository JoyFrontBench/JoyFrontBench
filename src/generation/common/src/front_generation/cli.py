import argparse

from front_generation.defaults import (
    DEFAULT_CONTEXT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS,
    DEFAULT_REASONING_EFFORT,
    DEFAULT_WIRE_API,
    DEFAULT_WIRE_PATHS,
)


def positive_integer(value: str) -> int:
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer") from None
    if number < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def add_model_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--context-tokens",
        type=positive_integer,
        help=f"Override context budget (new-run default: {DEFAULT_CONTEXT_TOKENS:,}).",
    )
    parser.add_argument(
        "--max-output-tokens",
        type=positive_integer,
        help=(
            "Override output tokens per model call "
            f"(new-run default: {DEFAULT_MAX_OUTPUT_TOKENS:,})."
        ),
    )
    parser.add_argument(
        "--reasoning-effort",
        help=f"Override reasoning effort (default: {DEFAULT_REASONING_EFFORT}).",
    )
    parser.add_argument(
        "--wire-api",
        choices=tuple(DEFAULT_WIRE_PATHS),
        help=f"Override message protocol (new-run default: {DEFAULT_WIRE_API}).",
    )


def model_environment_overrides(args: argparse.Namespace) -> dict[str, str]:
    options = {
        "MODEL_CONTEXT_TOKENS": args.context_tokens,
        "MODEL_MAX_TOKENS": args.max_output_tokens,
        "MODEL_WIRE_API": args.wire_api,
    }
    return {name: str(value) for name, value in options.items() if value is not None}


def status_exit_code(status: str) -> int:
    return 0 if status in {"completed", "dry-run"} else 1
