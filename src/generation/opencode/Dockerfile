ARG UV_VERSION=0.12.3
ARG OPENCODE_VERSION=1.18.16
ARG OPENCODE_NPM_REGISTRY=https://registry.npmjs.org
ARG PLAYWRIGHT_VERSION=1.58.1

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG OPENCODE_VERSION
ARG OPENCODE_NPM_REGISTRY
ARG PLAYWRIGHT_VERSION
ARG UV_DEFAULT_INDEX=https://pypi.org/simple

COPY --from=uv /uv /uvx /usr/local/bin/

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    UV_LINK_MODE=copy \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python

RUN --mount=type=cache,id=front-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=front-apt-lists,target=/var/lib/apt,sharing=locked \
    set -eux; \
    sed -i \
        's|http://ports.ubuntu.com/ubuntu-ports/|https://ports.ubuntu.com/ubuntu-ports/|g' \
        /etc/apt/sources.list.d/ubuntu.sources; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    for attempt in 1 2 3 4 5; do \
        if apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 update \
            && apt-get -o Acquire::Retries=5 -o Acquire::https::Timeout=30 install \
                -y --no-install-recommends \
                build-essential \
                ca-certificates \
                curl \
                git \
                jq \
                ripgrep \
                tmux \
                unzip; then \
            break; \
        fi; \
        if [ "${attempt}" -eq 5 ]; then \
            exit 1; \
        fi; \
        sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    registry="${OPENCODE_NPM_REGISTRY%/}"; \
    archive="/tmp/opencode-linux-x64-${OPENCODE_VERSION}.tgz"; \
    curl \
        --fail \
        --location \
        --retry 5 \
        --retry-all-errors \
        --connect-timeout 15 \
        --max-time 300 \
        --output "${archive}" \
        "${registry}/opencode-linux-x64/-/opencode-linux-x64-${OPENCODE_VERSION}.tgz"; \
    mkdir -p /opt/opencode/bin; \
    tar -xzf "${archive}" \
        --strip-components=2 \
        -C /opt/opencode/bin \
        package/bin/opencode; \
    chmod 0755 /opt/opencode/bin/opencode; \
    test "$(/opt/opencode/bin/opencode --version)" = "${OPENCODE_VERSION}"; \
    rm -f "${archive}"
COPY src/generation/opencode/scripts/opencode-wrapper.sh /usr/local/bin/opencode

ENV UV_PROJECT_ENVIRONMENT=/opt/front-opencode/.venv

WORKDIR /opt/front-opencode

COPY LICENSE ./
COPY src/generation/opencode/pyproject.toml src/generation/opencode/uv.lock ./
COPY src/generation/opencode/src ./src
COPY src/generation/common /opt/common

RUN --mount=type=cache,id=front-uv-cache,target=/root/.cache/uv,sharing=locked \
    set -eux; \
    index_url="${UV_DEFAULT_INDEX%/}"; \
    if [ "${index_url}" != "https://pypi.org/simple" ]; then \
        artifact_base_url="${index_url%/simple}"; \
        sed -i \
            -e "s|https://pypi.org/simple|${index_url}|g" \
            -e "s|https://files.pythonhosted.org|${artifact_base_url}|g" \
            uv.lock; \
    fi; \
    UV_DEFAULT_INDEX="${index_url}" uv sync --frozen --no-dev; \
    opencode --version

ENV FRONT_PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY src/generation/scripts/front-playwright-check.sh /usr/local/bin/front-playwright-check

RUN chmod 0755 /usr/local/bin/front-playwright-check \
    && npm install --global --save-exact "@playwright/test@${PLAYWRIGHT_VERSION}" \
    && test "$(playwright --version)" = "Version ${PLAYWRIGHT_VERSION}" \
    && front-playwright-check /tmp

ENV PATH="/opt/front-opencode/.venv/bin:${PATH}"

WORKDIR /tmp
ENTRYPOINT ["front-opencode"]
