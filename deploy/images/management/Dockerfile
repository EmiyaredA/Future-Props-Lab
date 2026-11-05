FROM caddy@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e AS proxy
FROM python:3.11-slim-bookworm@sha256:94a8fee35252d06ab75856f15f12c7bae67b10e8a6da93c7fded82b2610926cd
COPY --from=proxy /usr/bin/caddy /usr/bin/caddy
# All listeners use high ports; remove the upstream low-port file capability.
RUN python -c "import os; p='/usr/bin/caddy'; os.removexattr(p, 'security.capability') if 'security.capability' in os.listxattr(p) else None"
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.txt
COPY backend/ /app/backend/
COPY deploy/contracts/ /app/deploy/contracts/
COPY web/ /app/web/
ENV PYTHONPATH=/app/backend PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
ARG FPL_SERVICE_VERSION
ENV FPL_SERVICE_VERSION=$FPL_SERVICE_VERSION
EXPOSE 8080 9000 28081 29090
ENTRYPOINT ["python", "-m", "studio.assembly.independent.management.cli"]
CMD ["serve"]
