# How to Adapt It

Invoice Inbox is structured so the supplier master data, tax rules, currency settings, AI model, and accounting export templates live in small, isolated TypeScript files.

---

## 1. Swap the Suppliers and Posted History

Open [`lib/demo-data.ts`](../lib/demo-data.ts).

- **`FIRM` and `CLIENT`:** Change the accounting firm and client names shown in the header.
- **`SUPPLIERS`:** Replace the made-up suppliers with your own supplier master list.
  ```ts
  export const SUPPLIERS: Supplier[] = [
    {
      name: "Your Supplier LLC",
      trn: "100000000000003", // 15-digit TRN, or null for foreign suppliers
      iban: "AE00 0331 0000 1204 8821 007",
      country: "AE",
    },
  ];
  ```
  - `checkIban` in `lib/rules.ts` normalises spaces and casing automatically (`normaliseKey`), and `findSupplier` strips common legal suffixes (`LLC`, `FZE`, `FZ-LLC`, `Ltd`, `Limited`) when matching supplier names.
- **`POSTED`:** Replace the posted invoice array with recent bills from your accounting ledger so `checkDuplicate` catches exact duplicates and 30-day lookalikes.

---

## 2. Change VAT Rules and Currency

### Domestic VAT Rates
In [`lib/demo-data.ts`](../lib/demo-data.ts), `RULE_CONTEXT.domesticVatRates` defaults to UAE rates (`[0, 5]`):

```ts
export const RULE_CONTEXT: RuleContext = {
  suppliers: SUPPLIERS,
  posted: POSTED,
  today: "2026-11-05",
  domesticVatRates: [0, 5], // Change to [0, 5, 20] for UK VAT, [0, 15] for KSA VAT, etc.
};
```

### Domestic Currency and Tax ID Format
In [`lib/rules.ts`](../lib/rules.ts):
1. **`checkVatRate` (line 106):** Checks `f.currency !== "AED"` to identify foreign-currency invoices. Change `"AED"` to your home currency (for example, `"GBP"`, `"SAR"`, or `"EUR"`).
2. **`checkTrn` (line 115):** Checks that domestic VAT-charging invoices carry a 15-digit UAE TRN (`digits.length !== 15`). Adjust this length or pattern for your jurisdiction (for example, 9 digits for a UK VAT number or 15 digits for a Saudi ZATCA VAT number).
3. **Plain-code reader patterns (`lib/text-reader.ts`):**
   - `TRN` regex (`/\b(100\d{12})\b/`) matches 15-digit numbers starting with `100`.
   - `IBAN` regex matches `AE` and `GB` IBANs. Add your country prefix if needed.

> **Important:** If you modify any of the four core files (`lib/text-reader.ts`, `lib/ai-reader.ts`, `lib/rules.ts`, `lib/decide.ts`), re-run `npm run samples` and `npm run eval` so `npm run check:release` verifies the updated code against the evaluation suite.

---

## 3. Swap the AI Model

### Via Environment Variable (No Code Changes)
Set `GEMINI_MODEL` in `.env.local`:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
```

Any current Google Gemini model that supports multimodal PDF inputs (`application/pdf`) works with `lib/ai-reader.ts`.

### Switching to Another Provider (OpenAI / Anthropic)
All AI SDK calls are isolated inside [`lib/ai-reader.ts`](../lib/ai-reader.ts) (`readWithAi`). Because it uses the Vercel AI SDK (`generateText` + `Output.object` with a Zod schema), swapping providers only requires replacing the `@ai-sdk/google` model instance passed to `generateText` with an `@ai-sdk/anthropic` or `@ai-sdk/openai` model that supports PDF file parts.

---

## 4. Customise Accounting CSV Exports (Audit, Xero, QuickBooks)

Open [`lib/csv.ts`](../lib/csv.ts):

- **Plain Audit CSV (`toCsv`):** Outputs 11 columns including `Route reason` and `Person's choice`.
- **Xero Purchases Bills (`toXeroCsv`):** Matches Xero's 28-column bill import template (`ContactName`, `InvoiceNumber`, `InvoiceDate` in `DD/MM/YYYY`, `DueDate`, `Description`, `Quantity`, `UnitAmount`, `AccountCode`, `TaxType`, `TaxAmount`, `Currency`).
  - Default `AccountCode` is `"400"` (General Expenses). Change `"400"` in `toXeroCsv` to match your Xero chart of accounts.
  - Default `TaxType` maps `5%` VAT to `"Input Tax"` and `0%` to `" Tax Exempt"`.
- **QuickBooks Online Batch Bills (`toQuickBooksCsv`):** Matches QuickBooks Online Advanced's 13-column batch bill import (`Bill No.`, `Vendor`, `Bill Date`, `Due Date`, `Terms`, `Location`, `Memo`, `Account`, `Description`, `Qty`, `Rate`, `Amount`, `Tax Rate`).
  - Default `Account` is `"Accounts Payable"`. Update this string to match your QuickBooks expense category.
