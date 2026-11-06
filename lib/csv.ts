import type { InvoiceFields } from "./types";

const HEADERS = ["Supplier", "TRN", "Invoice number", "Invoice date", "Due date", "Currency", "Subtotal", "VAT", "Total"];

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const amount = (n: number | null) => (n === null ? null : n.toFixed(2));

export function toCsv(rows: InvoiceFields[]) {
  const body = rows.map((f) =>
    [f.supplierName, f.supplierTrn, f.invoiceNumber, f.issueDate, f.dueDate, f.currency, amount(f.subtotal), amount(f.vatAmount), amount(f.total)]
      .map(cell)
      .join(","),
  );
  return [HEADERS.join(","), ...body].join("\n");
}
