FROM python:3.11-slim-bookworm@sha256:94a8fee35252d06ab75856f15f12c7bae67b10e8a6da93c7fded82b2610926cd
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.txt
COPY backend/ /app/backend/
COPY web/ /app/web/
COPY deploy/contracts/ownership.json /app/deploy/contracts/ownership.json
ENV PYTHONPATH=/app/backend PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN python -c "import fpl_integrations.application"
ARG FPL_SERVICE_VERSION
ENV FPL_SERVICE_VERSION=$FPL_SERVICE_VERSION
EXPOSE 8080
ENTRYPOINT ["python", "-m", "fpl_integrations"]
CMD ["serve"]
