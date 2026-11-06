import type { Check, InvoiceFields, PostedInvoice, RuleContext, Supplier } from "./types";

// Every check here is plain code. The AI reads the invoice, it never decides.

const cents = (n: number) => Math.round(n * 100);

export const formatMoney = (n: number, currency?: string | null) => {
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${text}` : text;
};

export const normaliseKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const normaliseSupplier = (s: string) =>
  normaliseKey(s.replace(/\b(llc|l\.l\.c|fze|fz-llc|ltd|limited|services?)\b/gi, ""));

export function findSupplier(name: string | null, suppliers: Supplier[]) {
  if (!name) return undefined;
  const key = normaliseSupplier(name);
  return suppliers.find((s) => normaliseSupplier(s.name) === key);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

const pass = (id: string, label: string, detail: string, severity: Check["severity"] = "review"): Check => ({
  id,
  label,
  status: "pass",
  detail,
  severity,
});
const fail = (id: string, label: string, detail: string, severity: Check["severity"] = "review"): Check => ({
  id,
  label,
  status: "fail",
  detail,
  severity,
});
const skip = (id: string, label: string, detail: string): Check => ({
  id,
  label,
  status: "skip",
  detail,
  severity: "review",
});

export function checkRequired(f: InvoiceFields): Check {
  const label = "Key fields are present";
  const missing = [
    ["supplier", f.supplierName],
    ["invoice number", f.invoiceNumber],
    ["invoice date", f.issueDate],
    ["total", f.total],
  ]
    .filter(([, v]) => v === null || v === "")
    .map(([k]) => k);
  return missing.length
    ? fail("required", label, `Missing: ${missing.join(", ")}.`)
    : pass("required", label, "Supplier, number, date and total were all found.");
}

export function checkLinesAddUp(f: InvoiceFields): Check {
  const label = "Lines add up to the subtotal";
  if (!f.lines.length || f.subtotal === null) return skip("lines", label, "No line items to add up.");
  const sum = f.lines.reduce((acc, l) => acc + cents(l.amount), 0);
  return sum === cents(f.subtotal)
    ? pass("lines", label, `Lines add to ${formatMoney(sum / 100, f.currency)}.`)
    : fail(
        "lines",
        label,
        `Lines add to ${formatMoney(sum / 100, f.currency)}, but the subtotal says ${formatMoney(f.subtotal, f.currency)}.`,
      );
}

export function checkTotal(f: InvoiceFields): Check {
  const label = "Subtotal plus VAT equals the total";
  if (f.subtotal === null || f.total === null) return skip("total", label, "Subtotal or total is missing.");
  const expected = cents(f.subtotal) + cents(f.vatAmount ?? 0);
  return expected === cents(f.total)
    ? pass("total", label, `${formatMoney(expected / 100, f.currency)} matches the invoice.`)
    : fail(
        "total",
        label,
        `Subtotal plus VAT is ${formatMoney(expected / 100, f.currency)}, but the invoice says ${formatMoney(f.total, f.currency)}.`,
      );
}

export function checkVatMath(f: InvoiceFields): Check {
  const label = "VAT matches the stated rate";
  if (f.subtotal === null || f.vatAmount === null || f.vatRate === null) {
    return skip("vat-math", label, "VAT amount or rate is missing.");
  }
  const expected = Math.round(cents(f.subtotal) * f.vatRate) / 100;
  // Allow 2 fils for line by line rounding.
  return Math.abs(expected - cents(f.vatAmount)) <= 2
    ? pass("vat-math", label, `${f.vatRate}% of the subtotal is ${formatMoney(f.vatAmount, f.currency)}.`)
    : fail(
        "vat-math",
        label,
        `${f.vatRate}% of the subtotal is ${formatMoney(expected / 100, f.currency)}, but the invoice charges ${formatMoney(f.vatAmount, f.currency)}.`,
      );
}

export function checkVatRate(f: InvoiceFields, ctx: RuleContext): Check {
  const label = "VAT rate is allowed";
  if (f.vatRate === null) return skip("vat-rate", label, "No VAT rate found.");
  if (f.currency && f.currency !== "AED") return skip("vat-rate", label, "Foreign currency invoice.");
  return ctx.domesticVatRates.includes(f.vatRate)
    ? pass("vat-rate", label, `${f.vatRate}% is an expected rate.`)
    : fail("vat-rate", label, `${f.vatRate}% is not an expected rate here.`);
}

export function checkTrn(f: InvoiceFields, ctx: RuleContext): Check {
  const label = "Supplier TRN looks right";
  const charged = (f.vatAmount ?? 0) > 0;
  if (!charged) return skip("trn", label, "No VAT charged, so no TRN is needed.");
  if (!f.supplierTrn) return fail("trn", label, "VAT is charged, but there is no TRN on the invoice.");
  const digits = f.supplierTrn.replace(/\D/g, "");
  if (digits.length !== 15) return fail("trn", label, `The TRN has ${digits.length} digits. It should have 15.`);
  const known = findSupplier(f.supplierName, ctx.suppliers);
  if (known?.trn && known.trn.replace(/\D/g, "") !== digits) {
    return fail("trn", label, "This TRN is different from the one on the supplier file.");
  }
  return pass("trn", label, known ? "Matches the supplier file." : "15 digits. Supplier isn't on file yet.");
}

export function checkIban(f: InvoiceFields, ctx: RuleContext): Check {
  const label = "Bank details match the supplier file";
  const known = findSupplier(f.supplierName, ctx.suppliers);
  if (!known) return skip("iban", label, "Supplier isn't on file yet.");
  if (!f.iban) return skip("iban", label, "No IBAN on the invoice.");
  return normaliseKey(f.iban) === normaliseKey(known.iban)
    ? pass("iban", label, "Same IBAN as the supplier file.", "block")
    : fail(
        "iban",
        label,
        `The invoice asks for payment to ${f.iban}. The supplier file has ${known.iban}.`,
        "block",
      );
}

export function findDuplicate(f: InvoiceFields, posted: PostedInvoice[]) {
  if (!f.supplierName || !f.invoiceNumber) return undefined;
  const supplier = normaliseSupplier(f.supplierName);
  const number = normaliseKey(f.invoiceNumber);
  return posted.find(
    (p) => normaliseSupplier(p.supplierName) === supplier && normaliseKey(p.invoiceNumber) === number,
  );
}

export function checkDuplicate(f: InvoiceFields, ctx: RuleContext): Check {
  const label = "Not already posted";
  if (!f.supplierName || !f.invoiceNumber) return skip("duplicate", label, "Supplier or number is missing.");
  const match = findDuplicate(f, ctx.posted);
  if (match) {
    return fail(
      "duplicate",
      label,
      `${match.invoiceNumber} from this supplier was already posted on ${match.issueDate} for ${formatMoney(match.total, f.currency)}.`,
      "block",
    );
  }
  const supplier = normaliseSupplier(f.supplierName);
  const lookalike = ctx.posted.find(
    (p) =>
      normaliseSupplier(p.supplierName) === supplier &&
      f.total !== null &&
      cents(p.total) === cents(f.total) &&
      f.issueDate !== null &&
      Math.abs(daysBetween(p.issueDate, f.issueDate)) <= 30,
  );
  return lookalike
    ? fail(
        "duplicate",
        label,
        `Same supplier and amount as ${lookalike.invoiceNumber}, posted within 30 days. It may be the same bill with a new number.`,
      )
    : pass("duplicate", label, "No match in posted invoices.", "block");
}

export function checkDates(f: InvoiceFields, ctx: RuleContext): Check {
  const label = "Dates make sense";
  if (!f.issueDate) return skip("dates", label, "No invoice date found.");
  if (daysBetween(ctx.today, f.issueDate) > 0) return fail("dates", label, "The invoice date is in the future.");
  if (f.dueDate && daysBetween(f.issueDate, f.dueDate) < 0) {
    return fail("dates", label, "The due date is before the invoice date.");
  }
  return pass("dates", label, f.dueDate ? "Invoice date and due date are in order." : "Invoice date is fine.");
}

export function runChecks(f: InvoiceFields, ctx: RuleContext): Check[] {
  return [
    checkRequired(f),
    checkDuplicate(f, ctx),
    checkIban(f, ctx),
    checkLinesAddUp(f),
    checkTotal(f),
    checkVatMath(f),
    checkVatRate(f, ctx),
    checkTrn(f, ctx),
    checkDates(f, ctx),
  ];
}
