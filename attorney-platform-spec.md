# Attorney — Lawyer on Demand

> **Tagline:** *Verified legal counsel, on demand. The professional's answer to "Uber for lawyers."*

A two-sided marketplace and collaboration platform connecting clients with verified legal practitioners — for instant consultations, scheduled bookings, full matters, and ongoing retainers — wrapped in a Slack-grade real-time workspace with **huddles**, matter rooms, and AI-assisted intake.

This document is the master specification. It is structured so that each module can be handed to Claude Code as a discrete, buildable unit. Sections marked **[MVP]** form the first shippable product; **[Phase 2]** / **[Phase 3]** are sequenced after.

---

## 1. Product Principles

1. **Professional first.** This is not a gig app. Trust, privilege, and compliance are first-class features, not afterthoughts.
2. **Transparency like a fare meter.** Clients always see who they're talking to, the rate, the running cost, and the scope before money moves.
3. **The workspace is the moat.** Anyone can build a directory. The differentiator is the persistent, real-time collaboration layer (channels + huddles + matter rooms) that lives around every engagement.
4. **Verified or it doesn't exist.** No lawyer transacts without a verified practising certificate / bar credential. No client funds move outside trust accounting.
5. **AI assists, humans decide.** AI handles intake, triage, summaries, and drafting scaffolds. A licensed human always owns the advice and the engagement.

---

## 2. User Roles

| Role | Description |
|------|-------------|
| **Client (individual)** | Person seeking legal help. KYC-lite. |
| **Client (business)** | Organisation account; can have multiple seats and a billing owner. |
| **Lawyer** | Verified practitioner. Can be solo or attached to a Firm. |
| **Firm / Organisation** | Group of lawyers; shared branding, matters, billing, and supervision. |
| **Paralegal / Associate** | Limited member who can collaborate inside matters but not give advice or bill independently. |
| **Platform Admin** | Ops, verification, dispute resolution, trust-account oversight. |

Custom Django `User` model with a `role` enum + per-role profile (one-to-one). RBAC enforced at the DRF permission layer and re-checked in real-time consumers.

---

## 3. Tech Stack

**Backend**
- Django 5 + Django REST Framework
- PostgreSQL (primary), Redis (cache, Celery broker, Channels layer)
- Celery + Celery Beat (async jobs: payouts, reminders, AI summary generation, recurring retainer billing)
- Django Channels (WebSockets: chat, presence, huddle signalling, live billing meter)
- **LiveKit** (self-hostable, open-source WebRTC) for huddle/consultation audio + video + screen share. *Assumption — swappable for Daily/Twilio behind a `MediaProvider` interface.*
- Pluggable payments via a `PaymentProvider` interface: **Paynow** & **Ecocash** (Zimbabwe), **Stripe** (international). Trust/escrow ledger is internal and provider-agnostic.
- Storage: S3-compatible (documents, recordings, transcripts) with signed URLs.
- Search: Postgres full-text for v1; pluggable to OpenSearch later.

**Frontend**
- Next.js (App Router) + TypeScript
- Tailwind CSS — **mobile-responsive first**; the layout must work as a primary mobile experience, not a desktop app squeezed down.
- TanStack Query (server state), Zustand (client/UI state)
- WebSocket client + LiveKit JS SDK
- Auth via httpOnly cookie sessions (JWT access + refresh rotation behind the scenes)

**Cross-cutting**
- OpenAPI schema auto-generated from DRF (drf-spectacular) → typed frontend client.
- Everything containerised; `docker compose` for local + deploy.

---

## 4. Architecture Overview

```
                ┌────────────────────────────────────────┐
   Next.js  ───▶│  Django REST API  (DRF + drf-spectacular)│
   (web/mobile) └───────────────┬──────────────────────────┘
        │                       │
        │ WebSocket             │ Celery tasks
        ▼                       ▼
  Django Channels ──▶ Redis ──▶ Celery workers ──▶ Postgres
   (chat/presence/                                  │
    huddle signalling)                              │
        │                                           ▼
        ▼                                    Payment
   LiveKit (media)                          (upload pop)
        │
        ▼
   S3 (files, recordings, transcripts)
```

---

## 5. Module Breakdown

### 5.1 Identity, Onboarding & Verification **[MVP]**

**Client onboarding**
- Email/phone signup, OTP verification.
- Individual vs business toggle.
- Light KYC: name, contact, ID document upload (stored, reviewed for higher-value matters / trust deposits).

**Lawyer onboarding** *(the gate — nothing transacts until verified)*
- Practising certificate / bar number upload.
- Jurisdiction(s) of admission, practice areas, languages, years of experience.
- Profile: bio, photo, rates (hourly / fixed-fee menu / consultation price).
- **Verification workflow**: submitted → under review (admin) → verified → badge issued. Re-verification on certificate expiry (Celery Beat reminder).
- Firm association (invite / join existing Firm, or operate solo).

**Verification badges**: `Verified Practitioner`, `Firm Member`, `Top Rated`, `Fast Responder` (SLA-based).

---

### 5.2 Lawyer on Demand — The "Now" Queue **[MVP]**

The Uber-style core.

- Client describes their issue (free text + optional AI intake, see §5.9) → selects practice area, jurisdiction, urgency.
- System matches against the **availability pool**: lawyers currently `online`, admitted in the jurisdiction, practising in the area, not conflicted.
- **Smart match score** = f(specialisation fit, jurisdiction, rating, response time, price band, language).
- Lawyer receives a request card → accepts/declines (configurable auto-timeout → next candidate).
- On accept → a **Matter Room** spins up (§5.5) and the parties drop into a chat or huddle immediately.
- Live presence: lawyers toggle `Available / Busy / Offline`; availability drives the pool.

Also supports:
- **Scheduled consultations** — calendar booking against lawyer availability slots.
- **Directory browse + search** — clients can pick a specific lawyer/firm directly.

---

### 5.3 Consultations **[MVP]**

- Modes: **chat**, **audio**, **video** (LiveKit). Screen share for document walk-throughs.
- Booking object holds: type, scheduled time, duration, price model, status.
- **Live billing meter** for metered consults — a visible running cost in the room (the "fare meter"), streamed over WebSocket.
- Consent-gated recording → transcript → AI summary + action items (§5.9).
- Auto-generated **engagement summary** + optional engagement letter draft at close.

---

### 5.4 The Workspace — Slack-grade Collaboration **[MVP for matter rooms + DMs; Phase 2 for full channels]**

This is the differentiator. Structured around **channels**.

**Channel types**
- `matter` — one per active matter/engagement. Members: client(s) + assigned lawyer(s) + paralegals. Holds messages, files, the billing meter, consultation history, documents.
- `dm` — direct messages (lawyer↔lawyer, lawyer↔client within an engagement, admin↔user).
- `group` — ad-hoc multi-party (e.g. co-counsel on a matter).
- `firm` — internal firm channels (lawyers only).
- `lawyer_lounge` — platform-wide professional channels for verified lawyers (knowledge sharing, referrals, co-counsel marketplace). **[Phase 2]**

**Messaging features**
- Real-time messages, threads, reactions, mentions (`@`), typing indicators, read receipts.
- File attachments (scoped to channel; signed-URL access).
- Pinned messages, search within channel.
- Per-channel notification preferences.

**Confidentiality model**
- Matter channels are privileged spaces — encrypted at rest, access strictly limited to matter members, full audit log of who saw what.
- **Ethical walls**: when a conflict is flagged, specific lawyers are walled out of a matter channel even within the same firm.

---

### 5.5 Matter Rooms **[MVP]**

A Matter Room *is* a `matter`-type channel with extra structure bolted on:
- **Matter header**: client, assigned lawyer(s), practice area, jurisdiction, status (`open / active / awaiting client / closed`), billing model.
- **Files & documents** tab (versioned).
- **Billing** tab: time entries, running total, invoices, trust balance.
- **Timeline**: consultations held, documents signed, payments made.
- **Tasks**: action items (often AI-generated from consult summaries).

Every on-demand acceptance, scheduled consultation, and retainer auto-provisions or attaches to a Matter Room.

---

### 5.6 Huddles **[MVP — this is an explicit headline feature]**

Lightweight, audio-first, one-tap live calls inside any channel (LiveKit-powered).

- **In a Matter Room**: lawyer ↔ client jump into a huddle for a quick live discussion without scheduling. Counts toward billing meter if metered.
- **Lawyer ↔ Lawyer (co-counsel)**: pull a specialist in for a "second opinion" mid-matter. Optional revenue split recorded (§5.7).
- **Retainer huddles**: retained clients get **priority huddle access** to their lawyer/firm with SLA-backed availability.
- Features: live audio/video, screen share (document review), in-huddle chat, optional consented recording → transcript → summary.
- Presence-aware: see who's free to huddle right now (ties into the availability pool).
- **Knock to huddle**: client can request a huddle; lawyer gets a knock notification rather than a forced ring.

---

### 5.7 Matters, Co-counsel & Referrals **[MVP for matters; Phase 2 for co-counsel marketplace]**

- Matter lifecycle, membership, status, document store, task list.
- **Co-counsel**: a lawyer can invite another verified lawyer into a matter (via huddle or channel), with an agreed **fee split** recorded on the matter — platform handles the split at payout.
- **Referral marketplace** **[Phase 2]**: lawyers refer matters outside their area/jurisdiction to peers, with a referral fee where ethically permitted in that jurisdiction.

---

### 5.8 Billing, Payments & Trust Accounting **[MVP — core]**

**Billing models** (per matter/consultation):
- **Per-consultation fixed price**
- **Hourly / metered** (live meter, time entries)
- **Fixed-fee matter** (milestones)
- **Retainer** (recurring — see §5.9)
- **Lawyer platform subscription** **[Phase 2]** (lawyers pay for premium placement / lower commission)

**Trust accounting / escrow (non-negotiable for legal)**
- Internal double-entry ledger: every client deposit is held in escrow and only released to the lawyer on milestone/approval.
- `TrustTransaction` records: deposit, hold, release, refund, platform-fee deduction.
- Clear separation of **client funds** vs **platform revenue** in the ledger.
- Refund + dispute flow with admin arbitration.

**Money flow**
- Client pays → funds held in escrow → work delivered / milestone hit → release to lawyer minus **platform commission** → payout (Celery job, batched).
- Provider-agnostic: `PaymentProvider` interface (Paynow, Ecocash, Stripe). Trust ledger is internal regardless of provider.

**Invoices**: auto-generated from time entries + fixed fees; downloadable; tax-line aware.

---

### 5.9 Retainers **[MVP]**

The recurring, high-value relationship tier.

- A client (often business) puts a lawyer/firm **on retainer**: a plan with a billing cycle (monthly/quarterly), an included-hours allowance or unlimited-consult tier, and an **SLA** (e.g. response within X hours, priority huddles).
- Retained clients get a **persistent dedicated channel** (doesn't close like a one-off matter) + priority in the queue + priority huddle access.
- Recurring billing via Celery Beat; overage handled per plan.
- Retainer dashboard: hours used, SLA performance, active matters under the retainer.

---

### 5.10 AI Layer **[Intake & summaries MVP; drafting/research Phase 2]**

*(Designed to plug into an agent framework — keep providers swappable behind an `AIProvider` interface.)*

- **AI Intake Agent [MVP]**: client describes their problem in plain language → classifies practice area, jurisdiction, urgency; flags missing info; produces a structured **matter brief** before a human lawyer joins. Speeds matching and saves billable time on intake.
- **Consultation Companion [MVP]**: live transcription → post-call summary, key facts, action items, follow-up tasks auto-added to the Matter Room.
- **Smart Matching [MVP]**: ranks the availability pool for a given request.
- **Document Drafting Assistant [Phase 2]**: scaffolds engagement letters, standard agreements, demand letters — *draft only, lawyer reviews and owns*.
- **Legal Research Assistant [Phase 2]**: retrieval over a jurisdiction-scoped knowledge base.
- **Guardrails**: AI never gives advice directly to a client unattended; outputs are clearly labelled as drafts/aids; a licensed human is always in the loop.

---

### 5.11 Trust, Safety & Compliance **[MVP for conflict checks, audit log, data protection]**

- **Conflict checks**: at matching/assignment time, screen the prospective lawyer against existing adverse parties / matters. Block or warn.
- **Confidentiality & privilege**: matter rooms encrypted at rest; strict membership; ethical walls.
- **Audit log**: immutable record of access, money movement, document views, role changes.
- **Data protection**: built for regulated markets — data minimisation, consent records, data-subject access/erasure flows, retention policies. *(Designed with Zimbabwe CDPA / POTRAZ-style requirements in mind, generalisable to GDPR.)*
- **Dispute resolution**: admin-mediated, tied to escrow holds.

---

### 5.12 Ratings, Reviews & Reputation **[MVP]**

- Post-engagement rating (client → lawyer) + structured review.
- Lawyer reputation: rating, response time, completion rate, repeat-client rate.
- Drives badges and match score. Review moderation by admin.

---

### 5.13 Notifications **[MVP]**

- In-app (real-time), email, push/SMS (provider-pluggable; SMS/Ecocash-friendly for the local market).
- Events: new request, request accepted, message/mention, huddle knock, booking reminder, payment, SLA breach risk, certificate expiry.
- Per-channel + global preferences.

---

### 5.14 Admin & Analytics **[MVP-lite, expands Phase 2]**

- Verification queue, dispute queue, trust-account oversight, user management.
- Platform analytics: GMV, take rate, active lawyers/clients, match latency, consult volume, retainer MRR.

---

## 6. Core Data Model (Django)

Indicative — not exhaustive. Names are guidance for Claude Code.

```
User(role, email, phone, is_verified, ...)            # custom user
LawyerProfile(user, bar_number, verification_status,
              hourly_rate, availability_status, firm, bio, photo)
ClientProfile(user, type[individual|business], kyc_status)
Firm(name, admin, branding, ...)
PracticeArea(name); Jurisdiction(name, country)
LawyerProfile.practice_areas (M2M); LawyerProfile.jurisdictions (M2M)

ConsultationRequest(client, practice_area, jurisdiction, urgency,
                    description, ai_brief, status, matched_lawyer)
Consultation(matter, lawyer, client, mode[chat|audio|video],
             scheduled_at, started_at, ended_at, price_model, status)

Matter(client, practice_area, jurisdiction, status, billing_model, firm)
MatterMembership(matter, user, role[lead|co_counsel|paralegal|client])

Channel(type[matter|dm|group|firm|lawyer_lounge], matter?, name)
ChannelMember(channel, user, notif_prefs, last_read)
Message(channel, sender, body, thread_parent, attachments, created_at)
Reaction(message, user, emoji)

Huddle(channel, started_by, status, livekit_room, recording_url)
HuddleParticipant(huddle, user, joined_at, left_at)

Retainer(client, lawyer_or_firm, plan, cycle, included_hours,
         sla, status, current_period_start)

TimeEntry(matter, lawyer, minutes, billable, note, created_at)
Invoice(matter, client, total, status, line_items)
Payment(invoice, provider, provider_ref, amount, status)
TrustTransaction(matter, type[deposit|hold|release|refund|fee],
                 amount, balance_after)
Payout(lawyer, amount, period, status)

ConflictCheck(matter, lawyer, result, flagged_party)
Review(matter, client, lawyer, rating, body, status)
Document(matter, uploader, file, version, signed)
Notification(user, type, payload, read)
AuditLog(actor, action, target, metadata, created_at)
```

---

## 7. Key API Surface (DRF)

Grouped; all under `/api/v1/`.

- **Auth**: `POST /auth/signup`, `/auth/login`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`
- **Profiles**: `GET/PATCH /me`, `/lawyers/{id}`, `/lawyers/` (search/filter), `/firms/{id}`
- **Verification**: `POST /lawyers/verify/submit`, admin `PATCH /admin/verifications/{id}`
- **On-demand**: `POST /requests` (create), `POST /requests/{id}/accept|decline`, `GET /availability` (pool)
- **Consultations**: `POST /consultations`, `GET /consultations/{id}`, `POST /consultations/{id}/start|end`
- **Matters**: `GET/POST /matters`, `PATCH /matters/{id}`, `POST /matters/{id}/members`, `/matters/{id}/co-counsel`
- **Channels & messages**: `GET /channels`, `GET /channels/{id}/messages`, `POST /channels/{id}/messages` (also via WS)
- **Huddles**: `POST /channels/{id}/huddle` (start), `POST /huddles/{id}/join|leave`, returns LiveKit token
- **Retainers**: `GET/POST /retainers`, `PATCH /retainers/{id}`
- **Billing**: `POST /matters/{id}/time`, `GET /matters/{id}/invoices`, `POST /payments`, `GET /matters/{id}/trust`
- **Reviews**: `POST /matters/{id}/review`, `GET /lawyers/{id}/reviews`
- **AI**: `POST /ai/intake`, `POST /ai/summarise`, `POST /ai/draft` (Phase 2)
- **Notifications**: `GET /notifications`, `PATCH /notifications/{id}/read`
- **Admin**: verification queue, disputes, trust oversight, analytics

---

## 8. Real-time Architecture

**Django Channels consumers** (over Redis channel layer):
- `PresenceConsumer` — availability/online status; drives the on-demand pool.
- `ChannelConsumer` — messages, threads, typing, reactions, read receipts per channel.
- `BillingMeterConsumer` — streams the live cost meter during metered consults/huddles.
- `HuddleSignalConsumer` — huddle start/knock/join/leave events + issues LiveKit access tokens.

**LiveKit** handles the actual media (audio/video/screen share). Backend issues scoped room tokens; recordings (consented) land in S3 → transcription → AI summary (Celery).

---

## 9. Build Roadmap

**Phase 1 — MVP ("Lawyer on Demand")**
Identity + lawyer verification → on-demand "Now" queue + scheduled bookings → consultations (chat/audio/video via LiveKit) → Matter Rooms → Huddles → DMs → billing + trust accounting + payments → retainers → AI intake + consult summaries → reviews → notifications → conflict checks + audit log.

**Phase 2 — Workspace & Network**
Full channel system + lawyer lounge → co-counsel marketplace + referrals → document drafting + legal research AI → lawyer subscription tier → richer admin/analytics → e-signature + document collaboration.

**Phase 3 — Scale & Intelligence**
Firm-level supervision tooling → multi-jurisdiction expansion → advanced matching/pricing intelligence → API/partner integrations → white-label for firms.

---

## 10. Suggested Repo Structure

```
attorney/
├── backend/                 # Django
│   ├── config/              # settings, asgi (Channels), celery
│   ├── apps/
│   │   ├── accounts/        # users, profiles, verification
│   │   ├── matching/        # requests, availability, smart match
│   │   ├── consultations/
│   │   ├── matters/
│   │   ├── messaging/       # channels, messages, consumers
│   │   ├── huddles/         # LiveKit integration
│   │   ├── billing/         # invoices, time, trust ledger, payouts
│   │   ├── payments/        # provider adapters (paynow/ecocash/stripe)
│   │   ├── retainers/
│   │   ├── ai/              # provider adapters, intake, summaries
│   │   ├── compliance/      # conflicts, audit, data-protection
│   │   └── notifications/
│   └── docker/
├── frontend/                # Next.js (App Router, TS, Tailwind)
│   ├── app/
│   ├── components/
│   ├── lib/                 # api client, ws client, livekit
│   └── stores/
└── docker-compose.yml
```

---

## 11. Notes for Claude Code

- Start with `accounts` (custom User + role + profiles + verification) — everything depends on it.
- Stand up `messaging` (Channels) and `huddles` early; they're the differentiator and the riskiest integration, so de-risk them before polishing.
- Keep `payments` behind the `PaymentProvider` interface from day one — do **not** hardcode Stripe or Paynow.
- Trust ledger is internal double-entry; never represent client funds as platform revenue.
- All AI behind `AIProvider`; outputs always labelled as drafts; never client-facing advice unattended.
- Mobile-responsive is a hard requirement, not a nice-to-have — design the matter room + huddle UI mobile-first.
