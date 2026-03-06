<div align="center">

# PII Shield

**Automated PII detection and sanitization for Indian enterprise documents — encrypted, audited, and compliance-ready**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?logo=postgresql)](https://postgresql.org/)
[![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-purple?logo=letsencrypt)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

PII Shield scans uploaded documents for personally identifiable information using a **3-layer AI detection pipeline** (regex → Presidio + spaCy → BERT NER), sanitizes content using one of three modes (**Redact**, **Mask**, or **Tokenize**), and returns a clean version — all within a secure, role-gated web application with **AES-256-GCM encryption at rest**, **HMAC-SHA256 inter-service authentication**, and **full audit logging** built for Indian regulatory compliance (IT Act 2000, DPDPA 2023, RBI guidelines).

Files up to **50 MB** are supported. Large files (>5 MB) are automatically split into parallel chunks with **real-time chunk progress** visible in the UI.

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [Security](#-security--encryption) · [API Reference](#-api-reference) · [Contributing](#-contributing)

---

</div>

## Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Generate encryption keys](#2-generate-encryption-keys)
  - [3. Configure environment variables](#3-configure-environment-variables)
  - [4. Database setup](#4-database-setup)
  - [5. Start the Python service](#5-start-the-python-service)
  - [6. Start the Next.js app](#6-start-the-nextjs-app)
- [Security & Encryption](#-security--encryption)
  - [Encryption at Rest (AES-256-GCM)](#encryption-at-rest-aes-256-gcm)
  - [HMAC Service Authentication](#hmac-service-authentication)
  - [HTTPS / TLS](#https--tls)
  - [Security Dashboard](#security-dashboard)
- [PII Detection Pipeline](#-pii-detection-pipeline)
  - [Supported PII Types (16 Categories)](#supported-pii-types-16-categories)
  - [Masking Modes](#masking-modes)
  - [Supported File Formats](#supported-file-formats)
  - [Large File Chunked Processing](#large-file-chunked-processing)
- [Pages & UI](#-pages--ui)
- [API Reference](#-api-reference)
- [Role & Access Model](#-role--access-model)
- [Database Schema](#-database-schema)
- [Audit Logging](#-audit-logging)
- [Generating Demo Files](#-generating-demo-files)
- [Environment Variables](#-environment-variables)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

| Feature | Description |
|---|---|
| **3-Layer PII Detection** | Regex patterns → Presidio + spaCy NER → BERT transformer (graceful fallback) |
| **16 Indian PII Categories** | Aadhaar, PAN, UPI ID, IFSC, Indian phone, passport, credit/debit cards, CVV, bank account numbers, device IDs, biometric strings, and more |
| **Three Sanitization Modes** | Redact (`[REDACTED]`), Mask (`r****@g*****.com`), Tokenize (`<<EMAIL_001>>`) |
| **8 File Formats** | SQL, CSV, PDF, DOCX, TXT, JSON, PNG, JPG |
| **Large File Chunked Processing** | Files >5 MB are split into parallel chunks with real-time per-chunk progress UI |
| **AES-256-GCM Encryption at Rest** | All sensitive DB fields (file content, PII summaries, audit details, IP addresses) encrypted with key rotation support |
| **HMAC-SHA256 Service Auth** | Signed inter-service requests between Next.js and Python with timestamp freshness validation |
| **HTTPS Development Server** | Built-in `mkcert`-powered HTTPS (port 3000) + HTTP redirect (port 3001) |
| **Role-Based Access Control** | Admin (upload, view all, download original + sanitized) vs User (view & download sanitized only) |
| **Full Audit Trail** | Every login, upload, scan, view, download, and delete is logged with encrypted IP and timestamp |
| **AI Model Status Dashboard** | Real-time health monitoring of Presidio, spaCy, and BERT models |
| **Security Status Dashboard** | Live encryption status across all 4 layers (Browser → Server → Python → Database → At Rest) |
| **Side-by-Side Viewer** | Original vs sanitized content comparison on file detail pages |
| **Context-Aware Scoring** | Proximity boosting, label boosting, and column context for higher accuracy |
| **Google OAuth + Email Auth** | Better Auth with email/password and Google social login |
| **DPDPA / RBI Compliant** | Audit retention, encrypted PII, role-gated access, no PII exposed to unauthorized roles |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Browser                                   │
│       Next.js 16 App (React 19, TypeScript, Tailwind CSS 4)         │
│                                                                     │
│  /admin/*  ──── Dashboard, upload, file management, audit, users    │
│  /user/*   ──── Sanitized file list & downloads                     │
│  /api/*    ──── REST API routes (Next.js Route Handlers)            │
└──────────┬──────────────────────────┬───────────────────────────────┘
           │ Prisma ORM               │ HMAC-signed HTTP
           │ (AES-256-GCM             │ (X-Service-Signature +
           │  encrypted fields)       │  X-Service-Timestamp)
           ▼                          ▼
┌────────────────────────┐   ┌────────────────────────────────────────┐
│   PostgreSQL 15+       │   │      Python 3.10 FastAPI Service       │
│                        │   │           (port 8000)                  │
│  user, session,        │   │                                        │
│  account, verification │   │  POST /process       — file sanitize   │
│  file, auditLog        │   │  GET  /process-status — chunk progress │
│                        │   │  POST /detect-text   — raw text scan   │
│  Encrypted fields:     │   │  GET  /health        — model readiness │
│  • originalContent     │   │                                        │
│  • sanitizedContent    │   │  HMAC-SHA256 verification middleware   │
│  • piiSummary          │   │  30-second timestamp freshness window  │
│  • layerBreakdown      │   └────────────────────────────────────────┘
│  • confidenceBreakdown │                    │
│  • audit detail + IP   │       ┌────────────┴────────────┐
└────────────────────────┘       │   3-Layer PII Pipeline   │
                                 │                          │
                                 │  Layer 1: Regex          │
                                 │  Layer 2: Presidio+spaCy │
                                 │  Layer 3: BERT NER       │
                                 └──────────────────────────┘
```

**Request flow for a file upload:**

1. Admin selects a file + masking mode on the upload page
2. `POST /api/files` validates the file, encrypts `originalContent` with AES-256-GCM, stores the record as `PROCESSING`, and enqueues a background job
3. The background job writes the file to a temp path, generates an HMAC-SHA256 signature, and calls `POST http://localhost:8000/process`
4. The Python service verifies the HMAC signature, runs the 3-layer detection pipeline (chunking automatically if >5 MB), and returns a PII summary
5. The Next.js job encrypts the sanitized output and all PII metadata, then updates the DB record to `DONE`
6. The upload page polls `GET /api/files/{id}/status` every 3 seconds and auto-redirects to the detail page on completion

---

## 🛠 Tech Stack

### Frontend / API (Next.js)

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) with App Router |
| Language | TypeScript 5 |
| UI Library | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://radix-ui.com/) primitives |
| Styling | Tailwind CSS 4 + [tw-animate-css](https://github.com/bfrg/tw-animate-css) |
| Auth | [Better Auth](https://better-auth.com/) (email/password + Google OAuth) |
| ORM | [Prisma 7](https://prisma.io/) with PostgreSQL adapter (`@prisma/adapter-pg`) |
| Validation | Zod 4 |
| Charts | [Recharts](https://recharts.org/) |
| Panels | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) |
| Icons | [Lucide React](https://lucide.dev/) |
| Forms | [React Hook Form](https://react-hook-form.com/) |
| Toasts | [Sonner](https://sonner.emilkowal.dev/) |
| Encryption | AES-256-GCM (Node.js `crypto`) |
| Service Auth | HMAC-SHA256 request signing |

### Python Service

| Layer | Technology |
|---|---|
| Framework | [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn |
| PII Engine | [Microsoft Presidio](https://microsoft.github.io/presidio/) (analyzer + anonymizer) |
| NLP | [spaCy](https://spacy.io/) `en_core_web_sm` |
| Transformer | [dslim/bert-base-NER](https://huggingface.co/dslim/bert-base-NER) (optional, graceful fallback) |
| PDF | [PyMuPDF](https://pymupdf.readthedocs.io/) (fitz) |
| DOCX | [python-docx](https://python-docx.readthedocs.io/) |
| CSV | [pandas](https://pandas.pydata.org/) |
| OCR | [pytesseract](https://github.com/madmaze/pytesseract) + [Pillow](https://pillow.readthedocs.io/) (optional) |
| Auth | HMAC-SHA256 middleware with timestamp freshness |

### Infrastructure

| Layer | Technology |
|---|---|
| Database | PostgreSQL 15+ |
| Encryption at Rest | AES-256-GCM with key rotation |
| Transit Security | HMAC-SHA256 (service-to-service) + optional TLS (DB) |
| HTTPS Dev Server | [mkcert](https://github.com/FiloSottile/mkcert) certificates |

---

## 📁 Project Structure

```
pii-shield/
│
├── app/                              # Next.js App Router
│   ├── page.tsx                      # Landing page (Sign In / Sign Up tabs)
│   ├── layout.tsx                    # Root layout (Sonner toasts, theme)
│   ├── globals.css                   # Tailwind CSS 4 globals
│   │
│   ├── admin/                        # Admin-only pages (middleware-protected)
│   │   ├── layout.tsx                # Admin shell (sidebar + nav)
│   │   ├── dashboard/page.tsx        # Stats cards, recent files, AI & security status
│   │   ├── upload/page.tsx           # Drag-and-drop upload + masking mode + chunk progress
│   │   ├── files/
│   │   │   ├── page.tsx              # Searchable file list table
│   │   │   └── [id]/page.tsx         # File detail: side-by-side viewer + PII breakdown
│   │   ├── audit/page.tsx            # Filterable audit log with action tabs
│   │   └── users/page.tsx            # User management table
│   │
│   ├── user/                         # Standard user pages
│   │   ├── layout.tsx                # User shell (top nav)
│   │   └── files/page.tsx            # Sanitized file cards + download
│   │
│   ├── auth/
│   │   └── callback/page.tsx         # OAuth callback handler
│   │
│   └── api/                          # REST API (Next.js Route Handlers)
│       ├── health/route.ts           # Proxy → Python /health
│       ├── auth/[...all]/route.ts    # Better Auth catch-all
│       ├── files/
│       │   ├── route.ts              # POST (upload) · GET (list)
│       │   └── [id]/
│       │       ├── route.ts          # GET (detail) · DELETE
│       │       ├── status/route.ts   # GET (poll status + chunk progress)
│       │       ├── download/route.ts # GET (stream original or sanitized)
│       │       └── chunks/route.ts   # GET (chunk-level progress)
│       ├── admin/
│       │   └── encryption-status/route.ts  # GET (4-layer encryption status)
│       ├── users/route.ts            # GET (admin user list)
│       └── audit/route.ts            # GET (admin audit log, paginated)
│
├── components/
│   ├── AdminNav.tsx                  # Admin sidebar nav + AES-256-GCM badge
│   ├── UserNav.tsx                   # User top navbar
│   ├── SidebarNav.tsx                # Reusable sidebar with active state
│   ├── SignOutButton.tsx             # Logout button with loading state
│   ├── AIModelStatusCard.tsx         # Real-time AI model health card
│   ├── SecurityStatusCard.tsx        # 4-layer encryption status card
│   ├── SideBySideViewer.tsx          # Original vs sanitized content viewer
│   ├── PIISummaryCard.tsx            # PII breakdown by category
│   ├── FileUploader.tsx              # Drag-and-drop file uploader
│   ├── AuditTable.tsx                # Audit log table component
│   ├── GradientBlinds.tsx            # WebGL gradient animation (OGL)
│   ├── admin/
│   │   ├── AuditFilterTable.tsx      # Audit table with action filter tabs
│   │   └── FilesSearchTable.tsx      # File list table with search
│   └── ui/                           # shadcn/ui component library (60+ components)
│
├── lib/
│   ├── auth.ts                       # Better Auth config (email + Google OAuth)
│   ├── auth-client.ts                # Client-side auth hooks
│   ├── auth-helper.ts                # requireAdmin / requireAuth / logAction
│   ├── crypto.ts                     # AES-256-GCM encrypt/decrypt functions
│   ├── encryption.ts                 # Field-level encryption helpers
│   ├── db.ts                         # Prisma client singleton
│   ├── db-encrypted.ts               # Encrypted DB read/write wrappers
│   ├── get-encryption-status.ts      # Probe DB + Python service for encryption status
│   ├── hmac.ts                       # HMAC-SHA256 signature generation
│   ├── service-auth.ts               # Signed HTTP client for Python service
│   ├── job-queue.ts                  # In-memory async job queue
│   ├── constants.ts                  # File size limits, polling config
│   └── utils.ts                      # Shared utilities (cn, etc.)
│
├── python-service/                   # FastAPI PII detection microservice
│   ├── main.py                       # Entrypoint: /process, /process-status, /detect-text, /health
│   ├── requirements.txt
│   │
│   ├── detection/
│   │   ├── analyzer_engine.py        # 3-layer PIIAnalyzer singleton
│   │   ├── custom_recognizers.py     # Indian PII regex recognizers (12+ types)
│   │   ├── context_analyzer.py       # Proximity + label + density boosting
│   │   ├── confidence_scorer.py      # Deduplication & HIGH/MEDIUM/LOW scoring
│   │   ├── masker.py                 # Redact / Mask / Tokenize modes
│   │   └── preprocessor.py           # Text normalization + label extraction
│   │
│   ├── parsers/                      # Direct file processors (<5 MB)
│   │   ├── pdf_parser.py             # PyMuPDF span-level redaction
│   │   ├── docx_parser.py            # python-docx run-level replacement
│   │   ├── sql_parser.py             # SQL value string replacement
│   │   ├── csv_parser.py             # pandas column-by-column processing
│   │   ├── txt_parser.py             # Plain text chunked replacement
│   │   ├── json_parser.py            # Recursive JSON leaf replacement
│   │   └── image_parser.py           # OCR via pytesseract + PIL rectangle overlay
│   │
│   ├── chunking/                     # Chunked processors (>5 MB, parallel)
│   │   ├── orchestrator.py           # Decides direct vs chunked processing
│   │   ├── parallel_processor.py     # ThreadPoolExecutor orchestration
│   │   ├── csv_chunker.py            # Row-based split (10k rows/chunk)
│   │   ├── txt_chunker.py            # Paragraph-based split with overlap
│   │   ├── sql_chunker.py            # Statement-based split
│   │   ├── json_chunker.py           # Array/object-aware split
│   │   ├── pdf_chunker.py            # Page-based split (10 pages/chunk)
│   │   ├── docx_chunker.py           # Element-based split (200 paras/chunk)
│   │   └── image_chunker.py          # Grid-based OCR tiles (4×4, 50px overlap)
│   │
│   ├── processing/                   # In-memory chunked processing
│   │   └── chunked_processor.py      # Format-specific chunk processors
│   │
│   ├── middleware/
│   │   └── auth_middleware.py        # HMAC-SHA256 request verification
│   │
│   └── tests/                        # Test suite
│
├── scripts/
│   ├── generate-keys.ts              # Generate ENCRYPTION_KEY + INTERNAL_SERVICE_SECRET
│   ├── verify-encryption.ts          # Probe DB to verify fields are encrypted
│   ├── verify-encryption-setup.ts    # Check encryption configuration
│   └── test-transit-security.ts      # Test HMAC signing
│
├── prisma/
│   ├── schema.prisma                 # Database schema (encrypted field support)
│   ├── seed.ts                       # Seed admin + demo user
│   └── migrations/                   # Prisma migration history
│
├── certificates/                     # mkcert TLS certificates (gitignored)
│
├── demo-files/
│   └── generate_demo_files.py        # Generates realistic Indian PII demo files
│
├── server.ts                         # Custom HTTPS dev server (mkcert)
├── middleware.ts                      # Route protection (admin/user)
├── next.config.ts
├── prisma.config.ts
└── tsconfig.json
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | Or use [Bun](https://bun.sh/) |
| Python | 3.10+ | Windows Store Python is supported |
| PostgreSQL | 15+ | Local or remote (e.g. Supabase, Neon) |
| Tesseract OCR | Any | Optional — only needed for PNG/JPG uploads |
| mkcert | Any | Optional — only needed for HTTPS development |

---

### 1. Clone the repository

```bash
git clone https://github.com/your-org/pii-shield.git
cd pii-shield
```

---

### 2. Generate encryption keys

```bash
npx tsx scripts/generate-keys.ts
```

This generates secure random values for `ENCRYPTION_KEY`, `ENCRYPTION_KEY_VERSION`, `INTERNAL_SERVICE_SECRET`, and `BETTER_AUTH_SECRET`. Copy them into your `.env`.

---

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
# ── Database ────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/piishield"

# ── Encryption at Rest (AES-256-GCM) ───────────────────────────────────────
# Generate with: npx tsx scripts/generate-keys.ts
ENCRYPTION_KEY="<64 hex chars>"
ENCRYPTION_KEY_VERSION="1"

# ── Inter-Service Auth (HMAC-SHA256) ────────────────────────────────────────
INTERNAL_SERVICE_SECRET="<64 hex chars>"

# ── Better Auth ─────────────────────────────────────────────────────────────
BETTER_AUTH_SECRET="<64 hex chars>"
BETTER_AUTH_URL="https://localhost:3000"

# ── Google OAuth (optional) ─────────────────────────────────────────────────
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# ── Python service ───────────────────────────────────────────────────────────
PYTHON_SERVICE_URL="http://localhost:8000"
```

---

### 4. Database setup

```bash
# Install Node.js dependencies
npm install          # or: bun install

# Run Prisma migrations
npx prisma migrate dev

# Seed the database (creates admin@example.com / user@example.com)
npx prisma db seed
```

---

### 5. Start the Python service

```bash
cd python-service

# Create and activate virtual environment (recommended)
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Download the spaCy language model (one-time)
python -m spacy download en_core_web_sm

# Start the service
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

> **First start takes 30–60 seconds** while Presidio loads the spaCy model. The `/health` endpoint returns `"status": "loading"` until warmup completes — the upload page shows a "Checking service…" banner during this time.

**Verify the service is ready:**

```bash
curl http://localhost:8000/health
# {"status":"ok","service":"PII Detection","model_loaded":true,"models":{"presidio":true,"spacy_fast":true,"spacy_full":true}}
```

---

### 6. Start the Next.js app

**Option A — HTTP (simple):**

```bash
npm run dev          # or: bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Option B — HTTPS (recommended for full security):**

```bash
# Generate local TLS certificates (one-time)
mkcert -install
mkcert -key-file certificates/key.pem -cert-file certificates/cert.pem localhost 127.0.0.1

# Start with HTTPS
npm run dev:https    # or: bun run dev:https
```

Open [https://localhost:3000](https://localhost:3000). HTTP requests on port 3001 auto-redirect to HTTPS.

**Default seed credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `password123` |
| User | `user@example.com` | `password123` |

---

## 🔒 Security & Encryption

PII Shield implements defense-in-depth across four security layers:

```
Browser ──── HTTPS/TLS ────► Next.js Server ──── HMAC-SHA256 ────► Python Service
                                    │
                               AES-256-GCM
                                    │
                                    ▼
                              PostgreSQL ◄──── SSL/TLS (configurable)
```

### Encryption at Rest (AES-256-GCM)

All sensitive database fields are encrypted using **AES-256-GCM** with 128-bit IVs and 128-bit authentication tags.

**Encrypted fields:**

| Model | Fields |
|---|---|
| **File** | `originalContent`, `sanitizedContent`, `piiSummary`, `layerBreakdown`, `confidenceBreakdown` |
| **AuditLog** | `detail`, `ipAddress` |

**Storage format:** `iv_base64:authTag_base64:ciphertext_base64`

**Key rotation:** Each record tracks its `encryptionKeyVersion`. Increment `ENCRYPTION_KEY_VERSION` in `.env` when rotating keys — old records remain readable with the previous key.

**Backward compatibility:** Records written before encryption was enabled (plaintext) continue to work without re-encryption.

**Verify encryption:**

```bash
npx tsx scripts/verify-encryption.ts
npx tsx scripts/verify-encryption-setup.ts
```

### HMAC Service Authentication

All requests from Next.js to the Python service are signed using **HMAC-SHA256**:

- **Headers:** `X-Service-Signature` and `X-Service-Timestamp`
- **Payload:** `<timestamp_ms>.<JSON.stringify(body)>`
- **Key:** `INTERNAL_SERVICE_SECRET` (64 hex chars, decoded as binary)
- **Freshness:** Python middleware rejects signatures older than 30 seconds
- **Toggleable:** If the secret is unset, signing is disabled (for local dev without security)

### HTTPS / TLS

The built-in HTTPS dev server (`server.ts`) uses mkcert-generated certificates:

| Port | Protocol | Behavior |
|---|---|---|
| 3000 | HTTPS | Primary application server |
| 3001 | HTTP | Redirects all requests to `https://localhost:3000` |

### Security Dashboard

The admin dashboard at `/admin/dashboard` includes a **Security Status Card** that monitors all four encryption layers in real-time:

| Layer | Status |
|---|---|
| Browser → Server | HTTPS or HTTP (not encrypted) |
| Server → Python | HMAC-SHA256 or Unsigned |
| Server → Database | SSL (verify-full / require / prefer) or No TLS |
| Data at Rest | AES-256-GCM (Key Version N) or Not configured |

The status is fetched from `GET /api/admin/encryption-status` and auto-refreshes every 10 seconds.

---

## 🔍 PII Detection Pipeline

The Python service runs a **3-layer detection pipeline** on every document. Results from all layers are merged, deduplicated, and confidence-scored before masking is applied.

```
Input text
    │
    ├── Layer 1: Regex patterns
    │     Aadhaar, PAN, UPI, IFSC, Indian phone, credit/debit cards,
    │     CVV, SWIFT, passport, IP addresses, device IDs, biometric strings,
    │     bank account numbers, Aadhaar VID
    │
    ├── Layer 2: Presidio + spaCy NER
    │     PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION,
    │     CREDIT_CARD, DATE_TIME, URL, NRP
    │     + context-window boosting (proximity to label keywords)
    │     + column context inference for structured data (CSV, SQL)
    │
    └── Layer 3: BERT NER (optional)
          dslim/bert-base-NER — catches names and entities
          missed by en_core_web_sm
          Falls back silently if model unavailable.
    │
    ▼
Deduplication → Context-Aware Scoring → Confidence Tiering → Masker
    │
    ▼
Sanitized output + PII summary + layer breakdown + confidence breakdown
```

**Context-aware scoring** applies four heuristics to boost uncertain values:

1. **Label boost** — Values near identity labels ("Name:", "Aadhaar:") get higher scores
2. **Proximity boost** — Values near confirmed PII (PERSON, EMAIL) get boosted
3. **Density boost** — Regions with many PII entities boost neighboring uncertain values
4. **Column context** — CSV/SQL column headers inform expected PII types

### Supported PII Types (16 Categories)

| PII Type | Detection Layer | Notes |
|---|---|---|
| Aadhaar Number | Layer 1 (Regex) | Spaced, dashed, and plain 12-digit formats |
| Aadhaar VID | Layer 1 (Regex) | 16-digit virtual ID |
| PAN Card | Layer 1 (Regex) | `[A-Z]{3}[PCHABGJLFTE][A-Z]\d{4}[A-Z]` |
| UPI ID | Layer 1 (Regex) | `handle@bankcode` pattern |
| IFSC Code | Layer 1 (Regex) | `[A-Z]{4}0[A-Z0-9]{6}` |
| Indian Phone Number | Layer 1 (Regex) | +91 and 0-prefix 10-digit |
| Credit / Debit Card | Layer 1 (Regex) | 13–19 digit Luhn-format |
| CVV | Layer 1 (Regex) | 3–4 digits in card context |
| Passport Number | Layer 1 (Regex) | `[A-Z]\d{7}` |
| IP Address | Layer 1 (Regex) | IPv4 |
| Bank Account Number | Layer 1 (Regex) | 10–14 digits in banking context |
| Device ID | Layer 1 (Regex) | IMEI, MAC address, device identifiers |
| Biometric String | Layer 1 (Regex) | Fingerprint hashes, biometric identifiers |
| Person Name | Layer 2 + 3 | spaCy `PERSON` + BERT `PER` |
| Email Address | Layer 2 | Presidio `EMAIL_ADDRESS` |
| Physical Address / Location | Layer 2 + 3 | spaCy `GPE`/`LOC` + context boosting |
| Date of Birth | Layer 2 | Presidio `DATE_TIME` + age context |

### Masking Modes

| Mode | Example Input | Example Output |
|---|---|---|
| **Redact** | `rahul.sharma@gmail.com` | `[REDACTED]` |
| **Mask** | `rahul.sharma@gmail.com` | `r****.s*****@g*****.com` |
| **Tokenize** | `rahul.sharma@gmail.com` | `<<EMAIL_ADDRESS_001>>` |

Tokenize mode also returns a `token_map` JSON object so the original values can be restored if needed.

### Supported File Formats

| Format | Parser | Notes |
|---|---|---|
| `.sql` | Custom regex | Replaces values inside SQL statements |
| `.csv` | pandas | Row-level, column-by-column replacement with column context |
| `.txt` | Plain string replace | Full document scan with 50k-char chunking |
| `.json` | Recursive traversal | Handles nested objects and arrays, sanitizes all string leaves |
| `.pdf` | PyMuPDF span-level | Text span redaction; preserves page layout |
| `.docx` | python-docx | Cross-run replacement; preserves run formatting, tables, headers/footers |
| `.png / .jpg` | Tesseract OCR + PIL | Bounding-box detection + rectangle redaction overlay |

### Large File Chunked Processing

Files larger than **5 MB** are automatically split into chunks and processed in parallel using `ThreadPoolExecutor`:

| Format | Chunking Strategy | Chunk Size |
|---|---|---|
| CSV | Row-based split | 10,000 rows/chunk |
| TXT | Paragraph-based split | With overlap context markers |
| SQL | Statement-based split | At semicolons with overlap comments |
| JSON | Array/object-aware split | 1,000 items/chunk |
| PDF | Page-based split | 10 pages/chunk |
| DOCX | Element-based split | 200 paragraphs/chunk |
| PNG/JPG | Grid-based tiles | 4×4 grid, 50px overlap |

**Overlap context** (500 chars) is prepended/appended to each chunk to ensure cross-boundary PII is detected without duplication. All chunking is done in-memory — no temporary files are written.

The upload page shows **real-time per-chunk progress** with smooth fill animations (0% → 90% decelerating, snap to 100% on completion) and the pipeline configuration used (BERT + spaCy models).

---

## 🖥 Pages & UI

### Authentication (`/`)

- **Sign In / Sign Up tabs** with email + password
- **Google OAuth** social login button
- Password visibility toggle
- Animated **WebGL gradient background** (GradientBlinds component using OGL)
- Auto-redirects to role-based landing page after login

### Admin Dashboard (`/admin/dashboard`)

- **4 stat cards:** Total Files, Processed Files, Total Users, Total PII Found
- **Recent Files table** — 6 most recent uploads with status badges (Processing / Done / Failed)
- **AI Model Status Card** — Real-time health of Presidio, spaCy Fast, spaCy Full models (auto-polls `/api/health`)
- **Security Status Card** — Live 4-layer encryption status (auto-polls `/api/admin/encryption-status`)

### Upload File (`/admin/upload`)

- **Drag-and-drop** file uploader with click-to-browse
- **Format support:** PDF, DOCX, SQL, CSV, TXT, JSON, PNG, JPG (up to 50 MB)
- **Masking mode selector:** Redact / Mask / Tokenize with descriptions
- **PII detection categories** shown before upload (16 types)
- **Service health check** — Shows "checking service" banner until Python service is ready
- **Chunk progress visualization** for large files:
  - Per-chunk status cards (Pending → Processing → Done/Failed)
  - Smooth animated progress bars
  - Pipeline configuration display

### All Files (`/admin/files`)

- **Searchable table** with columns: filename, type, status, PII count, masking mode, upload date, uploader email
- Click any row to open the file detail page

### File Detail (`/admin/files/[id]`)

- **Side-by-side viewer** — Original vs sanitized content (decrypted on-the-fly)
- **PII Summary Card** — Breakdown by category with counts
- **Layer Breakdown** — Which detection layers found each PII instance (Regex / spaCy / Presidio / BERT)
- **Confidence Breakdown** — Distribution across High / Medium / Low tiers
- **Processing Info** — Chunking metadata, pipeline config, execution time
- **Download buttons** — Original (admin only) + Sanitized (all users)
- **Delete file** button (admin only)

### Audit Log (`/admin/audit`)

- **Filter tabs:** ALL | UPLOAD | SCAN | DOWNLOAD | VIEW | DELETE | LOGIN | LOGOUT
- **Table columns:** Timestamp (IST), user email, action (color-coded), filename, detail, IP address
- **Pagination** — Page + limit query params (default 50, max 200)
- Audit detail and IP addresses are **decrypted** before display

### Users (`/admin/users`)

- **User table** with avatar, name, email, role (color-coded badge), join date, files uploaded count

### User Files (`/user/files`)

- **Search bar** to filter by filename
- **File cards** with icon, name, PII removed count, processed date, download button
- Download provides **sanitized version only** (no access to originals)
- Skeleton loading states + empty state UI

---

## 📡 API Reference

All API routes are protected by session cookies. Requests must include the Better Auth session cookie obtained via `POST /api/auth/sign-in`.

### Files

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/files` | Admin | Upload a file and start PII processing |
| `GET` | `/api/files` | Admin / User | List files (Admin: all; User: own DONE files) |
| `GET` | `/api/files/:id` | Admin / User | File detail with PII summary (Admin: includes content) |
| `GET` | `/api/files/:id/status` | Admin | Poll processing status + chunk progress |
| `GET` | `/api/files/:id/chunks` | Admin | Get chunk-level processing progress |
| `GET` | `/api/files/:id/download?type=original` | Admin | Download original file (decrypted) |
| `GET` | `/api/files/:id/download?type=sanitized` | Admin / User | Download sanitized file (decrypted) |
| `DELETE` | `/api/files/:id` | Admin | Delete file record and audit log |

**Upload request (multipart/form-data):**

```
POST /api/files
Content-Type: multipart/form-data

file=<binary>
mode=redact | mask | tokenize   (default: redact)
```

**Upload response `201`:**

```json
{
  "file": {
    "id": "cm8x...",
    "originalName": "employees.sql",
    "fileType": "sql",
    "status": "PROCESSING",
    "maskingMode": "redact",
    "uploadedAt": "2026-03-06T10:00:00.000Z"
  },
  "warning": "File is 6.3 MB. Processing may be slow for large files."
}
```

**Status response when `DONE`:**

```json
{
  "status": "DONE",
  "totalPiiFound": 47,
  "piiSummary": { "IN_AADHAAR": 5, "EMAIL_ADDRESS": 8, "IN_PAN": 5 },
  "layerBreakdown": { "regex": 18, "presidio_spacy": 22, "indic_bert": 7 },
  "confidenceBreakdown": { "high": 38, "medium": 9 },
  "processedAt": "2026-03-06T10:00:08.000Z"
}
```

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Proxy to Python service health check |

```json
{
  "available": true,
  "status": "ok",
  "model_loaded": true,
  "models": {
    "presidio": true,
    "spacy_fast": true,
    "spacy_full": true,
    "errors": []
  }
}
```

### Encryption Status

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/admin/encryption-status` | Admin | Full 4-layer encryption status |

```json
{
  "encryptionAtRest": {
    "status": "active",
    "algorithm": "AES-256-GCM",
    "keyVersion": 1,
    "fieldsEncrypted": ["originalContent", "sanitizedContent", "piiSummary", "layerBreakdown", "confidenceBreakdown"],
    "sampleChecked": true
  },
  "encryptionInTransit": {
    "browserToServer": "HTTPS",
    "serverToPython": "HMAC-SHA256",
    "serverToDatabase": "SSL (verify-full)"
  }
}
```

### Audit

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/audit?page=1&limit=50` | Admin | Paginated audit log (max 200 per page) |

### Users

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/users` | Admin | List all users with file counts and roles |

### Python Service (Internal)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/process` | HMAC | Start async file sanitization (returns job_id) |
| `GET` | `/process-status/:job_id` | None | Poll job progress with chunk-level detail |
| `POST` | `/detect-text` | HMAC | Synchronous raw text PII detection |
| `GET` | `/health` | None | Model readiness + status |

---

## 🔐 Role & Access Model

```
┌──────────────────────────────────────────────────┐
│                     Visitor                       │
│  / (sign-in page)                                 │
│  POST /api/auth/sign-in                           │
│  POST /api/auth/sign-up                           │
│  Google OAuth flow                                │
└────────────────┬─────────────────────────────────┘
                 │ authenticated
         ┌───────┴────────┐
         ▼                ▼
    Role: ADMIN      Role: USER
    /admin/*         /user/*

    Can:              Can:
    - Upload files    - View own DONE files
    - View all        - Download sanitized
      files             version only
    - Download        - No access to
      original +        /admin routes
      sanitized         or original files
    - View audit      - API returns 403
      logs              on type=original
    - Manage users
    - View security
      & AI status
    - Delete files
```

Route protection is enforced at two levels:

1. **Middleware** (`middleware.ts`) — lightweight cookie check; redirects unauthenticated users to `/` with `?redirect=` query param
2. **API route guards** — `requireAdmin()` / `requireAuth()` do a full DB session lookup, re-query the user's role, and throw `401`/`403` on mismatch

---

## 🗃 Database Schema

```
User ─────┬──── Session     (Better Auth — cookie-based sessions)
          ├──── Account     (OAuth providers — Google)
          ├──── File[]
          └──── AuditLog[]

Verification                 (Better Auth — email verification tokens)

File
  id                    String     CUID primary key
  originalName          String     filename as uploaded
  fileType              String     pdf | docx | sql | csv | txt | json | png | jpg
  originalContent       Text?      base64 bytes — 🔐 AES-256-GCM encrypted
  sanitizedContent      Text?      base64 bytes — 🔐 AES-256-GCM encrypted
  status                Enum       PROCESSING | DONE | FAILED
  maskingMode           String     redact | mask | tokenize
  piiSummary            Text?      JSON — 🔐 AES-256-GCM encrypted
  totalPiiFound         Int        aggregate PII span count
  layerBreakdown        Text?      JSON — 🔐 AES-256-GCM encrypted
  confidenceBreakdown   Text?      JSON — 🔐 AES-256-GCM encrypted
  processingInfo        Text?      JSON: chunking metadata, pipeline config
  uploadedBy            String     → User.id
  uploadedAt            DateTime
  processedAt           DateTime?
  encryptionKeyVersion  Int        tracks which key version encrypted this record

AuditLog
  id                    String
  userId                String     → User.id
  action                Enum       LOGIN | LOGOUT | UPLOAD | SCAN | DOWNLOAD | VIEW | DELETE
  fileId                String?    → File.id
  detail                String?    🔐 AES-256-GCM encrypted
  ipAddress             String?    🔐 AES-256-GCM encrypted
  encryptionKeyVersion  Int        tracks which key version encrypted this record
  timestamp             DateTime
```

> `originalContent` and `sanitizedContent` are **never** fetched in list queries — only in the single-file detail and download routes — to keep response sizes small.

---

## 🕵️ Audit Logging

Every significant action is recorded automatically with **encrypted detail and IP fields**:

| Action | Trigger |
|---|---|
| `LOGIN` | Better Auth session created (database hook) |
| `LOGOUT` | Session deleted (database hook) |
| `UPLOAD` | File record created via `POST /api/files` |
| `SCAN` | PII processing completed or failed (includes error detail on failure) |
| `DOWNLOAD` | User downloads original or sanitized file |
| `VIEW` | File detail page loaded |
| `DELETE` | File record removed |

The complete audit trail is visible at `/admin/audit` with **action filter tabs** and **pagination**. All encrypted fields (`detail`, `ipAddress`) are decrypted on-the-fly before display.

---

## 🎭 Generating Demo Files

The `demo-files/` directory contains a script that generates realistic Indian-PII-laden files using [Faker](https://faker.readthedocs.io/) with the `en_IN` locale:

```bash
cd demo-files
pip install faker fpdf2 python-docx
python generate_demo_files.py
```

**Generated files:**

| File | PII Instances | Type of PII |
|---|---|---|
| `demo_users.sql` | 40 | 5-row INSERT with Aadhaar, PAN, card, CVV, expiry, email, phone |
| `demo_customers.csv` | 45 | 5-row CSV with full PII + address, UPI, IFSC, account number |
| `demo_kyc.docx` | 12 | Formatted KYC form with table layout |
| `demo_notes.txt` | 13 | Meeting notes with naturally embedded PII (IP, MAC, fingerprint hash) |
| `demo_report.pdf` | 11 | Styled HR report with employee and bank details |
| **Total** | **121** | |

All values use a fixed random seed (`42`) for reproducible results across runs.

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (supports `sslmode=verify-full`) |
| `BETTER_AUTH_SECRET` | ✅ | — | 256-bit secret for signing session tokens |
| `BETTER_AUTH_URL` | ✅ | — | Canonical public URL of the Next.js app |
| `ENCRYPTION_KEY` | ✅ | — | 64 hex chars (32 bytes) — AES-256-GCM encryption key |
| `ENCRYPTION_KEY_VERSION` | ❌ | `1` | Current key version (increment on key rotation) |
| `INTERNAL_SERVICE_SECRET` | ❌ | — | 64 hex chars — HMAC-SHA256 key for Python service auth |
| `GOOGLE_CLIENT_ID` | ❌ | — | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ❌ | — | Google OAuth 2.0 client secret |
| `PYTHON_SERVICE_URL` | ❌ | `http://localhost:8000` | Base URL of the FastAPI PII service |
| `NODE_ENV` | ❌ | `development` | `development` or `production` |

**Quick setup:**

```bash
npx tsx scripts/generate-keys.ts
# Outputs ready-to-paste values for ENCRYPTION_KEY, INTERNAL_SERVICE_SECRET, BETTER_AUTH_SECRET
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository and create your feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Install dependencies** and make your changes

3. **Test** your changes using the demo files:
   ```bash
   cd demo-files && python generate_demo_files.py
   # Upload the generated files through the UI and verify detection results
   ```

4. **Verify encryption** after any DB schema changes:
   ```bash
   npx tsx scripts/verify-encryption.ts
   ```

5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add XLSX parser
   fix: handle empty SQL INSERT statements
   docs: update API reference
   ```

6. **Open a Pull Request** with a clear description of the problem and solution

### Code Style

- **TypeScript**: strict mode, no `any` — use `unknown` + type guards
- **Python**: PEP 8, type hints on all public functions, module-level docstrings on all classes
- List query `select` clauses must **never** include `originalContent` or `sanitizedContent`
- All sensitive fields must be encrypted before writing to the database

### How to add a new file format

1. Create `python-service/parsers/your_parser.py` with a `process_your_format(input_path, output_path, mode)` function returning the standard summary dict: `{ pii_summary, layer_breakdown, confidence_breakdown, total_pii }`
2. Create `python-service/chunking/your_chunker.py` if the format supports chunked processing
3. Register it in `python-service/main.py` → `_dispatch()`
4. Add the file extension to `ALLOWED_EXTENSIONS` in `app/api/files/route.ts`
5. Add it to `ACCEPT` and `SUPPORTED_FORMATS` in `app/admin/upload/page.tsx`

### How to add a new PII recognizer

1. Create a class in `python-service/detection/custom_recognizers.py` that extends `presidio_analyzer.PatternRecognizer`
2. Add an instance to the list returned by `get_custom_recognizers()`
3. Add the entity type string to the list returned by `get_all_entities()`

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Built with ❤️ for the HackaMined 2026 Hackathon

</div>
