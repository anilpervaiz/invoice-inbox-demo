import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import PDFDocument from "pdfkit";
import { CLIENT } from "../../lib/demo-data";
import type { InvoiceFields } from "../../lib/types";

export type HoldoutLayout =
  | "modern-grid"
  | "bilingual-uae"
  | "compact-slip"
  | "corporate-split"
  | "tabular-border";

export type HoldoutInvoiceSpec = {
  id: string;
  layout: HoldoutLayout;
  scan: boolean;
  multiPage?: boolean;
  hiddenInstruction?: {
    type: "visible" | "white-text";
    text: string;
  };
  fields: InvoiceFields;
  expected: {
    route: "ready" | "review" | "blocked";
    planted: string | null;
  };
};

type Doc = InstanceType<typeof PDFDocument>;

const fmtNum = (n: number | null) =>
  n !== null ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

function drawModernGrid(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const left = 45;
  const right = 550;
  const contentWidth = right - left;

  // Header Banner
  doc.rect(left, 40, contentWidth, 36).fill("#1E3A8A");
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#FFFFFF").text("TAX INVOICE", left + 14, 52);
  doc.font("Helvetica").fontSize(10).fillColor("#E0E7FF").text(f.invoiceNumber ? `# ${f.invoiceNumber}` : "", right - 150, 53, { width: 136, align: "right" });

  // Two Column Metadata Box
  const metaY = 88;
  const colWidth = (contentWidth - 10) / 2;

  // Left: Supplier details
  doc.rect(left, metaY, colWidth, 75).strokeColor("#CBD5E1").lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E293B").text("SUPPLIER DETAILS", left + 8, metaY + 8);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#0F172A").text(f.supplierName ?? "Unknown Supplier", left + 8, metaY + 22, { width: colWidth - 16 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
  if (f.supplierTrn) doc.text(`Tax Registration (TRN): ${f.supplierTrn}`, left + 8, metaY + 44);
  if (f.iban) doc.text(`Payment IBAN: ${f.iban}`, left + 8, metaY + 58);

  // Right: Invoice details & Billed To
  const rightX = left + colWidth + 10;
  doc.rect(rightX, metaY, colWidth, 75).strokeColor("#CBD5E1").lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#1E293B").text("INVOICE & CLIENT INFO", rightX + 8, metaY + 8);
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
  doc.text(`Issue Date: ${f.issueDate ?? "N/A"}`, rightX + 8, metaY + 22);
  if (f.dueDate) doc.text(`Due Date: ${f.dueDate}`, rightX + 8, metaY + 36);
  doc.text(`Currency: ${f.currency ?? "AED"}`, rightX + 8, metaY + 50);
  doc.text(`Billed To: ${CLIENT}`, rightX + 8, metaY + 64);

  // Lines Table
  let curY = 175;
  doc.rect(left, curY, contentWidth, 20).fill("#F1F5F9");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#334155");
  doc.text("Item / Description", left + 8, curY + 6);
  doc.text("Qty", left + 270, curY + 6, { width: 45, align: "right" });
  doc.text("Unit Price", left + 325, curY + 6, { width: 75, align: "right" });
  doc.text("Amount", left + 410, curY + 6, { width: 85, align: "right" });
  curY += 22;

  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 12) : lines.length;

  for (let i = 0; i < firstPageLines; i++) {
    const l = lines[i];
    doc.font("Helvetica").fontSize(8.5).fillColor("#1E293B");
    doc.text(l.description, left + 8, curY + 4, { width: 255 });
    doc.text(String(l.quantity), left + 270, curY + 4, { width: 45, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 325, curY + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 410, curY + 4, { width: 85, align: "right" });
    doc.moveTo(left, curY + 18).lineTo(right, curY + 18).strokeColor("#E2E8F0").stroke();
    curY += 20;
  }

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#64748B").text("Continued on next page...", left + 8, curY + 10);
    doc.addPage();
    curY = 50;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1E3A8A").text(`TAX INVOICE ${f.invoiceNumber ?? ""} (Page 2 of 2)`, left, curY);
    curY += 25;
    doc.rect(left, curY, contentWidth, 20).fill("#F1F5F9");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#334155");
    doc.text("Item / Description", left + 8, curY + 6);
    doc.text("Qty", left + 270, curY + 6, { width: 45, align: "right" });
    doc.text("Unit Price", left + 325, curY + 6, { width: 75, align: "right" });
    doc.text("Amount", left + 410, curY + 6, { width: 85, align: "right" });
    curY += 24;

    for (let i = firstPageLines; i < lines.length; i++) {
      const l = lines[i];
      doc.font("Helvetica").fontSize(8.5).fillColor("#1E293B");
      doc.text(l.description, left + 8, curY + 4, { width: 255 });
      doc.text(String(l.quantity), left + 270, curY + 4, { width: 45, align: "right" });
      doc.text(fmtNum(l.unitPrice), left + 325, curY + 4, { width: 75, align: "right" });
      doc.text(fmtNum(l.amount), left + 410, curY + 4, { width: 85, align: "right" });
      doc.moveTo(left, curY + 18).lineTo(right, curY + 18).strokeColor("#E2E8F0").stroke();
      curY += 20;
    }
  }

  // Totals Area
  curY += 12;
  const summaryX = left + 280;
  const summaryWidth = right - summaryX;
  doc.rect(summaryX, curY, summaryWidth, 68).fill("#F8FAFC");
  doc.rect(summaryX, curY, summaryWidth, 68).strokeColor("#CBD5E1").stroke();

  doc.font("Helvetica").fontSize(9).fillColor("#475569");
  doc.text("Subtotal:", summaryX + 12, curY + 10);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, summaryX + 100, curY + 10, { width: summaryWidth - 112, align: "right" });

  doc.text(`VAT (${f.vatRate ?? 0}%):`, summaryX + 12, curY + 26);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, summaryX + 100, curY + 26, { width: summaryWidth - 112, align: "right" });

  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0F172A");
  doc.text("Invoice Total:", summaryX + 12, curY + 46);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, summaryX + 100, curY + 46, { width: summaryWidth - 112, align: "right" });

  // Hidden Instruction / Injection check
  if (spec.hiddenInstruction) {
    if (spec.hiddenInstruction.type === "white-text") {
      doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820);
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#DC2626").text(`NOTE: ${spec.hiddenInstruction.text}`, left, curY + 80);
    }
  }
}

function drawBilingualUae(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const left = 50;
  const right = 545;
  const width = right - left;

  // Title with Dual Arabic / English
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#065F46").text("TAX INVOICE / فاتورة ضريبية", left, 45);
  doc.moveTo(left, 66).lineTo(right, 66).strokeColor("#065F46").lineWidth(2).stroke();

  // Top Section: Supplier on left, Invoice details on right
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(f.supplierName ?? "", left, 76);
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  if (f.supplierTrn) doc.text(`TRN / الرقم الضريبي: ${f.supplierTrn}`, left, 92);
  doc.text(`Customer / العميل: ${CLIENT}`, left, 106);

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
  doc.text(`Invoice No / رقم الفاتورة: ${f.invoiceNumber ?? ""}`, 310, 76, { width: 235, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  doc.text(`Date / التاريخ: ${f.issueDate ?? ""}`, 310, 92, { width: 235, align: "right" });
  if (f.dueDate) doc.text(`Due Date / تاريخ الاستحقاق: ${f.dueDate}`, 310, 106, { width: 235, align: "right" });

  // Table
  let curY = 130;
  doc.rect(left, curY, width, 22).fill("#ECFDF5");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#065F46");
  doc.text("Description / البيان", left + 6, curY + 6);
  doc.text("Qty / الكمية", left + 260, curY + 6, { width: 50, align: "right" });
  doc.text("Price / السعر", left + 320, curY + 6, { width: 75, align: "right" });
  doc.text("Total / المبلغ", left + 405, curY + 6, { width: 85, align: "right" });
  curY += 24;

  const lines = f.lines;
  const firstPageLines = spec.multiPage ? Math.min(lines.length, 12) : lines.length;

  for (let i = 0; i < firstPageLines; i++) {
    const l = lines[i];
    doc.font("Helvetica").fontSize(8.5).fillColor("#1F2937");
    doc.text(l.description, left + 6, curY + 4, { width: 250 });
    doc.text(String(l.quantity), left + 260, curY + 4, { width: 50, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 320, curY + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 405, curY + 4, { width: 85, align: "right" });
    doc.moveTo(left, curY + 18).lineTo(right, curY + 18).strokeColor("#D1FAE5").lineWidth(0.5).stroke();
    curY += 20;
  }

  if (spec.multiPage && lines.length > firstPageLines) {
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#6B7280").text("Continued on next page / يتبع في الصفحة التالية...", left + 6, curY + 10);
    doc.addPage();
    curY = 50;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#065F46").text(`TAX INVOICE ${f.invoiceNumber ?? ""} (Page 2 / صفحة 2)`, left, curY);
    curY += 25;
    doc.rect(left, curY, width, 22).fill("#ECFDF5");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#065F46");
    doc.text("Description / البيان", left + 6, curY + 6);
    doc.text("Qty / الكمية", left + 260, curY + 6, { width: 50, align: "right" });
    doc.text("Price / السعر", left + 320, curY + 6, { width: 75, align: "right" });
    doc.text("Total / المبلغ", left + 405, curY + 6, { width: 85, align: "right" });
    curY += 24;

    for (let i = firstPageLines; i < lines.length; i++) {
      const l = lines[i];
      doc.font("Helvetica").fontSize(8.5).fillColor("#1F2937");
      doc.text(l.description, left + 6, curY + 4, { width: 250 });
      doc.text(String(l.quantity), left + 260, curY + 4, { width: 50, align: "right" });
      doc.text(fmtNum(l.unitPrice), left + 320, curY + 4, { width: 75, align: "right" });
      doc.text(fmtNum(l.amount), left + 405, curY + 4, { width: 85, align: "right" });
      doc.moveTo(left, curY + 18).lineTo(right, curY + 18).strokeColor("#D1FAE5").lineWidth(0.5).stroke();
      curY += 20;
    }
  }

  // Dual Totals
  curY += 14;
  const totX = 300;
  const totW = right - totX;
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  doc.text("Subtotal / المجموع الخاضع للضريبة:", totX, curY);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.subtotal)}`, totX + 130, curY, { width: totW - 130, align: "right" });

  curY += 18;
  doc.text(`VAT (${f.vatRate ?? 0}%) / ضريبة القيمة المضافة:`, totX, curY);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.vatAmount)}`, totX + 130, curY, { width: totW - 130, align: "right" });

  curY += 20;
  doc.rect(totX - 5, curY - 4, totW + 5, 24).fill("#ECFDF5");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#065F46");
  doc.text("Total / المبلغ الإجمالي:", totX, curY + 2);
  doc.text(`${f.currency ?? "AED"} ${fmtNum(f.total)}`, totX + 110, curY + 2, { width: totW - 110, align: "right" });

  if (f.iban) {
    curY += 34;
    doc.font("Helvetica").fontSize(8.5).fillColor("#4B5563").text(`Bank IBAN / الحساب المصرفي (آيبان): ${f.iban}`, left, curY);
  }

  if (spec.hiddenInstruction) {
    if (spec.hiddenInstruction.type === "white-text") {
      doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820);
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#DC2626").text(`SYSTEM NOTE: ${spec.hiddenInstruction.text}`, left, curY + 20);
    }
  }
}

function drawCompactSlip(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const left = 60;
  const right = 535;
  const width = right - left;

  // Centered Header
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827").text(f.supplierName ?? "", left, 45, { width, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#4B5563");
  if (f.supplierTrn) doc.text(`Tax Identification (TRN): ${f.supplierTrn}`, left, 63, { width, align: "center" });
  doc.text("COMMERCIAL VOUCHER / RECEIPT INVOICE", left, 77, { width, align: "center" });

  // Dotted line separator
  let y = 92;
  doc.moveTo(left, y).lineTo(right, y).dash(3, { space: 3 }).strokeColor("#9CA3AF").stroke();
  doc.undash();

  y += 10;
  doc.font("Helvetica").fontSize(8.5).fillColor("#374151");
  doc.text(`Reference No: ${f.invoiceNumber ?? ""}`, left, y);
  doc.text(`Issue Date: ${f.issueDate ?? ""}`, right - 180, y, { width: 180, align: "right" });
  y += 14;
  doc.text(`Customer: ${CLIENT}`, left, y);
  if (f.dueDate) doc.text(`Payment Due: ${f.dueDate}`, right - 180, y, { width: 180, align: "right" });

  y += 16;
  doc.moveTo(left, y).lineTo(right, y).dash(3, { space: 3 }).strokeColor("#9CA3AF").stroke();
  doc.undash();

  y += 10;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#111827");
  doc.text("ITEM", left, y);
  doc.text("QTY", left + 260, y, { width: 40, align: "right" });
  doc.text("RATE", left + 315, y, { width: 75, align: "right" });
  doc.text("TOTAL", left + 400, y, { width: 75, align: "right" });
  y += 14;

  const lines = f.lines;
  for (const l of lines) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#1F2937");
    doc.text(l.description, left, y, { width: 250 });
    doc.text(String(l.quantity), left + 260, y, { width: 40, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 315, y, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 400, y, { width: 75, align: "right" });
    y += 16;
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
    doc.font("Helvetica").fontSize(8).fillColor("#6B7280").text(`Direct Remittance IBAN: ${f.iban}`, left, y, { width, align: "center" });
  }

  if (spec.hiddenInstruction) {
    if (spec.hiddenInstruction.type === "white-text") {
      doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820);
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#DC2626").text(`ATTENTION: ${spec.hiddenInstruction.text}`, left, y + 16, { width, align: "center" });
    }
  }
}

function drawCorporateSplit(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const left = 45;
  const right = 550;
  const width = right - left;

  // Navy Top Banner
  doc.rect(0, 0, 595.28, 55).fill("#0F172A");
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#FFFFFF").text("COMMERCIAL INVOICE", left, 20);
  doc.font("Helvetica").fontSize(9.5).fillColor("#94A3B8").text(`Invoice Ref: ${f.invoiceNumber ?? ""}`, right - 180, 24, { width: 180, align: "right" });

  // Split Columns
  let y = 75;
  const halfW = (width - 20) / 2;

  // Left: Provider
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("ISSUED BY", left, y);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F172A").text(f.supplierName ?? "", left, y + 14);
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  if (f.supplierTrn) doc.text(`TRN: ${f.supplierTrn}`, left, y + 28);
  if (f.iban) doc.text(`IBAN: ${f.iban}`, left, y + 42);

  // Right: Billed To & Dates
  const rightColX = left + halfW + 20;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("INVOICE SUMMARY", rightColX, y);
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  doc.text(`Client: ${CLIENT}`, rightColX, y + 14);
  doc.text(`Invoice Date: ${f.issueDate ?? ""}`, rightColX, y + 28);
  if (f.dueDate) doc.text(`Payment Terms Due: ${f.dueDate}`, rightColX, y + 42);
  doc.text(`Currency: ${f.currency ?? "AED"}`, rightColX, y + 56);

  // Line Items
  y = 155;
  doc.rect(left, y, width, 18).fill("#3B82F6");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF");
  doc.text("Services / Goods", left + 8, y + 5);
  doc.text("Quantity", left + 280, y + 5, { width: 45, align: "right" });
  doc.text("Unit Rate", left + 335, y + 5, { width: 75, align: "right" });
  doc.text("Net Total", left + 420, y + 5, { width: 80, align: "right" });
  y += 22;

  for (const l of f.lines) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#1E293B");
    doc.text(l.description, left + 8, y + 4, { width: 265 });
    doc.text(String(l.quantity), left + 280, y + 4, { width: 45, align: "right" });
    doc.text(fmtNum(l.unitPrice), left + 335, y + 4, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), left + 420, y + 4, { width: 80, align: "right" });
    doc.moveTo(left, y + 17).lineTo(right, y + 17).strokeColor("#E2E8F0").stroke();
    y += 19;
  }

  // Bottom Box
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

  if (spec.hiddenInstruction) {
    if (spec.hiddenInstruction.type === "white-text") {
      doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820);
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#DC2626").text(`DISPATCH ADVISORY: ${spec.hiddenInstruction.text}`, left, y + 30);
    }
  }
}

function drawTabularBorder(doc: Doc, spec: HoldoutInvoiceSpec) {
  const f = spec.fields;
  const left = 45;
  const right = 550;
  const width = right - left;

  // Grid / Spreadsheet Style Top Frame
  doc.rect(left, 40, width, 85).strokeColor("#64748B").lineWidth(1).stroke();
  doc.moveTo(left, 70).lineTo(right, 70).strokeColor("#64748B").stroke();
  doc.moveTo(left + 280, 40).lineTo(left + 280, 125).strokeColor("#64748B").stroke();

  // Top Left Box
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0F172A").text("BILLING INVOICE", left + 8, 48);
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569").text(`Document ID: ${f.invoiceNumber ?? ""}`, left + 8, 58);

  // Top Right Box
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
  doc.text(`Billing Date: ${f.issueDate ?? ""}`, left + 288, 48);
  if (f.dueDate) doc.text(`Payment Due Date: ${f.dueDate}`, left + 288, 58);

  // Bottom Left Box
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("VENDOR DETAILS:", left + 8, 76);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0F172A").text(f.supplierName ?? "", left + 8, 88);
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  if (f.supplierTrn) doc.text(`Tax No / TRN: ${f.supplierTrn}`, left + 8, 100);
  if (f.iban) doc.text(`Settlement IBAN: ${f.iban}`, left + 8, 112);

  // Bottom Right Box
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#475569").text("RECIPIENT:", left + 288, 76);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0F172A").text(CLIENT, left + 288, 88);
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  doc.text(`Account Currency: ${f.currency ?? "AED"}`, left + 288, 100);

  // Full Bordered Table
  let y = 140;
  const col1 = left + 250;
  const col2 = left + 310;
  const col3 = left + 395;

  // Header Row
  doc.rect(left, y, width, 20).fillAndStroke("#F8FAFC", "#64748B");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#1E293B");
  doc.text("Line Item Description", left + 6, y + 6);
  doc.text("Qty", col1 + 4, y + 6, { width: 50, align: "right" });
  doc.text("Unit Price", col2 + 4, y + 6, { width: 75, align: "right" });
  doc.text("Item Total", col3 + 4, y + 6, { width: 95, align: "right" });
  y += 20;

  for (const l of f.lines) {
    doc.rect(left, y, width, 20).strokeColor("#CBD5E1").stroke();
    // vertical dividers
    doc.moveTo(col1, y).lineTo(col1, y + 20).strokeColor("#CBD5E1").stroke();
    doc.moveTo(col2, y).lineTo(col2, y + 20).strokeColor("#CBD5E1").stroke();
    doc.moveTo(col3, y).lineTo(col3, y + 20).strokeColor("#CBD5E1").stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#334155");
    doc.text(l.description, left + 6, y + 5, { width: 235 });
    doc.text(String(l.quantity), col1 + 4, y + 5, { width: 50, align: "right" });
    doc.text(fmtNum(l.unitPrice), col2 + 4, y + 5, { width: 75, align: "right" });
    doc.text(fmtNum(l.amount), col3 + 4, y + 5, { width: 95, align: "right" });
    y += 20;
  }

  // Totals Grid
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

  if (spec.hiddenInstruction) {
    if (spec.hiddenInstruction.type === "white-text") {
      doc.font("Helvetica").fontSize(1).fillColor("#FFFFFF").text(spec.hiddenInstruction.text, left, 820);
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#DC2626").text(`AUDIT OVERRIDE: ${spec.hiddenInstruction.text}`, left, y + 70);
    }
  }
}

function draw(doc: Doc, spec: HoldoutInvoiceSpec) {
  switch (spec.layout) {
    case "modern-grid":
      drawModernGrid(doc, spec);
      break;
    case "bilingual-uae":
      drawBilingualUae(doc, spec);
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
  // Scans have no text layer: convert page to degraded image and embed in clean PDF
  const work = join(tmpdir(), `holdout-scan-${spec.id}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const crisp = join(work, "crisp.pdf");
  const jpg = join(work, "scan.jpg");
  await writeDoc(crisp, (doc) => draw(doc, spec));
  pdfToImage(crisp, jpg, 720, "jpeg", 25);
  await writeDoc(path, (doc) => {
    doc.image(jpg, 0, 0, { width: 595.28 });
  });
  rmSync(work, { recursive: true, force: true });
}
