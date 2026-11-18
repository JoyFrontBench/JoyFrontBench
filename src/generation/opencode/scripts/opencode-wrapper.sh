#!/usr/bin/env sh
set -eu

case "$(uname -m)" in
  aarch64 | arm64)
    loader="/opt/opencode/lib/ld-musl-aarch64.so.1"
    ;;
  x86_64 | amd64)
    loader="/opt/opencode/lib/ld-musl-x86_64.so.1"
    ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [ -x "${loader}" ]; then
  exec "${loader}" \
    --library-path /opt/opencode/lib \
    /opt/opencode/bin/opencode \
    "$@"
fi

exec /opt/opencode/bin/opencode "$@"
