import type { InvoiceFields } from "./types";

export type ExportRow = {
  fields: InvoiceFields;
  routeReason?: string;
  personChoice?: string;
  originalRoute?: string;
};

function normalizeRow(item: InvoiceFields | ExportRow): {
  fields: InvoiceFields;
  routeReason: string;
  personChoice: string;
} {
  if ("fields" in item && item.fields) {
    return {
      fields: item.fields,
      routeReason: item.routeReason ?? "",
      personChoice: item.personChoice ?? "",
    };
  }
  return {
    fields: item as InvoiceFields,
    routeReason: "",
    personChoice: "",
  };
}

const cell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const amount = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) : "");

const toXeroDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
  }
  return iso;
};

const HEADERS = [
  "Supplier",
  "TRN",
  "Invoice number",
  "Invoice date",
  "Due date",
  "Currency",
  "Subtotal",
  "VAT",
  "Total",
  "Route reason",
  "Person's choice",
];

export function toCsv(rows: (InvoiceFields | ExportRow)[]) {
  const body = rows.map((item) => {
    const { fields: f, routeReason, personChoice } = normalizeRow(item);
    return [
      f.supplierName,
      f.supplierTrn,
      f.invoiceNumber,
      f.issueDate,
      f.dueDate,
      f.currency,
      amount(f.subtotal),
      amount(f.vatAmount),
      amount(f.total),
      routeReason,
      personChoice,
    ]
      .map(cell)
      .join(",");
  });
  return [HEADERS.join(","), ...body].join("\n");
}

const XERO_HEADERS = [
  "ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "InvoiceNumber",
  "Reference",
  "InvoiceDate",
  "DueDate",
  "InventoryItemCode",
  "Description",
  "Quantity",
  "UnitAmount",
  "Discount",
  "AccountCode",
  "TaxType",
  "TaxAmount",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
];

export function toXeroCsv(rows: (InvoiceFields | ExportRow)[]) {
  const lines: string[] = [XERO_HEADERS.join(",")];
  for (const item of rows) {
    const { fields: f } = normalizeRow(item);
    const taxType = (f.vatRate ?? 0) > 0 ? `${f.vatRate}% (VAT on Expenses)` : "Zero Rated Expenses";
    const lineItems = f.lines && f.lines.length > 0 ? f.lines : null;
    if (lineItems) {
      for (const l of lineItems) {
        const lineTax = amount((l.amount * (f.vatRate ?? 0)) / 100);
        lines.push(
          [
            f.supplierName,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            f.invoiceNumber,
            "",
            toXeroDate(f.issueDate),
            toXeroDate(f.dueDate),
            "",
            l.description,
            l.quantity,
            amount(l.unitPrice),
            "",
            "",
            taxType,
            lineTax,
            "",
            "",
            "",
            "",
            f.currency ?? "AED",
            "",
          ]
            .map(cell)
            .join(","),
        );
      }
    } else {
      lines.push(
        [
          f.supplierName,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          f.invoiceNumber,
          "",
          toXeroDate(f.issueDate),
          toXeroDate(f.dueDate),
          "",
          "Invoice subtotal",
          1,
          amount(f.subtotal),
          "",
          "",
          taxType,
          amount(f.vatAmount),
          "",
          "",
          "",
          "",
          f.currency ?? "AED",
          "",
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}

const QBO_HEADERS = [
  "Bill No.",
  "Vendor",
  "Bill Date",
  "Due Date",
  "Terms",
  "Location",
  "Memo",
  "Account",
  "Description",
  "Qty",
  "Rate",
  "Amount",
  "Tax Rate",
];

export function toQuickBooksCsv(rows: (InvoiceFields | ExportRow)[]) {
  const lines: string[] = [QBO_HEADERS.join(",")];
  for (const item of rows) {
    const { fields: f, routeReason, personChoice } = normalizeRow(item);
    const memo = routeReason
      ? `Reason: ${routeReason} | Decision: ${personChoice || "Approved"}`
      : "Approved via Invoice Inbox";
    const lineItems = f.lines && f.lines.length > 0 ? f.lines : null;
    const taxRateStr = (f.vatRate ?? 0) > 0 ? `${f.vatRate}%` : "0%";

    if (lineItems) {
      for (const l of lineItems) {
        lines.push(
          [
            f.invoiceNumber,
            f.supplierName,
            f.issueDate,
            f.dueDate,
            "",
            "",
            memo,
            "",
            l.description,
            l.quantity,
            amount(l.unitPrice),
            amount(l.amount),
            taxRateStr,
          ]
            .map(cell)
            .join(","),
        );
      }
    } else {
      lines.push(
        [
          f.invoiceNumber,
          f.supplierName,
          f.issueDate,
          f.dueDate,
          "",
          "",
          memo,
          "",
          "Bill amount",
          1,
          amount(f.subtotal),
          amount(f.subtotal),
          taxRateStr,
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}
