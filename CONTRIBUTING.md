# Contributing

Thank you for looking through **Invoice Inbox**. This project is an open-source portfolio demo showing how dual-reader extraction (plain code + AI) and deterministic accounting checks prevent unverified AI output from clearing an invoice queue.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

No API key is needed to run the app, inspect the 7 sample invoices, or run the test suite.

## Running Checks Before Submitting a Change

Every change must pass all four checks:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## Rules for Modifying Readers or Rules

1. **Core invariant:** AI reads, plain rules decide, and nothing clears on one read. Do not allow any invoice with a single read, a reader disagreement, or a failed check to reach `Ready to post`.
2. **Frozen core files and held-out set:**
   - The four core files (`lib/text-reader.ts`, `lib/ai-reader.ts`, `lib/rules.ts`, `lib/decide.ts`) are checked by `npm run check:release` against the evaluation timestamp in `data/eval-report.json`.
   - Do not tune `lib/text-reader.ts` or `lib/ai-reader.ts` against the held-out set in `eval/holdout/`. If the core files change, re-run `npm run samples` and `npm run eval` with a real API key and a fresh held-out set.
3. **Every bug fix needs a test:** Write a Vitest test that fails before your fix and passes after it.
4. **No real company or financial data:** Never commit real invoices, real company names, real TRNs, or real bank IBANs.
