import { POSTED, SUPPLIERS } from "../lib/demo-data";
import type { InvoiceFields, LineItem, Supplier } from "../lib/types";
import type { InvoiceSpec, Layout } from "./invoice-pdf";

const round = (n: number) => Math.round(n * 100) / 100;

function build(
  supplier: Supplier,
  invoiceNumber: string,
  issueDate: string,
  dueDate: string | null,
  lines: LineItem[],
  currency = "AED",
  vatRate = 5,
): InvoiceFields {
  const subtotal = round(lines.reduce((a, l) => a + l.amount, 0));
  const vatAmount = round((subtotal * vatRate) / 100);
  return {
    supplierName: supplier.name,
    supplierTrn: supplier.trn,
    invoiceNumber,
    issueDate,
    dueDate,
    currency,
    subtotal,
    vatRate,
    vatAmount,
    total: round(subtotal + vatAmount),
    iban: supplier.iban,
    lines,
  };
}

const line = (description: string, quantity: number, unitPrice: number): LineItem => ({
  description,
  quantity,
  unitPrice,
  amount: round(quantity * unitPrice),
});

const [creek, dhow, palm, falcon, salt, , northgate] = SUPPLIERS;

const wrongTotal = build(dhow, "BD-7741", "2026-10-22", "2026-11-21", [
  line("Annual report printing, 500 copies", 500, 7.2),
  line("Folded brochures, A4", 1000, 1.2),
]);

// The six invoices shown when the demo opens.
export const SAMPLES: (InvoiceSpec & { title: string })[] = [
  {
    id: "wrong-total",
    title: "Total doesn't add up",
    layout: "band",
    scan: false,
    // Lines plus VAT come to 5,040.00, but the invoice prints 5,380.00.
    fields: { ...wrongTotal, total: 5380 },
    expected: { route: "review", planted: "wrong_total" },
  },
  {
    id: "new-iban",
    title: "Bank details changed",
    layout: "panel",
    scan: false,
    fields: {
      ...build(falcon, "SF-88342", "2026-10-29", "2026-11-12", [
        line("Same day courier, Dubai", 42, 18),
        line("Next day courier, Abu Dhabi", 15, 32),
      ]),
      iban: "AE00 0990 0000 2200 4471 186",
    },
    expected: { route: "blocked", planted: "iban_change" },
  },
  {
    id: "duplicate",
    title: "Already posted",
    layout: "minimal",
    scan: false,
    fields: build(palm, "PRC-2291", "2026-10-14", "2026-11-13", [
      line("Client lunch catering, 40 people", 40, 65),
      line("Delivery and setup", 1, 600),
    ]),
    expected: { route: "blocked", planted: "duplicate" },
  },
  {
    id: "scan",
    title: "Scanned invoice",
    layout: "classic",
    scan: true,
    fields: build(salt, "SW-3306", "2026-10-26", "2026-11-25", [
      line("Monthly IT support, October", 1, 2200),
      line("Laptop setup", 3, 180),
    ]),
    expected: { route: "review", planted: null },
  },
  {
    id: "clean-local",
    title: "Clean local invoice",
    layout: "classic",
    scan: false,
    fields: build(creek, "INV-20418", "2026-10-20", "2026-11-19", [
      line("A4 copy paper, boxes", 12, 85),
      line("Printer toner, black", 4, 260),
      line("Desk organisers", 10, 35),
    ]),
    expected: { route: "ready", planted: null },
  },
  {
    id: "clean-foreign",
    title: "Clean foreign invoice",
    layout: "stripe",
    scan: false,
    fields: build(
      northgate,
      "NG-1182",
      "2026-11-01",
      "2026-12-01",
      [line("Accounting software licence", 5, 49), line("Priority support", 1, 120)],
      "USD",
      0,
    ),
    expected: { route: "ready", planted: null },
  },
];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITEMS: [string, number, number][] = [
  ["Monthly support retainer", 1, 2400],
  ["Printer toner cartridges", 6, 240],
  ["Office cleaning visits", 8, 180],
  ["Courier deliveries", 24, 22],
  ["Staff lunch catering", 30, 55],
  ["Network cabling work", 12, 95],
  ["Brochure printing", 800, 1.35],
  ["Software licences", 6, 120],
  ["Meeting room hire", 4, 450],
  ["Stationery bundle", 15, 38],
  ["Air conditioning service", 3, 320],
  ["Translation of contracts", 7, 150],
];

// 40 invoices across all five layouts, from a fixed seed so every run tests the same files.
export function testSet(): InvoiceSpec[] {
  const random = rng(20261105);
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const layouts: Layout[] = ["classic", "band", "minimal", "panel", "stripe"];
  const local = SUPPLIERS.filter((s) => s.country === "AE");
  const planted = ["wrong_total", "wrong_vat", "bad_lines", "duplicate", "iban_change", "wrong_total", "wrong_vat", "iban_change", "bad_lines", "duplicate", "wrong_total", "iban_change"];
  const specs: InvoiceSpec[] = [];

  for (let i = 0; i < 40; i++) {
    const supplier = pick(local);
    const day = 1 + Math.floor(random() * 27);
    const month = 8 + Math.floor(random() * 2);
    const issue = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const due = `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = 1 + Math.floor(random() * 4);
    const chosen = [...ITEMS].sort(() => random() - 0.5).slice(0, count);
    const lines = chosen.map(([d, q, p]) => line(d, q, p));
    const prefix = supplier.name.slice(0, 2).toUpperCase();
    const number = `${prefix}-${10000 + Math.floor(random() * 80000)}`;
    let fields = build(supplier, number, issue, due, lines);
    const plant = i % 3 === 0 ? (planted[(i / 3) % planted.length] ?? null) : null;
    let route: InvoiceSpec["expected"]["route"] = "ready";

    if (plant === "wrong_total") {
      fields = { ...fields, total: round((fields.total ?? 0) + 90) };
      route = "review";
    } else if (plant === "wrong_vat") {
      const vatAmount = round((fields.subtotal ?? 0) * 0.08);
      fields = { ...fields, vatAmount, total: round((fields.subtotal ?? 0) + vatAmount) };
      route = "review";
    } else if (plant === "bad_lines") {
      const subtotal = round((fields.subtotal ?? 0) + 100);
      const vatAmount = round(subtotal * 0.05);
      fields = { ...fields, subtotal, vatAmount, total: round(subtotal + vatAmount) };
      route = "review";
    } else if (plant === "duplicate") {
      const old = pick(POSTED);
      const owner = SUPPLIERS.find((s) => s.name === old.supplierName) ?? supplier;
      fields = { ...build(owner, old.invoiceNumber, issue, due, lines) };
      route = "blocked";
    } else if (plant === "iban_change") {
      fields = { ...fields, iban: `AE00 0990 0000 ${1000 + i} 4471 186` };
      route = "blocked";
    }

    specs.push({
      id: `test-${String(i + 1).padStart(2, "0")}`,
      layout: layouts[i % layouts.length],
      scan: i % 7 === 3,
      fields,
      expected: { route, planted: plant },
    });
  }
  return specs;
}
