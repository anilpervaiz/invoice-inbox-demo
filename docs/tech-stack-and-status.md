# Tech Stack, Architecture, and Current Status

This document is the technical reference for **Invoice Inbox**, covering the stack, repository structure, safety boundaries, and current status across all build stages.

---

## 1. Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Next.js (App Router, Turbopack) | `16.4.5` | Server-rendered initial view, API routes (`/api/extract`, `/api/health`) |
| **UI Library** | React | `19.3.0` | Interactive 3-column workstation, keyboard navigation, client CSV export |
| **Styling** | Tailwind CSS | `4.x` | Custom paper/ink accounting theme (`app/globals.css`), responsive down to `375px` |
| **Typography** | IBM Plex Sans & IBM Plex Mono | Google Fonts | Tabular numerals (`.figures`) for money, dates, TRNs, and IBANs |
| **Plain-Code PDF Reader** | `unpdf` | `^2.1.0` | Extracts PDF text layers in memory without native binary dependencies |
| **AI PDF Reader** | Vercel AI SDK (`ai`) + `@ai-sdk/google` | `^7.0.163` / `^4.0.112` | Multimodal PDF extraction with Google Gemini (`gemini-3.5-flash-lite` / `gemini-3.8-flash`) |
| **Schema Validation** | Zod | `^4.6.7` | Enforces structured output schema on AI extraction |
| **Test PDF Generator** | `pdfkit` | `^0.20.2` | Generates the 7 sample PDFs, 40 known-set PDFs, and 48 held-out test PDFs |
| **Testing & Tooling** | Vitest, TypeScript, ESLint | `^5.1.0` / `^5` / `^9` | 71 unit and integration tests, strict type checking, release gate verification |

---

## 2. Repository Map

```text
invoice-inbox-demo/
├── app/
│   ├── api/
│   │   ├── extract/route.ts       # POST upload handler (streaming size cap, PDF guard, rate limit, dual read)
│   │   └── health/route.ts        # GET health check (zero-cost plain-code read by default; AI check behind HEALTH_TOKEN)
│   ├── globals.css                # Tailwind 4 theme variables, paper/ink palette, tabular figures, :focus-visible ring
│   ├── layout.tsx                 # Root layout and IBM Plex font configuration
│   └── page.tsx                   # Loads pre-computed samples.json and eval-report.json at zero AI cost
├── components/
│   └── inbox.tsx                  # Main 3-column UI (Queue, Document Viewer, Decision & Dual-Read Comparison)
├── data/
│   ├── ai-cache/                  # SHA-256 keyed cache of real Gemini extraction responses for reproducible evals
│   ├── eval-report.json           # Real measured benchmark results across 88 generated invoices
│   └── samples.json               # Pre-computed dual-read outputs for the 7 initial sample invoices
├── docs/
│   ├── screenshot.png             # Workstation screenshot (1280x880)
│   ├── how-it-decides.md          # Pipeline diagram, field comparison rules, and all 9 checks
│   ├── adapt-it.md                # Guide to swapping suppliers, VAT rules, currency, exports, and AI model
│   └── tech-stack-and-status.md   # This file
├── eval/
│   ├── invoices/                  # 40 known-set generated PDFs (5 layouts)
│   ├── truth.json                 # Ground truth for the 40 known-set invoices
│   └── holdout/
│       ├── generate.ts            # Standalone generator for the 48 held-out invoices
│       ├── holdout-pdf.ts         # 5 unseen PDF layouts (two-column, bilingual Arabic, multi-page, discount, memo)
│       ├── holdout-specs.ts       # Specs covering 9 edge-case categories and prompt-injection tests
│       ├── invoices/              # 48 held-out generated PDFs
│       └── truth.json             # Ground truth written directly from generator specs
├── lib/
│   ├── text-reader.ts             # [FROZEN] Plain-code PDF reader (unpdf + regex)
│   ├── ai-reader.ts               # [FROZEN] Gemini AI PDF reader (Zod schema + 15s timeout + error sanitisation)
│   ├── rules.ts                   # [FROZEN] 9 deterministic accounting checks
│   ├── decide.ts                  # [FROZEN] Field comparison and routing logic (Ready / Needs you / Blocked)
│   ├── csv.ts                     # Plain Audit CSV, Xero Purchases Bill CSV (28 cols), and QuickBooks CSV (13 cols)
│   ├── demo-data.ts               # Made-up supplier master list, posted invoices, and UAE VAT context
│   ├── rate-limit.ts              # Per-IP (10/hr) and global daily (40/day) rate limiter interface
│   ├── upload-guard.ts            # Streaming body cap (4 MB), %PDF- magic header, encryption check, <= 5 pages
│   ├── types.ts                   # Shared TypeScript types
│   └── *.test.ts                  # 6 Vitest test suites (71 tests total)
└── scripts/
    ├── make-pdfs.ts               # Generates sample and known-set PDFs
    ├── build-samples.ts           # Runs both readers on the 7 samples to build data/samples.json
    ├── eval.ts                    # Evaluates both readers on all 88 invoices (known + held-out)
    └── check-release.ts           # Release gate: fails on simulated data, false clears, or post-eval frozen-file edits
```

---

## 3. Public-Safety & Cost Protections

1. **Zero-cost first load:** Opening the app reads `data/samples.json` and `data/eval-report.json` from disk. No AI call happens until a visitor uploads a PDF when `UPLOADS_ENABLED=true`.
2. **Works without an API key:** If `GOOGLE_GENERATIVE_AI_API_KEY` is unset or `UPLOADS_ENABLED=false`, all 7 interactive sample invoices, decision buttons, and CSV exports work normally.
3. **Strict upload validation (`lib/upload-guard.ts`):**
   - Checks `Content-Length` and streams `request.body` chunks, aborting immediately if a chunked upload exceeds `4 MB`.
   - Verifies the `%PDF-` magic header within the first 1024 bytes (refuses renamed `.txt` or image files).
   - Refuses password-protected/encrypted PDFs (`/Encrypt` dictionary check).
   - Refuses PDFs longer than `5 pages`.
4. **Two-tier rate limiting (`lib/rate-limit.ts`):**
   - Enforces both a per-IP limit (`10 uploads / hour`) and a site-wide daily cap (`40 uploads / UTC day`,configurable via `DAILY_UPLOAD_LIMIT`), alongside provider-level monthly spend caps.
5. **Safe fallback on AI failure:** If the AI reader times out (15s limit) or fails, the upload still returns the plain-code read and routes to `Needs you` (never `Ready to post`).
6. **Zero-spend health check (`app/api/health/route.ts`):** Public `GET /api/health` runs only the plain-code reader on a sample PDF. Running a live AI health check requires passing `Authorization: Bearer <HEALTH_TOKEN>`, and caches successful AI checks for 1 hour.

---

## 4. Current Project Status

| Stage | Status | Summary |
|---|---|---|
| **Stage 0: Set up** | Complete | Baseline SHA-256 verified (`81/81` files), `.gitignore` updated to track `.env.example`, Git repo initialised on `main` and `showcase` |
| **Stage 1: Public safety** | Complete | Fixed upload date bug (`Asia/Dubai` runtime date for uploads), secured `/api/health`, added PDF header/encryption/page/stream-size guards, added per-IP + daily rate limiter and `UPLOADS_ENABLED`, added 15s AI timeout, sanitised provider errors, and added honest Gemini API privacy notice |
| **Stage 2: Honest measurement** | Complete | Froze core files at commit `2395671`, built 48-invoice held-out set across 5 unseen layouts, ran real `gemini-3.5-flash-lite` evaluation across all 88 invoices (`100%` known AI accuracy, `99.0%` held-out AI accuracy, `24/24` planted errors caught, **`0` false clears**, `$0.0352` total cost), and passed `npm run check:release` |
| **Stage 3: Stranger-ready UX** | Complete | Added first-view tagline, adversarial `prompt-injection` sample (`OG-5582`), dynamic `Route reason` audit trail, Xero (28-column) & QuickBooks Online (13-column) CSV exports, explicit `Code + AI` field badges, document inspection bar, keyboard navigation (`ArrowUp`/`ArrowDown`), and verified `375px` mobile layout |
| **Stage 4: Open-source ready** | Complete | Added MIT `LICENSE`, rewrote `README.md`, added `docs/how-it-decides.md`, `docs/adapt-it.md`, `docs/tech-stack-and-status.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `.github/workflows/ci.yml`, verified made-up company names, ran secret/licence/audit scans, and verified isolated fresh-clone execution |
| **Stage 5: Go live** | Pending Anil's go-ahead | Public GitHub repo creation, hosting connection, provider spend limit, and daily scheduled health monitor |
