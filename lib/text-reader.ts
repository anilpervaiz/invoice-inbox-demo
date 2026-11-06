import { getDocumentProxy } from "unpdf";
import { EMPTY_FIELDS, type InvoiceFields, type LineItem, type ReadResult } from "./types";

// The plain-code reader. No AI: it rebuilds the page's text lines and looks for labels.
// It gives the AI read something independent to be checked against.

type Item = { str: string; x: number; y: number; width: number };

export async function pdfLines(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  try {
    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        items.push({ str: raw.str, x: raw.transform[4], y: raw.transform[5], width: raw.width });
      }
      const rows = new Map<number, Item[]>();
      for (const item of items) {
        const key = [...rows.keys()].find((k) => Math.abs(k - item.y) < 3) ?? item.y;
        rows.set(key, [...(rows.get(key) ?? []), item]);
      }
      const ordered = [...rows.entries()].sort(([a], [b]) => b - a);
      for (const [, row] of ordered) {
        row.sort((a, b) => a.x - b.x);
        let text = "";
        let end = 0;
        for (const item of row) {
          if (text) text += item.x - end > 6 ? "   " : " ";
          text += item.str.trim();
          end = item.x + item.width;
        }
        lines.push(text);
      }
    }
    return lines;
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // Ignore destruction error on teardown
    }
  }
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const DATE = String.raw`(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})`;
const AMOUNT = String.raw`([\d,]+\.\d{2})`;

export function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const pad = (n: number | string) => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return month < 0 ? null : `${m[3]}-${pad(month + 1)}-${pad(m[1])}`;
  }
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return month < 0 ? null : `${m[3]}-${pad(month + 1)}-${pad(m[2])}`;
  }
  return null;
}

const toNumber = (s: string | null | undefined) => (s ? Number(s.replace(/,/g, "")) : null);
const COMPANY = /\b(LLC|L\.L\.C|FZE|FZ-LLC|FZCO|Ltd|Limited|Inc|Services|Supplies|Trading)\b/;

export function parseLines(lines: string[]): InvoiceFields {
  const text = lines.join("\n");
  const find = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;

  const invoiceNumber = find(
    /(?:tax\s+invoice\s+no\.?|invoice\s+no\.?|invoice\s+number|invoice\s*#|inv\s*(?:no\.?|#))\s*:?\s*([A-Z0-9][A-Z0-9\-\/]*)/i,
  );
  const issueRaw = find(new RegExp(String.raw`(?<!due\s)(?<!payment\s)(?:invoice\s+date|date\s+of\s+issue|issued|date)\s*:?\s*${DATE}`, "i"));
  const dueRaw = find(new RegExp(String.raw`(?:due\s+date|payment\s+due|due)\s*:?\s*${DATE}`, "i"));
  const trn = find(/(?:TRN|tax\s+registration\s+no\.?|VAT\s+reg(?:istration)?\s+no\.?)\s*:?\s*(\d[\d ]{11,19})/i);
  const iban = find(/IBAN\s*:?\s*([A-Z]{2}[0-9A-Z ]{10,34}?)(?:\s{2,}|$)/m);

  const currencies = text.match(/\b(AED|USD|EUR|GBP|SAR)\b/g) ?? [];
  const currency = currencies.length
    ? [...currencies].sort((a, b) => currencies.filter((c) => c === b).length - currencies.filter((c) => c === a).length)[0]
    : null;

  const subtotal = toNumber(
    find(new RegExp(String.raw`(?:sub\s*-?\s*total|net\s+amount|taxable\s+amount|amount\s+before\s+vat)[^\d\n]*${AMOUNT}`, "i")),
  );
  const vatMatch = text.match(new RegExp(String.raw`(?:vat|tax)\s*(?:@|\()?\s*(\d+(?:\.\d+)?)\s*%\)?[^\d\n]*${AMOUNT}`, "i"));
  const total = toNumber(
    find(new RegExp(String.raw`^\s*(?:grand\s+total|total\s+due|balance\s+due|amount\s+payable|total\s+amount|total)\b[^\d\n]*${AMOUNT}`, "im")),
  );

  const parsedLines: LineItem[] = [];
  for (const l of lines) {
    const m = l.match(/^(.+?)\s{2,}(\d+(?:\.\d+)?)\s{2,}([\d,]+\.\d{2})\s{2,}([\d,]+\.\d{2})$/);
    if (m) {
      parsedLines.push({
        description: m[1].trim(),
        quantity: Number(m[2]),
        unitPrice: Number(m[3].replace(/,/g, "")),
        amount: Number(m[4].replace(/,/g, "")),
      });
    }
  }

  // The supplier is the first company name above the customer block.
  let supplierName: string | null = null;
  for (const raw of lines.slice(0, 10)) {
    const first = raw.split(/\s{2,}/)[0].trim();
    if (/^(bill(ed)?\s+to|sold\s+to|customer|to)\b/i.test(first)) break;
    if (COMPANY.test(first)) {
      supplierName = first;
      break;
    }
  }

  return {
    ...EMPTY_FIELDS,
    supplierName,
    supplierTrn: trn?.replace(/\s/g, "") ?? null,
    invoiceNumber,
    issueDate: parseDate(issueRaw ?? undefined),
    dueDate: parseDate(dueRaw ?? undefined),
    currency,
    subtotal,
    vatRate: vatMatch ? Number(vatMatch[1]) : null,
    vatAmount: vatMatch ? toNumber(vatMatch[2]) : null,
    total,
    iban,
    lines: parsedLines,
  };
}

export async function readWithText(data: Uint8Array): Promise<ReadResult> {
  try {
    const lines = await pdfLines(data);
    if (!lines.length) {
      return { reader: "text", status: "empty", fields: { ...EMPTY_FIELDS }, note: "No text layer. This looks like a scan." };
    }
    return { reader: "text", status: "ok", fields: parseLines(lines) };
  } catch (error) {
    console.error("[text-reader] PDF text parsing failed:", error);
    return { reader: "text", status: "error", fields: { ...EMPTY_FIELDS }, note: "The plain-code reader couldn't read this PDF." };
  }
}
