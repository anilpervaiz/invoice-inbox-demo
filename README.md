# Invoice Inbox

A demo for small accounting firms. It reads each invoice twice, checks it with plain rules, and only asks a person about what's unclear.

Every company, TRN and IBAN here is made up. It's a demo, not a client system.

## How it decides

1. **Two separate reads.** One is plain code that reads the PDF's text. The other is AI. A field counts as agreed only when both found the same value.
2. **Plain rules do the checks.** Duplicates, changed bank details, line totals, VAT maths, VAT rate, TRN format and dates.
3. **AI never decides.** Nothing clears on one read. Scans have no text layer, so a person always confirms them.

| Route | When |
|---|---|
| Ready to post | Both reads agree and every check passes |
| Needs you | The reads disagree, a check fails, or only one read was possible. It asks one specific question |
| Blocked | A duplicate, or bank details that differ from the supplier file |

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the rule and routing tests |
| `npm run pdfs` | Regenerates the sample and test invoices |
| `npm run samples` | Reads the samples with both readers |
| `npm run eval` | Measures accuracy on the 40 test invoices |
| `npm run check:release` | Fails if results are simulated or AI accuracy wasn't measured |

`npm run samples -- --simulate-ai` fills in known answers so the screens can be tested without a key. The page shows a red warning when it's on. Never publish that build.

## About the numbers

The test set is 40 generated invoices in 5 layouts, including 6 scans and 14 planted errors. The plain-code reader was written alongside these layouts, so its score says little about real invoices. Real invoices will score differently.

`GET /api/health` does a real read of a sample file, because a page can load while the service behind it is down.
