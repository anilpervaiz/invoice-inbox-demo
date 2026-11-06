import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import PDFDocument from "pdfkit";
import { CLIENT } from "../lib/demo-data";
import type { InvoiceFields } from "../lib/types";

export type Layout = "classic" | "band" | "minimal" | "panel" | "stripe";

export type InvoiceSpec = {
  id: string;
  layout: Layout;
  scan: boolean;
  fields: InvoiceFields;
  // What the checks should do with this invoice, and why.
  expected: { route: "ready" | "review" | "blocked"; planted: string | null };
};

type Doc = InstanceType<typeof PDFDocument>;

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const dateText = (iso: string | null, layout: Layout) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (layout === "classic") return `${d} ${MONTHS[m - 1]} ${y}`;
  if (layout === "band") return iso;
  if (layout === "minimal") return `${LONG_MONTHS[m - 1]} ${d}, ${y}`;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
};

function table(doc: Doc, f: InvoiceFields, top: number, heading: string[], stripe?: string) {
  const cols = [50, 330, 385, 470];
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#333");
  doc.text(heading[0], cols[0], top);
  doc.text(heading[1], cols[1], top, { width: 45, align: "right" });
  doc.text(heading[2], cols[2], top, { width: 70, align: "right" });
  doc.text(heading[3], cols[3], top, { width: 75, align: "right" });
  doc.moveTo(50, top + 14).lineTo(545, top + 14).strokeColor("#999").stroke();
  let y = top + 22;
  f.lines.forEach((l, i) => {
    if (stripe && i % 2 === 0) doc.rect(50, y - 4, 495, 18).fill(stripe);
    doc.font("Helvetica").fontSize(9.5).fillColor("#222");
    doc.text(l.description, cols[0] + 2, y, { lineBreak: false });
    doc.text(String(l.quantity), cols[1], y, { width: 45, align: "right" });
    doc.text(money(l.unitPrice), cols[2], y, { width: 70, align: "right" });
    doc.text(money(l.amount), cols[3], y, { width: 75, align: "right" });
    y += 20;
  });
  doc.moveTo(50, y).lineTo(545, y).strokeColor("#ccc").stroke();
  return y + 14;
}

function totals(doc: Doc, y: number, rows: [string, string, boolean?][]) {
  rows.forEach(([label, value, bold]) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor("#222");
    doc.text(label, 330, y, { width: 125, align: "left" });
    doc.text(value, 460, y, { width: 85, align: "right" });
    y += bold ? 22 : 18;
  });
  return y;
}

function draw(doc: Doc, s: InvoiceSpec) {
  const f = s.fields;
  const cur = f.currency ?? "AED";
  const rate = f.vatRate ?? 0;
  const issue = dateText(f.issueDate, s.layout);
  const due = dateText(f.dueDate, s.layout);
  const sub = money(f.subtotal ?? 0);
  const vat = money(f.vatAmount ?? 0);
  const tot = money(f.total ?? 0);

  if (s.layout === "classic") {
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(f.supplierName ?? "", 50, 50, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor("#444").text("Office 412, Business Bay, Dubai", 50, 70);
    if (f.supplierTrn) doc.text(`TRN: ${f.supplierTrn}`, 50, 83);
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111").text("TAX INVOICE", 345, 50, { width: 200, align: "right" });
    doc.font("Helvetica-Bold").fontSize(9).text("Bill to", 50, 125);
    doc.font("Helvetica").text(CLIENT, 50, 138);
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`Invoice No: ${f.invoiceNumber}`, 345, 125, { width: 200, align: "right" });
    doc.text(`Date: ${issue}`, 345, 139, { width: 200, align: "right" });
    if (due) doc.text(`Due Date: ${due}`, 345, 153, { width: 200, align: "right" });
    const y = table(doc, f, 195, ["Description", "Qty", "Unit price", `Amount (${cur})`]);
    const end = totals(doc, y, [
      ["Subtotal", sub],
      [`VAT (${rate}%)`, vat],
      [`Total ${cur}`, tot, true],
    ]);
    doc.font("Helvetica").fontSize(9).fillColor("#444").text(`Pay by bank transfer. IBAN: ${f.iban}`, 50, end + 30);
  }

  if (s.layout === "band") {
    doc.rect(0, 0, 595, 96).fill("#16324F");
    doc.font("Helvetica-Bold").fontSize(17).fillColor("#fff").text(f.supplierName ?? "", 50, 34, { lineBreak: false });
    if (f.supplierTrn) doc.font("Helvetica").fontSize(9).fillColor("#D5E0EA").text(`Tax Registration No: ${f.supplierTrn}`, 50, 60);
    doc.fillColor("#222").font("Helvetica").fontSize(10);
    doc.text(`Invoice Number: ${f.invoiceNumber}`, 50, 120);
    doc.text(`Invoice Date: ${issue}`, 50, 136);
    if (due) doc.text(`Due Date: ${due}`, 50, 152);
    doc.font("Helvetica-Bold").text("Customer", 345, 120);
    doc.font("Helvetica").text(CLIENT, 345, 136);
    const y = table(doc, f, 190, ["Item", "Qty", "Rate", "Total"]);
    const end = totals(doc, y, [
      ["Sub Total", sub],
      [`VAT @ ${rate}%`, vat],
      [`Grand Total ${cur}`, tot, true],
    ]);
    doc.font("Helvetica").fontSize(9).fillColor("#444").text(`IBAN: ${f.iban}`, 50, end + 26);
  }

  if (s.layout === "minimal") {
    doc.font("Helvetica").fontSize(22).fillColor("#111").text("Invoice", 50, 50);
    doc.font("Helvetica-Bold").fontSize(11).text(f.supplierName ?? "", 50, 90, { lineBreak: false });
    if (f.supplierTrn) doc.font("Helvetica").fontSize(9).fillColor("#555").text(`TRN ${f.supplierTrn}`, 50, 106);
    doc.font("Helvetica").fontSize(10).fillColor("#222");
    doc.text(`Invoice # ${f.invoiceNumber}`, 345, 90, { width: 200, align: "right" });
    doc.text(`Issued ${issue}`, 345, 105, { width: 200, align: "right" });
    if (due) doc.text(`Payment due ${due}`, 345, 120, { width: 200, align: "right" });
    doc.fontSize(9).fillColor("#555").text("To", 50, 140);
    doc.fillColor("#222").text(CLIENT, 50, 152);
    const y = table(doc, f, 190, ["Service", "Units", "Price", cur]);
    const end = totals(doc, y, [
      ["Net amount", sub],
      [`Tax (${rate}%)`, vat],
      [`Amount payable ${cur}`, tot, true],
    ]);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Bank details: IBAN ${f.iban}`, 50, end + 26);
  }

  if (s.layout === "panel") {
    doc.rect(50, 50, 495, 92).strokeColor("#222").stroke();
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#111").text(f.supplierName ?? "", 62, 60, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor("#333").text("P.O. Box 22918, Dubai, UAE", 62, 78);
    if (f.supplierTrn) doc.text(`VAT Reg No: ${f.supplierTrn}`, 62, 92);
    doc.text(`Sold to: ${CLIENT}`, 62, 118);
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`Tax Invoice No: ${f.invoiceNumber}`, 335, 62, { width: 200, align: "right" });
    doc.text(`Invoice Date: ${issue}`, 335, 78, { width: 200, align: "right" });
    if (due) doc.text(`Due: ${due}`, 335, 94, { width: 200, align: "right" });
    const y = table(doc, f, 165, ["Particulars", "Qty", "Unit", `Value ${cur}`]);
    const end = totals(doc, y, [
      ["Taxable Amount", sub],
      [`VAT ${rate}%`, vat],
      [`Total Due ${cur}`, tot, true],
    ]);
    doc.font("Helvetica").fontSize(9).fillColor("#333").text(`Bank IBAN: ${f.iban}`, 50, end + 24);
  }

  if (s.layout === "stripe") {
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0B5D4E").text(f.supplierName ?? "", 50, 48, { lineBreak: false });
    doc.font("Helvetica").fontSize(9).fillColor("#444");
    if (f.supplierTrn) doc.text(`TRN: ${f.supplierTrn}`, 50, 68);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#222").text("INVOICE", 345, 50, { width: 200, align: "right" });
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`Inv No: ${f.invoiceNumber}`, 345, 66, { width: 200, align: "right" });
    doc.text(`Date: ${issue}`, 345, 80, { width: 200, align: "right" });
    if (due) doc.text(`Due Date: ${due}`, 345, 94, { width: 200, align: "right" });
    doc.text(`Billed to ${CLIENT}`, 50, 120);
    const y = table(doc, f, 150, ["Description", "Hours", "Rate", "Amount"], "#EEF5F3");
    const end = totals(doc, y, [
      ["Subtotal", sub],
      [`VAT ${rate}%`, vat],
      [`Balance Due ${cur}`, tot, true],
    ]);
    doc.font("Helvetica").fontSize(9).fillColor("#444").text(`Remit to IBAN: ${f.iban}`, 50, end + 24);
  }
}

function writeDoc(path: string, paint: (doc: Doc) => void) {
  return new Promise<void>((resolve, reject) => {
    mkdirSync(dirname(path), { recursive: true });
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "Sample invoice for a demo" } });
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

export async function writeInvoice(spec: InvoiceSpec, path: string) {
  if (!spec.scan) {
    await writeDoc(path, (doc) => draw(doc, spec));
    return;
  }
  // A scan has no text layer: render the page, degrade it, and put the image back in a PDF.
  const work = join(tmpdir(), `invoice-${spec.id}-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const crisp = join(work, "page.pdf");
  const jpg = join(work, "page.jpg");
  await writeDoc(crisp, (doc) => draw(doc, spec));
  pdfToImage(crisp, jpg, 760, "jpeg", 30);
  await writeDoc(path, (doc) => {
    doc.image(jpg, 0, 0, { width: 595.28 });
  });
  rmSync(work, { recursive: true, force: true });
}
