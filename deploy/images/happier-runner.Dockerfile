FROM node:24-bookworm
ARG HAPPIER_CLI_VERSION=0.2.20
ARG CODEX_CLI_VERSION=0.166.0
RUN npm install --global "@happier-dev/cli@${HAPPIER_CLI_VERSION}" "@openai/codex@${CODEX_CLI_VERSION}" \
    && install -d -o node -g node /runner /projects/workspace
USER node
WORKDIR /projects/workspace
