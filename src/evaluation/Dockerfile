FROM mcr.microsoft.com/playwright:v1.58.1-noble

ARG CODEX_VERSION=0.147.0

ENV CI=1 \
    FRONT_REPO_ROOT=/opt \
    CODEX_HOME=/codex-home \
    DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp \
    NODE_PATH=/opt/front-auto-eval/node_modules \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/front-auto-eval

COPY src/evaluation/package.json src/evaluation/package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

RUN mkdir -p /codex-home /input /output \
    && chmod 0777 /codex-home /output

RUN npm install --global --omit=dev "@openai/codex@${CODEX_VERSION}" \
    && codex --version \
    && npm cache clean --force

COPY src/evaluation/scripts ./scripts
COPY src/evaluation/tests ./tests
COPY data /opt/data
COPY LICENSE /opt/LICENSE
COPY src/evaluation/skills ./skills
COPY src/evaluation/scripts/docker-entrypoint.sh /usr/local/bin/front-auto-eval
RUN chmod 0755 /usr/local/bin/front-auto-eval \
    && mkdir -p /opt/src \
    && ln -s /opt/front-auto-eval /opt/src/evaluation \
    && node scripts/cli.mjs references:verify

ENTRYPOINT ["front-auto-eval"]
CMD ["help"]
