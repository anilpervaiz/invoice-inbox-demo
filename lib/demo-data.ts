import type { PostedInvoice, RuleContext, Supplier } from "./types";

// Every company, TRN and IBAN here is made up. The IBANs use check digits of 00, which no real IBAN has.

export const FIRM = "Harbourline Accounting";
export const CLIENT = "Juniper Street Trading LLC";

export const SUPPLIERS: Supplier[] = [
  { name: "Creek Lane Office Supplies LLC", trn: "100482917300003", iban: "AE00 0331 0000 1204 8821 007", country: "AE" },
  { name: "Blue Dhow Print House LLC", trn: "100731264500003", iban: "AE00 0260 0000 7731 0092 415", country: "AE" },
  { name: "Palm Row Catering Services", trn: "100265518900003", iban: "AE00 0440 0000 1098 3377 102", country: "AE" },
  { name: "Swift Falcon Couriers FZE", trn: "100918340200003", iban: "AE00 0350 0000 5521 6640 913", country: "AE" },
  { name: "Saltwater IT Support FZ-LLC", trn: "100647105800003", iban: "AE00 0331 0000 8810 2245 630", country: "AE" },
  { name: "Oasis Grove Cleaning Services LLC", trn: "100355279100003", iban: "AE00 0260 0000 4417 9003 288", country: "AE" },
  { name: "Northgate Software Ltd", trn: null, iban: "GB00 NGSW 0000 0012 3456 78", country: "GB" },
];

export const POSTED: PostedInvoice[] = [
  { supplierName: "Palm Row Catering Services", invoiceNumber: "PRC-2291", total: 3360, issueDate: "2026-10-14" },
  { supplierName: "Creek Lane Office Supplies LLC", invoiceNumber: "INV-20377", total: 892.5, issueDate: "2026-09-30" },
  { supplierName: "Swift Falcon Couriers FZE", invoiceNumber: "SF-88120", total: 441, issueDate: "2026-10-02" },
  { supplierName: "Oasis Grove Cleaning Services LLC", invoiceNumber: "OG-5519", total: 1890, issueDate: "2026-09-28" },
];

export const RULE_CONTEXT: RuleContext = {
  suppliers: SUPPLIERS,
  posted: POSTED,
  today: "2026-11-05",
  domesticVatRates: [0, 5],
};
