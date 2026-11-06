export type LineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type InvoiceFields = {
  supplierName: string | null;
  supplierTrn: string | null;
  invoiceNumber: string | null;
  issueDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  currency: string | null;
  subtotal: number | null;
  vatRate: number | null; // percent, for example 5
  vatAmount: number | null;
  total: number | null;
  iban: string | null;
  lines: LineItem[];
};

export type ScalarField = Exclude<keyof InvoiceFields, "lines">;

export const SCALAR_FIELDS: ScalarField[] = [
  "supplierName",
  "supplierTrn",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "currency",
  "subtotal",
  "vatRate",
  "vatAmount",
  "total",
  "iban",
];

export const FIELD_LABELS: Record<ScalarField, string> = {
  supplierName: "Supplier",
  supplierTrn: "Supplier TRN",
  invoiceNumber: "Invoice number",
  issueDate: "Invoice date",
  dueDate: "Due date",
  currency: "Currency",
  subtotal: "Subtotal",
  vatRate: "VAT rate",
  vatAmount: "VAT",
  total: "Total",
  iban: "Bank IBAN",
};

export const MONEY_FIELDS: ScalarField[] = ["subtotal", "vatAmount", "total"];

export const EMPTY_FIELDS: InvoiceFields = {
  supplierName: null,
  supplierTrn: null,
  invoiceNumber: null,
  issueDate: null,
  dueDate: null,
  currency: null,
  subtotal: null,
  vatRate: null,
  vatAmount: null,
  total: null,
  iban: null,
  lines: [],
};

export type ReaderName = "text" | "ai";

export type ReadResult = {
  reader: ReaderName;
  status: "ok" | "empty" | "unavailable" | "error";
  fields: InvoiceFields;
  note?: string;
};

export type FieldAgreement = "agreed" | "conflict" | "single" | "missing";

export type FieldView = {
  field: ScalarField;
  value: string | number | null;
  agreement: FieldAgreement;
  textValue: string | number | null;
  aiValue: string | number | null;
};

export type CheckStatus = "pass" | "fail" | "skip";

export type Check = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  // block stops the invoice. review sends it to a person.
  severity: "block" | "review";
};

export type Route = "ready" | "review" | "blocked";

export type QuestionOption = {
  label: string;
  outcome: "approve" | "hold";
  set?: Partial<Pick<InvoiceFields, ScalarField>>;
};

export type Decision = {
  route: Route;
  headline: string;
  question: string | null;
  options: QuestionOption[];
};

export type ProcessedInvoice = {
  id: string;
  fileName: string;
  fields: InvoiceFields;
  views: FieldView[];
  checks: Check[];
  decision: Decision;
  reads: { text: ReadResult["status"]; ai: ReadResult["status"] };
};

export type Supplier = {
  name: string;
  trn: string | null;
  iban: string;
  country: string;
};

export type PostedInvoice = {
  supplierName: string;
  invoiceNumber: string;
  total: number;
  issueDate: string;
};

export type RuleContext = {
  suppliers: Supplier[];
  posted: PostedInvoice[];
  today: string; // YYYY-MM-DD
  domesticVatRates: number[];
};
