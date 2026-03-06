<div align="center">

# PII Shield

**Automated PII detection and sanitization for Indian enterprise documents — up to 100 MB**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)](https://python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?logo=postgresql)](https://postgresql.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

PII Shield scans uploaded files for personally identifiable information, sanitizes the content using one of three configurable modes (Redact, Mask, or Tokenize), and returns a clean version of the file — all within a secure, role-gated web application built for Indian regulatory compliance (IT Act 2000, DPDPA 2023, RBI guidelines).

Files under 10 MB are processed in a single pass. Files between 10 MB and 100 MB are automatically split into parallel chunks, processed concurrently, and merged — with live chunk progress visible in both the upload UI and the file detail page.

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [Large File Processing](#-large-file-processing) · [API Reference](#-api-reference) · [Contributing](#-contributing)

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
  - [2. Configure environment variables](#2-configure-environment-variables)
  - [3. Database setup](#3-database-setup)
  - [4. Start the Python service](#4-start-the-python-service)
  - [5. Start the Next.js app](#5-start-the-nextjs-app)
- [PII Detection Pipeline](#-pii-detection-pipeline)
  - [Supported PII Types](#supported-pii-types)
  - [Masking Modes](#masking-modes)
  - [Supported File Formats](#supported-file-formats)
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
| **3-Layer PII Detection** | Regex patterns → Presidio + spaCy NER → indic-bert transformer (graceful fallback) |
| **Indian PII Specialization** | Aadhaar, PAN, UPI ID, IFSC codes, Indian phone numbers, passport, Indian addresses |
| **Three Sanitization Modes** | Redact (`[REDACTED]`), Mask (`j***@g***.com`), Tokenize (`<<EMAIL_001>>`) |
| **8 File Formats** | SQL, CSV, PDF, DOCX, TXT, JSON, PNG, JPG |
| **Large File Support (up to 100 MB)** | Files >10 MB are split into chunks and processed in parallel; results are merged automatically |
| **Chunk Progress UI** | Upload page shows live chunk progress for large files; file detail page shows a "Large File Processing" info card |
| **Role-Based Access** | Admin (upload, view all, download original + sanitized) vs User (view & download sanitized only) |
| **Full Audit Trail** | Every login, upload, scan, view, and download is logged with IP and timestamp |
| **Real-Time Progress** | Upload page polls file status and auto-redirects to the detail view on completion |
| **Service Health Banner** | Upload page checks Python service readiness before allowing uploads |
| **DPDPA / RBI Compliant** | Audit retention, PII never exposed to unauthorized roles |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│   Next.js 16 App (React 19, TypeScript, Tailwind CSS 4)     │
│                                                             │
│  /admin/*  ──── Admin dashboard, file management, audit     │
│  /user/*   ──── User file list & sanitized downloads        │
│  /api/*    ──── REST API routes (Next.js Route Handlers)    │
└──────────────┬──────────────────────┬───────────────────────┘
               │ Prisma ORM           │ HTTP fetch (internal)
               ▼                      ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│   PostgreSQL 15+     │   │     Python 3.10 FastAPI Service  │
│                      │   │          (port 8000)             │
│  user, session,      │   │                                  │
│  file, auditLog      │   │  POST /process   — sanitize file │
│                      │   │  POST /detect-text — raw text    │
│                      │   │  GET  /health    — readiness     │
└──────────────────────┘   └──────────────────────────────────┘
                                        │
                           ┌────────────┴────────────┐
                           │   3-Layer PII Pipeline   │
                           │                          │
                           │  Layer 1: Regex          │
                           │  Layer 2: Presidio+spaCy │
                           │  Layer 3: indic-bert NER │
                           └──────────────────────────┘
```

**Request flow for a file upload:**

1. Admin drops a file onto the upload page
2. Next.js API (`POST /api/files`) stores the file record as `PROCESSING` and enqueues a background job
3. The background job writes the file to a temp path, then calls `POST http://localhost:8000/process`
4. The Python service runs the 3-layer detection pipeline, writes the sanitized file, and returns a PII summary
5. The background job updates the DB record to `DONE` with all PII metadata
6. The upload page polls `GET /api/files/{id}/status` every 1.5 s and redirects to the detail page on completion

---

## 🛠 Tech Stack

### Frontend / API (Next.js)

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) with App Router |
| Language | TypeScript 5 |
| UI | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://radix-ui.com/) primitives |
| Styling | Tailwind CSS 4 |
| Auth | [Better Auth](https://better-auth.com/) (email/password + Google OAuth) |
| ORM | [Prisma 7](https://prisma.io/) with PostgreSQL adapter |
| Validation | Zod |
| Icons | Lucide React |

### Python Service

| Layer | Technology |
|---|---|
| Framework | [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn |
| PII Engine | [Microsoft Presidio](https://microsoft.github.io/presidio/) |
| NLP | [spaCy](https://spacy.io/) `en_core_web_sm` |
| Transformer | [indic-bert](https://huggingface.co/ai4bharat/indic-bert) (optional) |
| PDF | [PyMuPDF](https://pymupdf.readthedocs.io/) |
| DOCX | [python-docx](https://python-docx.readthedocs.io/) |
| OCR | [pytesseract](https://github.com/madmaze/pytesseract) (optional, for image files) |

---

## 📁 Project Structure

```
pii-shield/
│
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Sign-in / landing page
│   ├── layout.tsx                # Root layout
│   ├── globals.css
│   │
│   ├── admin/                    # Admin-only pages (middleware-protected)
│   │   ├── dashboard/page.tsx    # Stats: total files, users, PII found
│   │   ├── upload/page.tsx       # Drag-and-drop upload + mode selector
│   │   ├── files/
│   │   │   ├── page.tsx          # Searchable file list table
│   │   │   └── [id]/page.tsx     # File detail: PII breakdown + downloads
│   │   ├── audit/page.tsx        # Filterable audit log table
│   │   └── users/page.tsx        # User management table
│   │
│   ├── user/
│   │   └── files/page.tsx        # User view: DONE files + sanitized download
│   │
│   └── api/                      # Next.js Route Handlers
│       ├── health/route.ts        # Proxy to Python /health
│       ├── auth/[...all]/         # Better Auth catch-all handler
│       ├── files/
│       │   ├── route.ts           # POST (upload) · GET (list)
│       │   └── [id]/
│       │       ├── route.ts       # GET (detail) · DELETE
│       │       ├── status/route.ts# GET (poll status)
│       │       └── download/route.ts # GET (stream original or sanitized)
│       ├── users/route.ts         # GET (admin user list)
│       └── audit/route.ts         # GET (admin audit log)
│
├── components/
│   ├── SidebarNav.tsx             # Collapsible sidebar navigation
│   ├── GradientBlinds.tsx         # Animated hero background
│   └── ui/                        # shadcn/ui component library
│
├── lib/
│   ├── auth.ts                    # Better Auth configuration
│   ├── auth-client.ts             # Client-side Better Auth hooks
│   ├── auth-helper.ts             # requireAdmin / requireAuth / logAction
│   ├── db.ts                      # Prisma client singleton
│   ├── job-queue.ts               # In-memory async job queue
│   └── utils.ts                   # Shared utilities
│
├── python-service/                # FastAPI PII detection microservice
│   ├── main.py                    # App entrypoint, /process · /health
│   ├── requirements.txt
│   │
│   ├── detection/
│   │   ├── analyzer_engine.py     # 3-layer PIIAnalyzer (singleton)
│   │   ├── custom_recognizers.py  # Indian PII regex recognizers
│   │   ├── context_analyzer.py    # Label-pair & proximity boosting
│   │   ├── confidence_scorer.py   # Deduplication & score thresholding
│   │   └── masker.py              # Redact / Mask / Tokenize modes
│   │
│   └── parsers/
│       ├── pdf_parser.py          # PyMuPDF span-level redaction
│       ├── docx_parser.py         # python-docx paragraph-level replacement
│       ├── sql_parser.py          # Regex-based SQL value replacement
│       ├── csv_parser.py          # pandas row-level sanitization
│       ├── txt_parser.py          # Plain text replacement
│       ├── json_parser.py         # Recursive JSON value replacement
│       └── image_parser.py        # OCR via pytesseract + PIL overlay
│
├── prisma/
│   ├── schema.prisma              # Database schema
│   ├── seed.ts                    # Seed admin + demo user
│   └── migrations/                # Prisma migration history
│
├── demo-files/
│   └── generate_demo_files.py     # Generates 5 realistic Indian PII demo files
│
├── middleware.ts                   # Route protection (admin/user)
├── next.config.ts
├── tailwind.config.ts
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

---

### 1. Clone the repository

```bash
git clone https://github.com/your-org/pii-shield.git
cd pii-shield
```

---

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
# ── Database ────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/piishield"

# ── Better Auth ─────────────────────────────────────────────────────────────
# Generate with: openssl rand -hex 32
BETTER_AUTH_SECRET="your-secret-here"
BETTER_AUTH_URL="http://localhost:3000"

# ── Google OAuth (optional) ─────────────────────────────────────────────────
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# ── Python service ───────────────────────────────────────────────────────────
PYTHON_SERVICE_URL="http://localhost:8000"
```

---

### 3. Database setup

```bash
# Install Node.js dependencies
npm install          # or: bun install

# Run Prisma migrations
npx prisma migrate dev

# Seed the database (creates admin@example.com / user@example.com)
npx prisma db seed
```

---

### 4. Start the Python service

```bash
cd python-service

# Install Python dependencies
pip install -r requirements.txt

# Download the spaCy language model (one-time)
python -m spacy download en_core_web_sm

# Start the service
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

> **First start takes 30–60 seconds** while Presidio loads the spaCy model. The `/health` endpoint returns `"model_loaded": false` until warmup completes — the upload page shows a "Checking service…" banner during this time.

**Verify the service is ready:**

```bash
curl http://localhost:8000/health
# {"status":"ok","service":"PII Detection","model_loaded":true,"indic_bert_loaded":false}
```

---

### 5. Start the Next.js app

```bash
# From the project root
npm run dev          # or: bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Default seed credentials:**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `password123` |
| User | `user@example.com` | `password123` |

---

## 🔍 PII Detection Pipeline

The Python service runs a **3-layer detection pipeline** on every document. Results from all layers are merged, deduplicated, and confidence-scored before masking is applied.

```
Input text
    │
    ├── Layer 1: Regex patterns
    │     Aadhaar, PAN, UPI, IFSC, Indian phone, credit/debit cards,
    │     CVV, SWIFT, passport, IP addresses, device IDs
    │
    ├── Layer 2: Presidio + spaCy NER
    │     PERSON, EMAIL_ADDRESS, PHONE_NUMBER, LOCATION,
    │     CREDIT_CARD, DATE_TIME, URL, NRP
    │     + context-window boosting (proximity to label keywords)
    │
    └── Layer 3: indic-bert NER (optional)
          ai4bharat/indic-bert — catches Indian names and
          entities missed by en_core_web_sm
          Falls back silently if model unavailable.
    │
    ▼
Deduplication → Confidence Scoring → Masker
    │
    ▼
Sanitized output + PII summary JSON
```

### Supported PII Types

| PII Type | Detection Layer | Notes |
|---|---|---|
| Aadhaar Number | Layer 1 (Regex) | Spaced, dashed, and plain 12-digit formats |
| PAN Card | Layer 1 (Regex) | `[A-Z]{3}[PCHABGJLFTE][A-Z]\d{4}[A-Z]` |
| UPI ID | Layer 1 (Regex) | `handle@bankcode` pattern |
| IFSC Code | Layer 1 (Regex) | `[A-Z]{4}0[A-Z0-9]{6}` |
| Indian Phone Number | Layer 1 (Regex) | +91 and 0-prefix 10-digit |
| Credit / Debit Card | Layer 1 (Regex) | 13–19 digit Luhn-format |
| CVV | Layer 1 (Regex) | 3–4 digits in card context |
| Passport Number | Layer 1 (Regex) | `[A-Z]\d{7}` |
| IP Address | Layer 1 (Regex) | IPv4 |
| Bank Account Number | Layer 1 (Regex) | 10–14 digits in banking context |
| Person Name | Layer 2 + 3 | spaCy `PERSON` + indic-bert `PER` |
| Email Address | Layer 2 | Presidio `EMAIL_ADDRESS` |
| Physical Address | Layer 2 | spaCy `GPE`/`LOC` + context boosting |
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
| `.sql` | Custom regex | Replaces values inside SQL `INSERT` statements |
| `.csv` | pandas | Row-level, column-by-column replacement |
| `.txt` | Plain string replace | Full document scan |
| `.json` | Recursive traversal | Handles nested objects and arrays |
| `.pdf` | PyMuPDF span-level | Redacts text spans; preserves page layout |
| `.docx` | python-docx paragraph-level | Cross-run replacement; preserves run formatting |
| `.png / .jpg` | Tesseract OCR + PIL | Requires Tesseract installed locally |

---

## 📡 API Reference

All API routes are protected. Requests must include the Better Auth session cookie obtained from `POST /api/auth/sign-in`.

### Files

| Method | Path | Role | Description |
|---|---|---|---|
| `POST` | `/api/files` | Admin | Upload a file and start PII processing |
| `GET` | `/api/files` | Admin / User | List files (Admin: all; User: DONE only) |
| `GET` | `/api/files/:id` | Admin / User | File detail with full PII summary |
| `GET` | `/api/files/:id/status` | Admin | Poll processing status |
| `GET` | `/api/files/:id/download?type=original` | Admin | Download original file |
| `GET` | `/api/files/:id/download?type=sanitized` | Admin / User | Download sanitized file |
| `DELETE` | `/api/files/:id` | Admin | Delete file record |

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
  "indic_bert_loaded": false
}
```

### Audit

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/audit` | Admin | Full audit log (up to 100 most recent entries) |

### Users

| Method | Path | Role | Description |
|---|---|---|---|
| `GET` | `/api/users` | Admin | List all users with file counts and roles |

---

## 🔐 Role & Access Model

```
┌──────────────────────────────────────────────┐
│                   Visitor                    │
│  / (sign-in page)                            │
│  POST /api/auth/sign-in                      │
└───────────────┬──────────────────────────────┘
                │ authenticated
        ┌───────┴────────┐
        ▼                ▼
   Role: ADMIN      Role: USER
   /admin/*         /user/*

   Can:             Can:
   - Upload files   - View DONE files
   - View all       - Download sanitized
     files            version only
   - Download       - No access to
     original +       /admin routes
     sanitized        or original files
   - View audit     - API returns 403
     logs             on type=original
   - Manage users
```

Route protection is enforced at two levels:

1. **Middleware** (`middleware.ts`) — lightweight cookie check; redirects unauthenticated users to `/`
2. **API route guards** — `requireAdmin()` / `requireAuth()` do a full DB session lookup and throw `401`/`403` on mismatch

---

## 🗃 Database Schema

```
User ─────┬──── Session  (Better Auth)
          ├──── Account  (OAuth providers)
          ├──── File[]
          └──── AuditLog[]

File
  id                  String    CUID primary key
  originalName        String    filename as uploaded
  fileType            String    pdf | docx | sql | csv | txt | json | png | jpg
  originalContent     Text?     base64 bytes (excluded from list queries)
  sanitizedContent    Text?     base64 bytes (excluded from list queries)
  status              Enum      PROCESSING | DONE | FAILED
  maskingMode         String    redact | mask | tokenize
  piiSummary          Text?     JSON: { entity_type: count }
  totalPiiFound       Int       aggregate PII span count
  layerBreakdown      Text?     JSON: { regex, presidio_spacy, indic_bert }
  confidenceBreakdown Text?     JSON: { high, medium }
  uploadedBy          String    → User.id
  uploadedAt          DateTime
  processedAt         DateTime?

AuditLog
  id          String
  userId      String    → User.id
  action      Enum      LOGIN | LOGOUT | UPLOAD | SCAN | DOWNLOAD | VIEW | DELETE
  fileId      String?   → File.id
  detail      String?   human-readable description / error message
  ipAddress   String?
  timestamp   DateTime
```

> `originalContent` and `sanitizedContent` are never fetched in list queries — only in the single-file detail and download routes — to keep response sizes small.

---

## 🕵️ Audit Logging

Every significant action is recorded automatically:

| Action | Trigger |
|---|---|
| `LOGIN` | Better Auth session created (database hook) |
| `LOGOUT` | Session deleted (database hook) |
| `UPLOAD` | File record created via `POST /api/files` |
| `SCAN` | PII processing completed or failed (includes error detail on failure) |
| `DOWNLOAD_ORIGINAL` | Admin downloads the original file |
| `DOWNLOAD_SANITIZED` | Any authenticated user downloads the sanitized file |
| `VIEW` | File detail page loaded |
| `DELETE` | File record removed |

The complete audit trail is visible at `/admin/audit` and stored indefinitely in the database.

---

## 🎭 Generating Demo Files

The `demo-files/` directory contains a script that generates 5 realistic Indian-PII-laden files using [Faker](https://faker.readthedocs.io/) with the `en_IN` locale:

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
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | ✅ | — | 256-bit secret for signing session tokens |
| `BETTER_AUTH_URL` | ✅ | — | Canonical public URL of the Next.js app |
| `GOOGLE_CLIENT_ID` | ❌ | — | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | ❌ | — | Google OAuth 2.0 client secret |
| `PYTHON_SERVICE_URL` | ❌ | `http://localhost:8000` | Base URL of the FastAPI PII service |

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

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat: add XLSX parser
   fix: handle empty SQL INSERT statements
   docs: update API reference
   ```

5. **Open a Pull Request** with a clear description of the problem and solution

### Code Style

- **TypeScript**: strict mode, no `any` — use `unknown` + type guards
- **Python**: PEP 8, type hints on all public functions, module-level docstrings on all classes
- List query `select` clauses must **never** include `originalContent` or `sanitizedContent`

### How to add a new file format

1. Create `python-service/parsers/your_parser.py` with a `process_your_format(input_path, output_path, mode)` function returning the standard summary dict: `{ pii_summary, layer_breakdown, confidence_breakdown, total_pii }`
2. Register it in `python-service/main.py` → `_dispatch()`
3. Add the file extension to `ALLOWED_EXTENSIONS` in `app/api/files/route.ts`
4. Add it to `ACCEPT` and `SUPPORTED_FORMATS` in `app/admin/upload/page.tsx`

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
