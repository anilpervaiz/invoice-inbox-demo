import { describe, expect, it } from "vitest";
import { toCsv, toQuickBooksCsv, toXeroCsv, type ExportRow } from "./csv";
import type { InvoiceFields } from "./types";

const sampleInvoice: InvoiceFields = {
  supplierName: 'Acme "Services" LLC',
  supplierTrn: "100482917300003",
  invoiceNumber: "INV-9901",
  issueDate: "2026-10-15",
  dueDate: "2026-11-14",
  currency: "AED",
  subtotal: 1000,
  vatRate: 5,
  vatAmount: 50,
  total: 1050,
  iban: "AE00 0331 0000 1204 8821 007",
  lines: [
    { description: "Consulting hours, regular", quantity: 5, unitPrice: 150, amount: 750 },
    { description: "Travel expense, client site", quantity: 1, unitPrice: 250, amount: 250 },
  ],
};

const sampleRow: ExportRow = {
  fields: sampleInvoice,
  routeReason: "Ready to post: both reads agree and all 9 checks pass",
  personChoice: "Approved (clean checks)",
  originalRoute: "ready",
};

describe("Stage 3: CSV Export Formats & Reason Trail", () => {
  describe("Audit CSV (toCsv)", () => {
    it("includes standard fields, route reason, and person choice", () => {
      const csv = toCsv([sampleRow]);
      const lines = csv.split("\n");
      expect(lines[0]).toBe(
        "Supplier,TRN,Invoice number,Invoice date,Due date,Currency,Subtotal,VAT,Total,Route reason,Person's choice",
      );
      // Handles quotes in supplier name
      expect(lines[1]).toContain('"Acme ""Services"" LLC"');
      expect(lines[1]).toContain("100482917300003");
      expect(lines[1]).toContain("INV-9901");
      expect(lines[1]).toContain("2026-10-15");
      expect(lines[1]).toContain("2026-11-14");
      expect(lines[1]).toContain("AED");
      expect(lines[1]).toContain("1000.00");
      expect(lines[1]).toContain("50.00");
      expect(lines[1]).toContain("1050.00");
      expect(lines[1]).toContain("Ready to post: both reads agree and all 9 checks pass");
      expect(lines[1]).toContain("Approved (clean checks)");
    });

    it("remains backwards-compatible with plain InvoiceFields", () => {
      const csv = toCsv([sampleInvoice]);
      const lines = csv.split("\n");
      expect(lines[1]).toContain("1050.00");
    });
  });

  describe("Xero Bill Import CSV (toXeroCsv)", () => {
    it("matches official Xero purchases bill template column headers", () => {
      const csv = toXeroCsv([sampleRow]);
      const [header] = csv.split("\n");
      const expectedHeaders = [
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
      ].join(",");
      expect(header).toBe(expectedHeaders);
    });

    it("emits multiple rows for multi-line bills with identical InvoiceNumber and ContactName", () => {
      const csv = toXeroCsv([sampleRow]);
      const lines = csv.split("\n");
      // Header + 2 line items = 3 lines
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain("INV-9901");
      expect(lines[1]).toContain('"Acme ""Services"" LLC"');
      expect(lines[1]).toContain("15/10/2026"); // DD/MM/YYYY format
      expect(lines[1]).toContain("14/11/2026");
      expect(lines[1]).toContain("Consulting hours, regular");
      expect(lines[1]).toContain("150.00");
      expect(lines[1]).toContain("37.50"); // TaxAmount for line 1

      expect(lines[2]).toContain("INV-9901");
      expect(lines[2]).toContain("Travel expense, client site");
      expect(lines[2]).toContain("250.00");
      expect(lines[2]).toContain("12.50"); // TaxAmount for line 2
    });
  });

  describe("QuickBooks Online Batch Bill Import CSV (toQuickBooksCsv)", () => {
    it("matches official QBO Advanced batch bill template headers and embeds reason trail in Memo", () => {
      const csv = toQuickBooksCsv([sampleRow]);
      const lines = csv.split("\n");
      expect(lines[0]).toBe(
        "Bill No.,Vendor,Bill Date,Due Date,Terms,Location,Memo,Account,Description,Qty,Rate,Amount,Tax Rate",
      );
      expect(lines.length).toBe(3); // Header + 2 line items
      expect(lines[1]).toContain("INV-9901");
      expect(lines[1]).toContain('"Acme ""Services"" LLC"');
      expect(lines[1]).toContain(
        "Reason: Ready to post: both reads agree and all 9 checks pass | Decision: Approved (clean checks)",
      );
      expect(lines[1]).toContain("Consulting hours, regular");
      expect(lines[1]).toContain("750.00");
    });
  });
});
