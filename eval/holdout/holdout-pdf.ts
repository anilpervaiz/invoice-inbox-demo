import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import { CLIENT } from "../../lib/demo-data";
import type { InvoiceFields } from "../../lib/types";

export type HoldoutLayout =
  | "modern-grid"
  | "bilingual-uae"
  | "compact-slip"
  | "corporate-split"
  | "tabular-border";

export type DateStyle =
  | "iso"
  | "dd/mm/yyyy"
  | "dd-mm-yyyy"
  | "dd.mm.yyyy"
  | "d-mon-yyyy"
  | "month-d-yyyy"
  | "yyyy/mm/dd";

export type HoldoutInvoiceSpec = {
  id: string;
  layout: HoldoutLayout;
  scan: boolean;
  skewDegrees?: number;
  multiPage?: boolean;
  dateStyle?: DateStyle;
  discountNote?: string;
  hiddenInstruction?: {
    type: "visible" | "white-text";
    text: string;
    injectedTotal?: number;
    injectedIban?: string;
  };
  fields: InvoiceFields;
  expected: {
    route: "ready" | "review" | "blocked";
    planted: string | null;
  };
};

type Doc = InstanceType<typeof PDFDocument>;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const ARABIC_FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const ARABIC_BOLD_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

function findFont(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const fmtNum = (n: number | null) => {
  if (n === null) return "";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-${abs}` : abs;
};

export function formatHoldoutDate(iso: string | null, style: DateStyle = "iso"): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  switch (style) {
    case "dd/mm/yyyy":
      return `${dd}/${mm}/${y}`;
    case "dd-mm-yyyy":
      return `${dd}-${mm}-${y}`;
    case "dd.mm.yyyy":
      return `${dd}.${mm}.${y}`;
    case "d-mon-yyyy":
      return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
    case "month-d-yyyy":
      return `${FULL_MONTHS[m - 1]} ${d}, ${y}`;
    case "yyyy/mm/dd":
      return `${y}/${mm}/${dd}`;
    default:
      return iso;
  }
}

function defaultDateStyleForLayout(layout: HoldoutLayout): DateStyle {
  switch (layout) {
    case "modern-grid":
      return "iso";
    case "bilingual-uae":
      return "dd/mm/yyyy";
    case "compact-slip":
      return "dd-mm-yyyy";
    case "corporate-split":
      return "d-mon-yyyy";
    case "tabular-border":
      return "dd.mm.yyyy";
  }
}

function drawHiddenInstruction(doc: Doc, spec: HoldoutInvoiceSpec, left: number, y: number, width?: number) {
  if (!spec.hiddenInstruction) return;
  if (spec.hiddenInstruction.type === "white-text") {
    doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820, {
      lineBreak: false,
    });
  } else {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#DC2626")
      .text(`NOTE: ${spec.hiddenInstruction.text}`, left, y, width ? { width } : undefined);
  }
}

function drawModernGrid(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const style = spec.dateStyle ?? defaultDateStyleForLayout(spec.layout);
  const issueText = formatHoldoutDate(f.issueDate, style);
  const dueText = formatHoldoutDate(f.dueDate, style);
  const left = 45;
  const right = 550;
  const contentWidth = right - left;

  doc.rect(left, 40, contentWidth, 36).fill("#1E3A8A");
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#FFFFFF").text("TAX INVOICE", left + 14, 52);
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#E0E7FF")
    .text(f.invoiceNumber ? `# ${f.invoiceNumber}` : "", right - 150, 53, { width: 136, align: "right" });

  const metaY = 88;
  const colWidth = (contentWidth - 10) / 2;

  doc.rect(left, metaY, colWidth, 75).strokeColor("#CBD5E1").lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E293B").text("SUPPLIER DETAILS", left + 8, metaY + 8);
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor("#0F172A")
    .text(f.supplierName ?? "Unknown Supplier", left + 8, metaY + 22, { width: colWidth - 16 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
  if (f.supplierTrn) doc.text(`Tax Registration (TRN): ${f.supplierTrn}`, left + 8, metaY + 44);
  if (f.iban) doc.text(`Payment IBAN: ${f.iban}`, left + 8, metaY + 58);

  const rightX = left + colWidth + 10;
  doc.rect(rightX, metaY, colWidth, 75).strokeColor("#CBD5E1").lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E293B").text("INVOICE & CLIENT INFO", rightX + 8, metaY + 8);
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
  doc.text(`Issue Date: ${issueText || "N/A"}`, rightX + 8, metaY + 22);
  if (dueText) doc.text(`Due Date: ${dueText}`, rightX + 8, metaY + 36);
  doc.text(`Currency: ${f.currency ?? "AED"}`, rightX + 8, metaY + 50);
  doc.text(`Billed To: ${CLIENT}`, rightX + 8, metaY + 64);

  let curY = 175;
  const drawTableHeader = (y: number) => {
    doc.rect(left, y, contentWidth, 20).fill("#F1F5F9");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#334155");
    doc.text("Item / Description", left + 8, y + 6);
    doc.text("Qty", left + 270, y + 6, { width: 45, align: "right" });
    doc.text("Unit Price", left + 325, y + 6, { width: 75, align: "right" });
    doc.text("Amount", left + 410, y + 6, { width: 85, align: "right" });
    return y + 22;
  };

  curY = drawTableHeader(curY);
  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 11) : lines.length;

  const drawRow = (l: InvoiceFields["lines"][number], y: number) => {
    doc.font("Helvetica").fontSize(8.5).fillColor("#1E293B");
    doc.text(l.description, left + 8, y + 4, { width: 255 });
    doc.text(String(l.quantity), left + 270, y + 4, { width: 45, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 325, y + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 410, y + 4, { width: 85, align: "right" });
    doc.moveTo(left, y + 18).lineTo(right, y + 18).strokeColor("#E2E8F0").stroke();
    return y + 20;
  };

  for (let i = 0; i < firstPageLines; i++) curY = drawRow(lines[i], curY);

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#64748B").text("Continued on page 2...", left + 8, curY + 10);
    doc.addPage();
    curY = 50;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#1E3A8A")
      .text(`TAX INVOICE ${f.invoiceNumber ?? ""} (Page 2 of 2)`, left, curY);
    curY = drawTableHeader(curY + 25);
    for (let i = firstPageLines; i < lines.length; i++) curY = drawRow(lines[i], curY);
  }

  if (spec.discountNote) {
    curY += 8;
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#334155").text(spec.discountNote, left + 8, curY);
    curY += 10;
  }

  curY += 12;
  const summaryX = left + 280;
  const summaryWidth = right - summaryX;
  doc.rect(summaryX, curY, summaryWidth, 68).fill("#F8FAFC");
  doc.rect(summaryX, curY, summaryWidth, 68).strokeColor("#CBD5E1").stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#475569");
  doc.text("Subtotal:", summaryX + 12, curY + 10);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, summaryX + 100, curY + 10, {
    width: summaryWidth - 112,
    align: "right",
  });

  doc.text(`VAT (${f.vatRate ?? 0}%):`, summaryX + 12, curY + 26);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, summaryX + 100, curY + 26, {
    width: summaryWidth - 112,
    align: "right",
  });

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0F172A");
  doc.text("Invoice Total:", summaryX + 12, curY + 46);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, summaryX + 100, curY + 46, {
    width: summaryWidth - 112,
    align: "right",
  });

  drawHiddenInstruction(doc, spec, left, curY + 80);
}

function drawBilingualUae(doc: Doc, spec: HoldoutInvoiceSpec, hasArabicFont: boolean) {
  const f = spec.fields;
  const style = spec.dateStyle ?? defaultDateStyleForLayout(spec.layout);
  const issueText = formatHoldoutDate(f.issueDate, style);
  const dueText = formatHoldoutDate(f.dueDate, style);
  const left = 50;
  const right = 545;
  const width = right - left;
  const arReg = hasArabicFont ? "ArabicRegular" : "Helvetica";
  const arBold = hasArabicFont ? "ArabicBold" : "Helvetica-Bold";

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#065F46").text("TAX INVOICE", left, 45);
  if (hasArabicFont) {
    doc.font(arBold).fontSize(15).fillColor("#065F46").text("فاتورة ضريبية", right - 180, 44, {
      width: 180,
      align: "right",
      features: ["rtla"],
    });
  }
  doc.moveTo(left, 68).lineTo(right, 68).strokeColor("#065F46").lineWidth(2).stroke();

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(`Supplier: ${f.supplierName ?? ""}`, left, 78);
  if (hasArabicFont) {
    doc.font(arReg).fontSize(9).fillColor("#374151").text("المورد", left + 220, 78, { width: 55, align: "right" });
  }
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  if (f.supplierTrn) {
    doc.text(`TRN: ${f.supplierTrn}`, left, 94);
    if (hasArabicFont) doc.font(arReg).text("الرقم الضريبي", left + 195, 93, { width: 80, align: "right" });
  }
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151").text(`Customer: ${CLIENT}`, left, 108);
  if (hasArabicFont) doc.font(arReg).text("العميل", left + 220, 107, { width: 55, align: "right" });

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
  doc.text(`Invoice No: ${f.invoiceNumber ?? ""}`, 300, 78, { width: 170, align: "right" });
  if (hasArabicFont) doc.font(arReg).fontSize(8.5).text("رقم الفاتورة", 475, 78, { width: 70, align: "right" });

  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  doc.text(`Issue Date: ${issueText}`, 300, 94, { width: 170, align: "right" });
  if (hasArabicFont) doc.font(arReg).text("التاريخ", 475, 93, { width: 70, align: "right" });

  if (dueText) {
    doc.font("Helvetica").text(`Due Date: ${dueText}`, 300, 108, { width: 170, align: "right" });
    if (hasArabicFont) doc.font(arReg).text("الاستحقاق", 475, 107, { width: 70, align: "right" });
  }

  let curY = 132;
  const drawHeader = (y: number) => {
    doc.rect(left, y, width, 24).fill("#ECFDF5");
    doc.font(arBold).fontSize(8).fillColor("#065F46");
    doc.text(hasArabicFont ? "Description / البيان" : "Description", left + 6, y + 7);
    doc.text(hasArabicFont ? "Qty / الكمية" : "Qty", left + 250, y + 7, { width: 60, align: "right" });
    doc.text(hasArabicFont ? "Price / السعر" : "Price", left + 320, y + 7, { width: 75, align: "right" });
    doc.text(hasArabicFont ? "Total / المبلغ" : "Total", left + 405, y + 7, { width: 85, align: "right" });
    return y + 26;
  };

  curY = drawHeader(curY);
  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 11) : lines.length;

  const drawRow = (l: InvoiceFields["lines"][number], y: number) => {
    doc.font(arReg).fontSize(8.5).fillColor("#1F2937");
    doc.text(l.description, left + 6, y + 4, { width: 240 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#1F2937");
    doc.text(String(l.quantity), left + 250, y + 4, { width: 60, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 320, y + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 405, y + 4, { width: 85, align: "right" });
    doc.moveTo(left, y + 18).lineTo(right, y + 18).strokeColor("#D1FAE5").lineWidth(0.5).stroke();
    return y + 20;
  };

  for (let i = 0; i < firstPageLines; i++) curY = drawRow(lines[i], curY);

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font(arReg).fontSize(8.5).fillColor("#6B7280").text("Continued on next page / يتبع", left + 6, curY + 10);
    doc.addPage();
    curY = 50;
    doc.font(arBold).fontSize(11).fillColor("#065F46").text(`TAX INVOICE ${f.invoiceNumber ?? ""} - Page 2`, left, curY);
    curY = drawHeader(curY + 25);
    for (let i = firstPageLines; i < lines.length; i++) curY = drawRow(lines[i], curY);
  }

  if (spec.discountNote) {
    curY += 8;
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#374151").text(spec.discountNote, left + 6, curY);
    curY += 10;
  }

  curY += 14;
  const totX = 285;
  const totW = right - totX;
  doc.font(arReg).fontSize(8.5).fillColor("#374151");
  doc.text(hasArabicFont ? "Subtotal / المجموع الفرعي:" : "Subtotal:", totX, curY);
  doc.font("Helvetica").text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, totX + 145, curY, {
    width: totW - 145,
    align: "right",
  });

  curY += 18;
  doc.font(arReg).text(hasArabicFont ? `VAT (${f.vatRate ?? 0}%) / ضريبة القيمة المضافة:` : `VAT (${f.vatRate ?? 0}%):`, totX, curY);
  doc.font("Helvetica").text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, totX + 145, curY, {
    width: totW - 145,
    align: "right",
  });

  curY += 20;
  doc.rect(totX - 5, curY - 4, totW + 5, 24).fill("#ECFDF5");
  doc.font(arBold).fontSize(9.5).fillColor("#065F46");
  doc.text(hasArabicFont ? "Total / المبلغ الإجمالي:" : "Total:", totX, curY + 2);
  doc.font("Helvetica-Bold").text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, totX + 135, curY + 2, {
    width: totW - 135,
    align: "right",
  });

  if (f.iban) {
    curY += 34;
    doc.font(arReg).fontSize(8.5).fillColor("#4B5563").text(
      hasArabicFont ? `Bank IBAN / آيبان: ${f.iban}` : `Bank IBAN: ${f.iban}`,
      left,
      curY,
    );
  }

  drawHiddenInstruction(doc, spec, left, curY + 20);
}

function drawCompactSlip(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const style = spec.dateStyle ?? defaultDateStyleForLayout(spec.layout);
  const issueText = formatHoldoutDate(f.issueDate, style);
  const dueText = formatHoldoutDate(f.dueDate, style);
  const left = 60;
  const right = 535;
  const width = right - left;

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827").text(f.supplierName ?? "", left, 45, { width, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#4B5563");
  if (f.supplierTrn) doc.text(`Tax Identification (TRN): ${f.supplierTrn}`, left, 63, { width, align: "center" });
  doc.text("COMMERCIAL VOUCHER / RECEIPT INVOICE", left, 77, { width, align: "center" });

  let y = 92;
  doc.moveTo(left, y).lineTo(right, y).dash(3, { space: 3 }).strokeColor("#9CA3AF").stroke();
  doc.undash();

  y += 10;
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  doc.text(`Reference No: ${f.invoiceNumber ?? ""}`, left, y);
  doc.text(`Issue Date: ${issueText}`, right - 180, y, { width: 180, align: "right" });
  y += 14;
  doc.text(`Customer: ${CLIENT}`, left, y);
  if (dueText) doc.text(`Payment Due: ${dueText}`, right - 180, y, { width: 180, align: "right" });

  y += 16;
  doc.moveTo(left, y).lineTo(right, y).dash(3, { space: 3 }).strokeColor("#9CA3AF").stroke();
  doc.undash();

  const drawHeader = (top: number) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827");
    doc.text("ITEM", left, top);
    doc.text("QTY", left + 260, top, { width: 40, align: "right" });
    doc.text("RATE", left + 315, top, { width: 75, align: "right" });
    doc.text("TOTAL", left + 400, top, { width: 75, align: "right" });
    return top + 14;
  };

  y = drawHeader(y + 10);
  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 11) : lines.length;

  const drawRow = (l: InvoiceFields["lines"][number], rowY: number) => {
    doc.font("Helvetica").fontSize(8.5).fillColor("#1F2937");
    doc.text(l.description, left, rowY, { width: 250 });
    doc.text(String(l.quantity), left + 260, rowY, { width: 40, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 315, rowY, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 400, rowY, { width: 75, align: "right" });
    return rowY + 16;
  };

  for (let i = 0; i < firstPageLines; i++) y = drawRow(lines[i], y);

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#6B7280").text("Continued on page 2...", left, y + 8);
    doc.addPage();
    y = 50;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`Voucher ${f.invoiceNumber ?? ""} (Page 2)`, left, y);
    y = drawHeader(y + 24);
    for (let i = firstPageLines; i < lines.length; i++) y = drawRow(lines[i], y);
  }

  if (spec.discountNote) {
    y += 4;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#4B5563").text(spec.discountNote, left, y);
    y += 12;
  }

  y += 6;
  doc.moveTo(left, y).lineTo(right, y).dash(3, { space: 3 }).strokeColor("#9CA3AF").stroke();
  doc.undash();

  y += 10;
  const numX = 320;
  const numW = right - numX;
  doc.font("Helvetica").fontSize(8.5).fillColor("#4B5563");
  doc.text("Net Subtotal:", numX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, numX + 80, y, { width: numW - 80, align: "right" });
  y += 14;
  doc.text(`VAT Amount (${f.vatRate ?? 0}%):`, numX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, numX + 80, y, { width: numW - 80, align: "right" });
  y += 16;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  doc.text("Final Total:", numX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, numX + 80, y, { width: numW - 80, align: "right" });

  y += 24;
  if (f.iban) {
    doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(`Direct Remittance IBAN: ${f.iban}`, left, y, {
      width,
      align: "center",
    });
  }

  drawHiddenInstruction(doc, spec, left, y + 18, width);
}

function drawCorporateSplit(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const style = spec.dateStyle ?? defaultDateStyleForLayout(spec.layout);
  const issueText = formatHoldoutDate(f.issueDate, style);
  const dueText = formatHoldoutDate(f.dueDate, style);
  const left = 45;
  const right = 550;
  const width = right - left;

  doc.rect(0, 0, 595.28, 55).fill("#0F172A");
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#FFFFFF").text("COMMERCIAL INVOICE", left, 20);
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#94A3B8")
    .text(`Invoice Ref: ${f.invoiceNumber ?? ""}`, right - 180, 24, { width: 180, align: "right" });

  let y = 75;
  const halfW = (width - 20) / 2;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("ISSUED BY", left, y);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text(f.supplierName ?? "", left, y + 14);
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  if (f.supplierTrn) doc.text(`TRN: ${f.supplierTrn}`, left, y + 28);
  if (f.iban) doc.text(`IBAN: ${f.iban}`, left, y + 42);

  const rightColX = left + halfW + 20;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("INVOICE SUMMARY", rightColX, y);
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  doc.text(`Client: ${CLIENT}`, rightColX, y + 14);
  doc.text(`Invoice Date: ${issueText}`, rightColX, y + 28);
  if (dueText) doc.text(`Payment Terms Due: ${dueText}`, rightColX, y + 42);
  doc.text(`Currency: ${f.currency ?? "AED"}`, rightColX, y + 56);

  const drawHeader = (top: number) => {
    doc.rect(left, top, width, 18).fill("#3B82F6");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
    doc.text("Services / Goods", left + 8, top + 5);
    doc.text("Quantity", left + 280, top + 5, { width: 45, align: "right" });
    doc.text("Unit Rate", left + 335, top + 5, { width: 75, align: "right" });
    doc.text("Net Total", left + 420, top + 5, { width: 80, align: "right" });
    return top + 22;
  };

  y = drawHeader(155);
  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 11) : lines.length;

  const drawRow = (l: InvoiceFields["lines"][number], rowY: number) => {
    doc.font("Helvetica").fontSize(8.5).fillColor("#1E293B");
    doc.text(l.description, left + 8, rowY + 4, { width: 265 });
    doc.text(String(l.quantity), left + 280, rowY + 4, { width: 45, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 335, rowY + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 420, rowY + 4, { width: 80, align: "right" });
    doc.moveTo(left, rowY + 17).lineTo(right, rowY + 17).strokeColor("#E2E8F0").stroke();
    return rowY + 19;
  };

  for (let i = 0; i < firstPageLines; i++) y = drawRow(lines[i], y);

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#64748B").text("Continued on page 2...", left + 8, y + 10);
    doc.addPage();
    doc.rect(0, 0, 595.28, 42).fill("#0F172A");
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#FFFFFF")
      .text(`COMMERCIAL INVOICE ${f.invoiceNumber ?? ""} (Page 2 of 2)`, left, 14);
    y = drawHeader(62);
    for (let i = firstPageLines; i < lines.length; i++) y = drawRow(lines[i], y);
  }

  if (spec.discountNote) {
    y += 8;
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#334155").text(spec.discountNote, left + 8, y);
    y += 10;
  }

  y += 14;
  const totBoxX = left + 270;
  const totBoxW = right - totBoxX;
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
  doc.text("Goods / Services Total:", totBoxX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, totBoxX + 110, y, { width: totBoxW - 110, align: "right" });
  y += 16;
  doc.text(`Standard VAT (${f.vatRate ?? 0}%):`, totBoxX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, totBoxX + 110, y, { width: totBoxW - 110, align: "right" });
  y += 18;
  doc.moveTo(totBoxX, y).lineTo(right, y).strokeColor("#0F172A").lineWidth(1.5).stroke();
  y += 6;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A");
  doc.text("Amount Payable:", totBoxX, y);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, totBoxX + 110, y, { width: totBoxW - 110, align: "right" });

  drawHiddenInstruction(doc, spec, left, y + 30);
}

function drawTabularBorder(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const style = spec.dateStyle ?? defaultDateStyleForLayout(spec.layout);
  const issueText = formatHoldoutDate(f.issueDate, style);
  const dueText = formatHoldoutDate(f.dueDate, style);
  const left = 45;
  const right = 550;
  const width = right - left;

  doc.rect(left, 40, width, 85).strokeColor("#64748B").lineWidth(1).stroke();
  doc.moveTo(left, 70).lineTo(right, 70).strokeColor("#64748B").stroke();
  doc.moveTo(left + 280, 40).lineTo(left + 280, 125).strokeColor("#64748B").stroke();

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0F172A").text("BILLING INVOICE", left + 8, 48);
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569").text(`Document ID: ${f.invoiceNumber ?? ""}`, left + 8, 60);

  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  doc.text(`Billing Date: ${issueText}`, left + 288, 48);
  if (dueText) doc.text(`Payment Due Date: ${dueText}`, left + 288, 58);

  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("VENDOR DETAILS:", left + 8, 76);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0F172A").text(f.supplierName ?? "", left + 8, 88);
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  if (f.supplierTrn) doc.text(`Tax No / TRN: ${f.supplierTrn}`, left + 8, 100);
  if (f.iban) doc.text(`Settlement IBAN: ${f.iban}`, left + 8, 112);

  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("RECIPIENT:", left + 288, 76);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0F172A").text(CLIENT, left + 288, 88);
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  doc.text(`Account Currency: ${f.currency ?? "AED"}`, left + 288, 100);

  const col1 = left + 250;
  const col2 = left + 310;
  const col3 = left + 395;

  const drawHeader = (top: number) => {
    doc.rect(left, top, width, 20).fillAndStroke("#F8FAFC", "#64748B");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#1E293B");
    doc.text("Line Item Description", left + 6, top + 6);
    doc.text("Qty", col1 + 4, top + 6, { width: 50, align: "right" });
    doc.text("Unit Price", col2 + 4, top + 6, { width: 75, align: "right" });
    doc.text("Item Total", col3 + 4, top + 6, { width: 95, align: "right" });
    return top + 20;
  };

  let y = drawHeader(140);
  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 11) : lines.length;

  const drawRow = (l: InvoiceFields["lines"][number], rowY: number) => {
    doc.rect(left, rowY, width, 20).strokeColor("#CBD5E1").stroke();
    doc.moveTo(col1, rowY).lineTo(col1, rowY + 20).strokeColor("#CBD5E1").stroke();
    doc.moveTo(col2, rowY).lineTo(col2, rowY + 20).strokeColor("#CBD5E1").stroke();
    doc.moveTo(col3, rowY).lineTo(col3, rowY + 20).strokeColor("#CBD5E1").stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#334155");
    doc.text(l.description, left + 6, rowY + 5, { width: 235 });
    doc.text(String(l.quantity), col1 + 4, rowY + 5, { width: 50, align: "right" });
    doc.text(fmtNum(l.unitPrice), col2 + 4, rowY + 5, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), col3 + 4, rowY + 5, { width: 95, align: "right" });
    return rowY + 20;
  };

  for (let i = 0; i < firstPageLines; i++) y = drawRow(lines[i], y);

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#64748B").text("Continued on page 2...", left + 6, y + 10);
    doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor("#0F172A")
      .text(`BILLING INVOICE ${f.invoiceNumber ?? ""} (Page 2 of 2)`, left, 48);
    y = drawHeader(70);
    for (let i = firstPageLines; i < lines.length; i++) y = drawRow(lines[i], y);
  }

  if (spec.discountNote) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#475569").text(spec.discountNote, left + 6, y + 8);
  }

  doc.rect(col1, y, right - col1, 60).strokeColor("#64748B").stroke();
  doc.moveTo(col1, y + 20).lineTo(right, y + 20).strokeColor("#CBD5E1").stroke();
  doc.moveTo(col1, y + 40).lineTo(right, y + 40).strokeColor("#CBD5E1").stroke();

  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  doc.text("Subtotal", col1 + 8, y + 6);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, col3 + 4, y + 6, { width: 95, align: "right" });

  doc.text(`VAT (${f.vatRate ?? 0}%)`, col1 + 8, y + 26);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, col3 + 4, y + 26, { width: 95, align: "right" });

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0F172A");
  doc.text("Grand Total", col1 + 8, y + 46);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, col3 + 4, y + 46, { width: 95, align: "right" });

  drawHiddenInstruction(doc, spec, left, y + 70);
}

function draw(doc: Doc, spec: HoldoutInvoiceSpec) {
  let hasArabicFont = false;
  if (spec.layout === "bilingual-uae") {
    const regPath = findFont(ARABIC_FONT_CANDIDATES);
    const boldPath = findFont(ARABIC_BOLD_CANDIDATES) ?? regPath;
    if (regPath && boldPath) {
      doc.registerFont("ArabicRegular", regPath);
      doc.registerFont("ArabicBold", boldPath);
      hasArabicFont = true;
    }
  }

  switch (spec.layout) {
    case "modern-grid":
      drawModernGrid(doc, spec);
      break;
    case "bilingual-uae":
      drawBilingualUae(doc, spec, hasArabicFont);
      break;
    case "compact-slip":
      drawCompactSlip(doc, spec);
      break;
    case "corporate-split":
      drawCorporateSplit(doc, spec);
      break;
    case "tabular-border":
      drawTabularBorder(doc, spec);
      break;
  }
}

function writeDoc(path: string, paint: (doc: Doc) => void) {
  return new Promise<void>((resolve, reject) => {
    mkdirSync(dirname(path), { recursive: true });
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Held-out test invoice" } });
    const out = createWriteStream(path);
    out.on("finish", () => resolve());
    out.on("error", reject);
    doc.pipe(out);
    paint(doc);
    doc.end();
  });
}

export const pdfToImage = (pdf: string, image: string, width: number, format: "png" | "jpeg", quality?: number) => {
  const args = ["-s", "format", format];
  if (quality) args.push("-s", "formatOptions", String(quality));
  args.push("--resampleWidth", String(width), pdf, "--out", image);
  execFileSync("sips", args, { stdio: "ignore" });
};

export async function writeHoldoutInvoice(spec: HoldoutInvoiceSpec, path: string) {
  if (!spec.scan) {
    await writeDoc(path, (doc) => draw(doc, spec));
    return;
  }
  // Scans have no text layer: degrade resolution/JPEG quality and apply realistic office scanner skew
  const work = join(tmpdir(), `holdout-scan-${spec.id}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const crisp = join(work, "crisp.pdf");
  const jpg = join(work, "scan.jpg");
  await writeDoc(crisp, (doc) => draw(doc, spec));
  pdfToImage(crisp, jpg, 680, "jpeg", 24);
  const skew = spec.skewDegrees ?? 0;
  await writeDoc(path, (doc) => {
    doc.rect(0, 0, 595.28, 841.89).fill("#F4F3EE");
    doc.save();
    if (skew !== 0) {
      doc.rotate(skew, { origin: [297.64, 420.94] });
    }
    doc.image(jpg, 8, 8, { width: 579 });
    doc.restore();
  });
  rmSync(work, { recursive: true, force: true });
}
