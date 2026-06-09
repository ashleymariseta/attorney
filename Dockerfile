FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV DJANGO_SETTINGS_MODULE=attorney.settings

# Bake the admin / DRF static assets into the image so WhiteNoise can serve
# them without a separate build step at boot.
RUN DEBUG=False SECRET_KEY=build-time-placeholder \
    python manage.py collectstatic --noinput

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1

# ASGI server (Channels/WebSockets + HTTP) via Gunicorn-managed Uvicorn workers.
CMD ["gunicorn", "attorney.asgi:application", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", "--workers", "3"]
