import { formatMoney, runChecks } from "./rules";
import {
  EMPTY_FIELDS,
  FIELD_LABELS,
  MONEY_FIELDS,
  SCALAR_FIELDS,
  type Check,
  type Decision,
  type FieldView,
  type InvoiceFields,
  type ProcessedInvoice,
  type ReadResult,
  type RuleContext,
  type ScalarField,
} from "./types";

const same = (a: string | number | null, b: string | number | null) => {
  if (typeof a === "number" && typeof b === "number") return Math.round(a * 100) === Math.round(b * 100);
  if (typeof a === "string" && typeof b === "string") {
    const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return clean(a) === clean(b);
  }
  return a === b;
};

// Two independent readers. A field only counts as agreed when both found the same value.
export function mergeReads(text: ReadResult, ai: ReadResult) {
  const fields: InvoiceFields = { ...EMPTY_FIELDS };
  const views: FieldView[] = SCALAR_FIELDS.map((field) => {
    const textValue = text.fields[field];
    const aiValue = ai.fields[field];
    const value = aiValue ?? textValue;
    (fields as Record<ScalarField, unknown>)[field] = value;
    const agreement =
      textValue === null && aiValue === null
        ? "missing"
        : textValue === null || aiValue === null
          ? "single"
          : same(textValue, aiValue)
            ? "agreed"
            : "conflict";
    return { field, value, agreement, textValue, aiValue };
  });
  fields.lines = ai.fields.lines.length ? ai.fields.lines : text.fields.lines;
  return { fields, views };
}

const display = (field: ScalarField, value: string | number | null, currency: string | null) => {
  if (value === null) return "nothing";
  return MONEY_FIELDS.includes(field) && typeof value === "number" ? formatMoney(value, currency) : String(value);
};

const PROBLEM: Record<string, string> = {
  required: "key details are missing",
  duplicate: "this may be a duplicate",
  lines: "the lines don't add up",
  "vat-math": "the VAT looks wrong",
  "vat-rate": "the VAT rate is unusual",
  trn: "check the supplier TRN",
  dates: "the dates look wrong",
};

export function decide(fields: InvoiceFields, views: FieldView[], checks: Check[], twoReads: boolean): Decision {
  const failed = (id: string) => checks.find((c) => c.id === id && c.status === "fail");
  const hold = { label: "Hold and ask the supplier", outcome: "hold" as const };

  const duplicate = failed("duplicate");
  if (duplicate?.severity === "block") {
    return {
      route: "blocked",
      headline: "Blocked: this looks like a duplicate",
      question: `${duplicate.detail} Paying it again would be a double payment.`,
      options: [{ label: "Keep it blocked", outcome: "hold" }],
    };
  }

  const iban = failed("iban");
  if (iban) {
    return {
      route: "blocked",
      headline: "Blocked: bank details have changed",
      question: `${iban.detail} Call the supplier on a number you already have before paying.`,
      options: [{ label: "Keep it blocked", outcome: "hold" }],
    };
  }

  const conflict = views.find((v) => v.agreement === "conflict" && MONEY_FIELDS.includes(v.field));
  const anyConflict = conflict ?? views.find((v) => v.agreement === "conflict");
  if (anyConflict) {
    const { field, textValue, aiValue } = anyConflict;
    const a = display(field, textValue, fields.currency);
    const b = display(field, aiValue, fields.currency);
    return {
      route: "review",
      headline: `Needs you: the two reads disagree on ${FIELD_LABELS[field].toLowerCase()}`,
      question: `One read says ${a} and the other says ${b}. Which matches the invoice?`,
      options: [
        { label: `Use ${a}`, outcome: "approve", set: { [field]: textValue } },
        { label: `Use ${b}`, outcome: "approve", set: { [field]: aiValue } },
        hold,
      ],
    };
  }

  const total = failed("total");
  if (total && fields.subtotal !== null && fields.total !== null) {
    const expected = Math.round((fields.subtotal + (fields.vatAmount ?? 0)) * 100) / 100;
    return {
      route: "review",
      headline: "Needs you: the total doesn't add up",
      question: `${total.detail} Which amount should be posted?`,
      options: [
        { label: `Post ${formatMoney(expected, fields.currency)}`, outcome: "approve", set: { total: expected } },
        { label: `Post ${formatMoney(fields.total, fields.currency)}`, outcome: "approve" },
        hold,
      ],
    };
  }

  const firstFailure = checks.find((c) => c.status === "fail");
  if (firstFailure) {
    return {
      route: "review",
      headline: `Needs you: ${PROBLEM[firstFailure.id] ?? "a check failed"}`,
      question: `${firstFailure.detail} Is this invoice still OK to post?`,
      options: [{ label: "Yes, post it", outcome: "approve" }, hold],
    };
  }

  if (!twoReads) {
    return {
      route: "review",
      headline: "Needs you: only one read was possible",
      question: "All the checks passed, but only one reader could read this invoice. Do the fields match the document?",
      options: [{ label: "Yes, post it", outcome: "approve" }, hold],
    };
  }

  return {
    route: "ready",
    headline: "Ready to post",
    question: null,
    options: [{ label: "Approve", outcome: "approve" }],
  };
}

export function processInvoice(
  id: string,
  fileName: string,
  text: ReadResult,
  ai: ReadResult,
  ctx: RuleContext,
): ProcessedInvoice {
  const { fields, views } = mergeReads(text, ai);
  const checks = runChecks(fields, ctx);
  const twoReads = text.status === "ok" && ai.status === "ok";
  const unreadable: Decision = {
    route: "review",
    headline: "Needs you: this file couldn't be read",
    question: "Neither reader could get anything from this file. Enter it by hand or ask for a clearer copy.",
    options: [{ label: "Hold and ask the supplier", outcome: "hold" }],
  };
  return {
    id,
    fileName,
    fields,
    views,
    checks,
    decision: text.status !== "ok" && ai.status !== "ok" ? unreadable : decide(fields, views, checks, twoReads),
    reads: { text: text.status, ai: ai.status },
  };
}
