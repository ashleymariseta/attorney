# Attorney — Backend API

API-ready Django backend for the **Attorney** platform (*verified legal counsel, on demand*).
The Django project package is `attorney`; domain logic lives in the `core` and `payments` apps.

## Setup

1. Copy `.env.example` to `.env` and update values.
2. Install dependencies:
   ```bash
   python -m pip install -r requirements.txt
   ```
3. Run migrations:
   ```bash
   python manage.py migrate
   ```
4. Create a superuser:
   ```bash
   python manage.py createsuperuser
   ```
5. Run the development server (ASGI, for WebSockets):
   ```bash
   python manage.py runserver
   ```

Or with Docker (web + Celery worker + beat + Postgres + Redis):
```bash
docker compose up --build
```

## API

All REST endpoints are namespaced under `/api/v1/`.

- **Auth:** `POST /api/v1/register/`, `POST /api/v1/auth/token/`,
  `POST /api/v1/auth/token/refresh/`, `POST /api/v1/auth/logout/`
- **Core:** `users`, `matters`, `channels`, `messages`, `consultations`, `trust-transactions`
- **Payments:** `/api/v1/payments/`
- **Docs:** Swagger UI at `/api/docs/`, ReDoc at `/api/redoc/`, raw schema at `/api/schema/`

### Payments & Proof of Payment (POP)

The payments flow is provider-agnostic (see `payments/providers.py`); the default is a
manual **proof-of-payment** flow:

1. `POST /api/v1/payments/` — a participant on a matter creates a payment
   (`matter`, `amount`, `currency`, `provider`). Status starts at `pending_review`.
2. `POST /api/v1/payments/{id}/upload-proof/` — multipart upload of the POP file
   (PDF/PNG/JPG/WEBP), optionally with a bank `reference` and `note`.
3. `POST /api/v1/payments/{id}/review/` — **admin only**. On `verified`, a matching
   `deposit` is posted to the internal trust/escrow ledger (`TrustTransaction`).

Client funds are always recorded in escrow before any release to a lawyer.

## Features

- Custom `User` model with a role enumeration + RBAC permissions.
- DRF viewsets for users, matters, channels, messages, consultations, trust ledger, payments.
- Provider-agnostic payments with reviewed proof-of-payment uploads.
- JWT auth (access + rotating refresh with blacklist) via `djangorestframework-simplejwt`.
- OpenAPI 3 schema (drf-spectacular) — validates cleanly, with Swagger/ReDoc UIs.
- Django Channels (ASGI) WebSocket chat; Celery + Redis for async jobs.
- Postgres + Redis; everything containerised via `docker compose`.

## Tests

```bash
python manage.py test
```
