# Security Policy

## Scope of This Demo

Invoice Inbox is a demonstration project built on synthetic invoices. Every company name, Tax Registration Number (TRN), and bank IBAN in this repository is fictional. **Do not upload real, confidential, or personal financial documents to the public demo.**

## How Uploaded Files Are Handled

1. **In-memory processing only:** Uploaded PDFs are validated and parsed in memory inside `POST /api/extract` (`app/api/extract/route.ts`). The application never writes uploaded files to disk or a database.
2. **Strict file validation (`lib/upload-guard.ts`):**
   - Requests exceeding `4 MB` are rejected immediately (both via `Content-Length` header check and streaming byte counter).
   - Files must contain a valid `%PDF-` header within the first 1024 bytes.
   - Password-protected or encrypted PDFs (`/Encrypt`) are refused.
   - PDFs longer than `5 pages` are refused.
3. **Google Gemini API data handling:**
   - When `UPLOADS_ENABLED=true` and `GOOGLE_GENERATIVE_AI_API_KEY` is configured, uploaded PDF bytes are sent to Google's Gemini API for structured field extraction (`lib/ai-reader.ts`).
   - On billed Google Cloud / Gemini API keys, Google does not use submitted data to train models and retains logs temporarily only for abuse monitoring. On free-tier keys, Google's terms allow human reviewers and model training on submitted data.
4. **Spend and abuse controls:**
   - `UPLOADS_ENABLED` defaults to `false` in production unless explicitly enabled.
   - Uploads are rate-limited per IP (`10 uploads / hour`) and capped site-wide (`40 uploads / UTC day` by default via `DAILY_UPLOAD_LIMIT`).
   - Public `GET /api/health` runs only the zero-cost plain-code reader; full AI health checks require a `Bearer` token matching `HEALTH_TOKEN`.
   - Raw provider error messages and stack traces are logged only on the server (with API key patterns redacted) and never returned to the browser.

## Reporting a Vulnerability

If you find a security issue (such as a bypass of the upload guard, rate limiter, or prompt-injection routing), please report it privately via the contact details at [anilpervaiz.com](https://anilpervaiz.com) rather than opening a public issue with exploit details.
