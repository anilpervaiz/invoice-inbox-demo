"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toCsv, toQuickBooksCsv, toXeroCsv, type ExportRow } from "@/lib/csv";
import { formatMoney } from "@/lib/rules";
import {
  FIELD_LABELS,
  MONEY_FIELDS,
  type Check,
  type FieldView,
  type InvoiceFields,
  type ProcessedInvoice,
  type QuestionOption,
  type Route,
} from "@/lib/types";

export type SampleInvoice = ProcessedInvoice & { title?: string };

type SetStats = {
  invoices: number;
  scans: number;
  text: { right?: number; accuracy: number | null; fieldsChecked: number };
  ai: { right?: number; accuracy: number | null; fieldsChecked: number } | null;
  falseClears?: number;
  plantedErrors: { caught: number; total: number; notRead: number };
  cleanInvoices?: { cleared: number; sentToPerson: number; total: number } | null;
};

type Report = {
  runAt: string;
  generatedAt?: string;
  model: string | null;
  estimatedAiCostUsd?: number | null;
  totalFalseClears?: number;
  known?: SetStats;
  heldout?: SetStats;
  invoices?: number;
  scans?: number;
  source?: string;
  text?: { accuracy: number | null; fieldsChecked: number };
  ai?: { accuracy: number | null; fieldsChecked: number } | null;
  plantedErrors?: { caught: number; total: number; notRead: number };
  cleanInvoicesCleared?: { cleared: number; total: number } | null;
};

type Outcome = {
  result: "approved" | "held";
  fields: InvoiceFields;
  personChoice: string;
  routeReason: string;
  originalRoute: Route;
};
type Stored = Record<string, Outcome>;

export function getRouteReason(invoice: SampleInvoice): string {
  const d = invoice.decision;
  if (d.route === "ready") {
    return "Ready to post: both reads agree and all 9 checks pass.";
  }
  const failedCheck = invoice.checks.find((c) => c.status === "fail");
  if (failedCheck) {
    return `Failed check "${failedCheck.label}" — ${failedCheck.detail}`;
  }
  const conflict = invoice.views.find((v) => v.agreement === "conflict");
  if (conflict) {
    return `Reads disagree on ${FIELD_LABELS[conflict.field].toLowerCase()} (Code vs. AI).`;
  }
  if (invoice.reads.text !== "ok" || invoice.reads.ai !== "ok") {
    return `Single read only (${invoice.reads.text === "ok" ? "Code reader" : "AI reader"} only — requires human verification).`;
  }
  return d.headline;
}

function getCompactRouteTrace(invoice: SampleInvoice): string {
  const d = invoice.decision;
  const passedCount = invoice.checks.filter((c) => c.status === "pass").length;
  const totalChecks = invoice.checks.length;
  if (d.route === "ready") {
    return `Both readers (Code + AI) agreed on every field and all ${totalChecks} deterministic checks passed.`;
  }
  const failedCheck = invoice.checks.find((c) => c.status === "fail");
  if (failedCheck) {
    return `Rule "${failedCheck.label}" failed (${passedCount} of ${totalChecks} checks passed · AI never decides).`;
  }
  const conflict = invoice.views.find((v) => v.agreement === "conflict");
  if (conflict) {
    return `Code and AI readers disagreed on ${FIELD_LABELS[conflict.field].toLowerCase()} (${passedCount} of ${totalChecks} checks passed).`;
  }
  if (invoice.reads.text !== "ok" || invoice.reads.ai !== "ok") {
    return `Single read only (${invoice.reads.text === "ok" ? "Code reader" : "AI reader"} succeeded; nothing clears on 1 read).`;
  }
  return d.headline;
}

const STORE_KEY = "invoice-inbox-outcomes";

const load = (): Stored => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const save = (value: Stored) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be blocked. The demo still works for this visit.
  }
};

const GROUPS: { route: Route; title: string; text: string; dot: string; activeBorder: string; badge: string }[] = [
  {
    route: "review",
    title: "Needs you",
    text: "text-review",
    dot: "bg-review",
    activeBorder: "border-review",
    badge: "bg-review-soft text-review border-review/25",
  },
  {
    route: "blocked",
    title: "Blocked",
    text: "text-blocked",
    dot: "bg-blocked",
    activeBorder: "border-blocked",
    badge: "bg-blocked-soft text-blocked border-blocked/25",
  },
  {
    route: "ready",
    title: "Ready to post",
    text: "text-ready",
    dot: "bg-ready",
    activeBorder: "border-ready",
    badge: "bg-ready-soft text-ready border-ready/25",
  },
];

const CARD: Record<Route, string> = {
  review: "bg-review-soft border-review/30",
  blocked: "bg-blocked-soft border-blocked/30",
  ready: "bg-ready-soft border-ready/30",
};

const ROUTE_ACCENT: Record<Route, string> = {
  review: "border-l-review",
  blocked: "border-l-blocked",
  ready: "border-l-ready",
};

const FIELD_CHECK_MAP: Partial<Record<FieldView["field"], string>> = {
  subtotal: "lines",
  total: "total",
  vatAmount: "vat-math",
  vatRate: "vat-rate",
  supplierTrn: "trn",
  iban: "iban",
  invoiceNumber: "duplicate",
  issueDate: "dates",
};

function Row({
  invoice,
  outcome,
  selected,
  onSelect,
}: {
  invoice: SampleInvoice;
  outcome?: Outcome;
  selected: boolean;
  onSelect: () => void;
}) {
  const f = outcome?.fields ?? invoice.fields;
  const route = invoice.decision.route;
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={`w-full border-b border-rule/60 border-l-[3px] px-4 py-3 text-left transition-colors ${
        selected
          ? `${ROUTE_ACCENT[route]} bg-sheet shadow-[inset_0_1px_0_0_rgba(0,0,0,0.03)]`
          : "border-l-transparent hover:bg-sheet/70"
      }`}
    >
      <span className="flex min-w-0 items-baseline justify-between gap-2">
        <span className={`truncate text-sm ${selected ? "font-semibold text-ink" : "font-medium text-ink/90"}`}>
          {f.supplierName ?? invoice.fileName}
        </span>
        <span className="figures shrink-0 text-xs font-medium text-ink">
          {f.total === null ? "" : formatMoney(f.total)}
        </span>
      </span>
      <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-xs text-muted">
        <span className="truncate">{invoice.title ?? invoice.fileName}</span>
        <span className="figures shrink-0 text-[11px]">{f.currency}</span>
      </span>
    </button>
  );
}

function rawValueText(val: string | number | null, field: FieldView["field"], currency: string | null) {
  if (val === null) return "Not found";
  if (MONEY_FIELDS.includes(field) && typeof val === "number") return formatMoney(val, currency);
  if (field === "vatRate") return `${val}%`;
  return String(val);
}

function fieldText(v: FieldView, currency: string | null) {
  return rawValueText(v.value, v.field, currency);
}

const AGREEMENT = {
  agreed: {
    label: "Both reads agree",
    shortLabel: "Code + AI",
    mark: "✓✓",
    tone: "text-ready",
    pill: "bg-ready-soft text-ready border-ready/25",
  },
  single: {
    label: "One read only",
    shortLabel: "1 reader",
    mark: "✓",
    tone: "text-review",
    pill: "bg-review-soft/70 text-review border-review/25",
  },
  conflict: {
    label: "Reads disagree",
    shortLabel: "Mismatch",
    mark: "≠",
    tone: "text-review",
    pill: "bg-review-soft text-review border-review/40 font-semibold",
  },
  missing: {
    label: "Not found",
    shortLabel: "Missing",
    mark: "–",
    tone: "text-muted",
    pill: "bg-desk text-muted border-rule",
  },
};

function CheckRow({ check }: { check: Check }) {
  const mark = check.status === "pass" ? "✓" : check.status === "fail" ? "✕" : "–";
  const tone =
    check.status === "pass"
      ? "bg-ready-soft text-ready"
      : check.status === "fail"
        ? "bg-blocked-soft text-blocked font-semibold"
        : "bg-desk text-muted";
  return (
    <li
      className={`flex items-start gap-2.5 rounded px-2 py-1.5 text-sm ${
        check.status === "fail" ? "bg-blocked-soft/45" : ""
      }`}
    >
      <span
        aria-hidden
        className={`figures mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded text-[11px] ${tone}`}
      >
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className={check.status === "fail" ? "font-semibold text-ink" : "text-ink/90"}>{check.label}</span>
        <span className="sr-only"> ({check.status})</span>
        {check.status !== "pass" && (
          <span className={`mt-0.5 block text-xs ${check.status === "fail" ? "text-blocked" : "text-muted"}`}>
            {check.detail}
          </span>
        )}
      </span>
    </li>
  );
}

export function Inbox({
  invoices,
  simulated,
  report,
  uploadsEnabled = true,
}: {
  invoices: SampleInvoice[];
  simulated: boolean;
  report: Report;
  uploadsEnabled?: boolean;
}) {
  const [items, setItems] = useState<SampleInvoice[]>(invoices);
  const [selectedId, setSelectedId] = useState(invoices[0]?.id);
  const [outcomes, setOutcomes] = useState<Stored>({});
  const [uploads, setUploads] = useState<Record<string, string>>({});
  const [canUpload, setCanUpload] = useState(uploadsEnabled);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const decisionPanel = useRef<HTMLElement>(null);

  // On a phone the decision sits below the list, so bring it into view.
  const openInvoice = (id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 1024) decisionPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    // Read after mount, so the server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOutcomes(load());
    fetch("/api/extract", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { uploadsEnabled?: boolean } | null) => {
        if (typeof data?.uploadsEnabled === "boolean") {
          setCanUpload(data.uploadsEnabled);
        }
      })
      .catch(() => {});
  }, []);

  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  const outcome = selected ? outcomes[selected.id] : undefined;
  const open = items.filter((i) => !outcomes[i.id]);
  const done = items.filter((i) => outcomes[i.id]);
  const approvedRows = useMemo<ExportRow[]>(
    () =>
      Object.values(outcomes)
        .filter((o) => o.result === "approved")
        .map((o) => ({
          fields: o.fields,
          routeReason: o.routeReason,
          personChoice: o.personChoice,
          originalRoute: o.originalRoute,
        })),
    [outcomes],
  );

  const [exportFormat, setExportFormat] = useState<"audit" | "xero" | "qbo">("audit");

  const settle = (invoice: SampleInvoice, option: QuestionOption) => {
    const next: Stored = {
      ...outcomes,
      [invoice.id]: {
        result: option.outcome === "approve" ? "approved" : "held",
        fields: { ...invoice.fields, ...option.set },
        personChoice: option.label,
        routeReason: getRouteReason(invoice),
        originalRoute: invoice.decision.route,
      },
    };
    setOutcomes(next);
    save(next);
    const following = items.find((i) => i.id !== invoice.id && !next[i.id]);
    if (following) setSelectedId(following.id);
  };

  const reset = () => {
    setOutcomes({});
    save({});
    setSelectedId(items[0]?.id);
  };

  const exportCsv = () => {
    let content = "";
    let filename = "";
    if (exportFormat === "xero") {
      content = toXeroCsv(approvedRows);
      filename = "approved-invoices-xero.csv";
    } else if (exportFormat === "qbo") {
      content = toQuickBooksCsv(approvedRows);
      filename = "approved-invoices-qbo.csv";
    } else {
      content = toCsv(approvedRows);
      filename = "approved-invoices-audit.csv";
    }
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const currentIdx = items.findIndex((i) => i.id === selectedId);
    if (currentIdx === -1) return;
    const nextIdx =
      e.key === "ArrowDown" ? (currentIdx + 1) % items.length : (currentIdx - 1 + items.length) % items.length;
    openInvoice(items[nextIdx].id);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/extract", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        setNotice(data.error ?? "That file couldn't be read.");
        return;
      }
      setUploads((u) => ({ ...u, [data.id]: URL.createObjectURL(file) }));
      setItems((list) => [data, ...list]);
      setSelectedId(data.id);
    } catch {
      setNotice("Something went wrong reading that file. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!selected) return null;
  const decision = selected.decision;
  const fields = outcome?.fields ?? selected.fields;
  const previewUrl = uploads[selected.id];

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-sheet px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-ink">Invoice Inbox</h1>
            <span className="rounded border border-ready/30 bg-ready-soft px-2 py-0.5 text-[11px] font-medium text-ready">
              {report.totalFalseClears ?? 0} false clears ·{" "}
              {(report.known?.invoices ?? 0) + (report.heldout?.invoices ?? 0) || report.invoices || 88} test invoices
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Two independent reads verified by plain rules. AI never decides. · Demo client: Juniper Street Trading LLC
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canUpload && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf"
                className="hidden"
                aria-label="Upload a PDF invoice"
                aria-describedby="upload-privacy-notice"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                aria-describedby="upload-privacy-notice"
                className="rounded border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-desk disabled:opacity-50 sm:text-sm"
              >
                {busy ? "Reading…" : "Try your own PDF"}
              </button>
            </>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "audit" | "xero" | "qbo")}
              aria-label="Export format"
              className="rounded border border-rule bg-sheet px-2 py-1.5 text-xs text-ink"
            >
              <option value="audit">Plain CSV (Audit)</option>
              <option value="xero">Xero Bills</option>
              <option value="qbo">QuickBooks Online</option>
            </select>
            <button
              onClick={exportCsv}
              disabled={!approvedRows.length}
              className="rounded bg-ink px-3 py-1.5 text-xs font-medium text-sheet transition-opacity disabled:opacity-35 sm:text-sm"
            >
              Export approved ({approvedRows.length})
            </button>
          </div>
        </div>
      </header>

      <div
        id="upload-privacy-notice"
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule bg-desk/75 px-4 py-1.5 text-[11px] leading-snug text-muted sm:px-5"
      >
        <p className="min-w-0">
          <span className="mr-1.5 inline-block rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink uppercase">
            Demo
          </span>
          Demo by{" "}
          <a href="https://anilpervaiz.com" className="font-medium text-ink underline">
            Anil Pervaiz
          </a>
          . Every company and invoice here is made up. <strong className="text-ink">Please don&apos;t upload real invoices.</strong>
        </p>
        {canUpload && (
          <p className="min-w-0 text-[11px] text-muted/90">
            Uploaded PDFs are processed in memory and never saved to disk or a database. When AI is enabled, the PDF is
            sent to Google&apos;s Gemini API (billed keys do not train on data; free-tier terms allow review — no
            confidential files).
          </p>
        )}
      </div>

      {simulated && (
        <p className="bg-blocked px-4 py-1.5 text-xs font-medium text-white sm:px-5">
          AI reads on this page are simulated for testing. Not for publishing.
        </p>
      )}
      {notice && (
        <p role="alert" className="bg-review-soft px-4 py-1.5 text-sm sm:px-5">
          {notice}
        </p>
      )}

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_420px]">
        <nav
          aria-label="Invoices"
          onKeyDown={handleNavKeyDown}
          className="min-w-0 border-b border-rule bg-paper pb-10 lg:border-r lg:border-b-0"
        >
          {GROUPS.map((g) => {
            const list = open.filter((i) => i.decision.route === g.route);
            if (!list.length) return null;
            return (
              <section key={g.route}>
                <h2 className={`flex items-center justify-between border-b border-rule/60 px-4 pt-3.5 pb-1.5 text-xs font-semibold ${g.text}`}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`size-2 rounded-full ${g.dot}`} />
                    {g.title}
                  </span>
                  <span className={`figures rounded border px-1.5 py-0.5 text-[10px] ${g.badge}`}>{list.length}</span>
                </h2>
                {list.map((i) => (
                  <Row key={i.id} invoice={i} selected={i.id === selected.id} onSelect={() => openInvoice(i.id)} />
                ))}
              </section>
            );
          })}
          {done.length > 0 && (
            <section>
              <h2 className="flex items-center justify-between border-b border-rule/60 px-4 pt-3.5 pb-1.5 text-xs font-semibold text-muted">
                <span>Done ({done.length})</span>
                <button onClick={reset} className="font-normal text-ink underline">
                  Start over
                </button>
              </h2>
              {done.map((i) => (
                <Row
                  key={i.id}
                  invoice={i}
                  outcome={outcomes[i.id]}
                  selected={i.id === selected.id}
                  onSelect={() => openInvoice(i.id)}
                />
              ))}
            </section>
          )}
        </nav>

        <section aria-label="Invoice document" className="order-3 min-w-0 bg-desk p-3 sm:p-6 lg:order-none">
          <div className="mx-auto max-w-[640px]">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded border border-rule bg-sheet px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="figures truncate font-medium text-ink">{selected.fileName}</span>
                {selected.title && (
                  <span className="rounded bg-desk px-1.5 py-0.5 text-[11px] text-muted">{selected.title}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className={`rounded border px-1.5 py-0.5 font-medium ${
                    selected.reads.text === "ok"
                      ? "border-ready/30 bg-ready-soft text-ready"
                      : "border-review/30 bg-review-soft text-review"
                  }`}
                >
                  Code reader: {selected.reads.text === "ok" ? "✓ Read" : "Scan (no text)"}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-medium ${
                    selected.reads.ai === "ok"
                      ? "border-ready/30 bg-ready-soft text-ready"
                      : "border-review/30 bg-review-soft text-review"
                  }`}
                >
                  AI reader: {selected.reads.ai === "ok" ? "✓ Read" : "Unavailable"}
                </span>
              </div>
            </div>
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title={selected.fileName}
                className="h-[80vh] w-full rounded-sm border border-rule bg-white shadow-sm"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/samples/${selected.id}.png`}
                alt={`Sample invoice from ${selected.fields.supplierName ?? "a supplier"}`}
                className="w-full rounded-sm border border-rule bg-white shadow-sm"
              />
            )}
          </div>
        </section>

        <aside
          ref={decisionPanel}
          aria-label="Decision"
          className="min-w-0 scroll-mt-2 border-l-0 border-rule bg-sheet lg:border-l"
        >
          <div className={`border-b p-4 sm:p-5 ${CARD[decision.route]}`}>
            {outcome ? (
              <>
                <p className="text-base font-semibold">{outcome.result === "approved" ? "Approved" : "Held"}</p>
                <p className="mt-1 text-sm text-muted">
                  {outcome.result === "approved"
                    ? `Settled as "${outcome.personChoice}". Included in your CSV export.`
                    : `Settled as "${outcome.personChoice}". This invoice will not be posted.`}
                </p>
                <div className="mt-2.5 rounded border border-ink/10 bg-sheet/80 px-2.5 py-1.5 text-xs text-muted">
                  <span className="font-semibold text-ink/85">Route reason:</span> {outcome.routeReason}
                </div>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-ink">{decision.headline}</p>
                {decision.question && <p className="mt-1.5 text-sm leading-relaxed text-ink/90">{decision.question}</p>}
                <div className="mt-2.5 rounded border border-ink/10 bg-sheet/80 px-2.5 py-1.5 text-xs text-muted">
                  <span className="font-semibold text-ink/85">Route reason:</span> {getCompactRouteTrace(selected)}
                </div>
                <div className="mt-3.5 flex flex-wrap gap-2">
                  {decision.options.map((option, index) => (
                    <button
                      key={option.label}
                      onClick={() => settle(selected, option)}
                      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                        index === 0 ? "bg-ink text-sheet hover:bg-ink/90" : "border border-ink/25 bg-sheet/50 hover:bg-sheet"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                What was read (Code vs. AI)
              </h3>
              <span className="text-[11px] text-muted">Nothing clears on 1 read</span>
            </div>
            <dl className="mt-2">
              {selected.views.map((v) => {
                const a = AGREEMENT[v.agreement];
                const value =
                  fields[v.field] === v.value
                    ? fieldText(v, fields.currency)
                    : fieldText({ ...v, value: fields[v.field] }, fields.currency);
                const mappedCheckId = FIELD_CHECK_MAP[v.field];
                const fieldFailedCheck = mappedCheckId
                  ? selected.checks.find((c) => c.id === mappedCheckId && c.status === "fail")
                  : undefined;
                const singleSourceLabel =
                  v.agreement === "single"
                    ? v.textValue !== null
                      ? "Code only"
                      : "AI only"
                    : a.shortLabel;

                return (
                  <div
                    key={v.field}
                    className={`grid grid-cols-[104px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-rule/70 py-1.5 text-sm ${
                      fieldFailedCheck
                        ? " -mx-2 rounded bg-review-soft/55 px-2"
                        : v.agreement === "conflict"
                          ? " -mx-2 rounded bg-review-soft/40 px-2"
                          : ""
                    }`}
                  >
                    <dt className="truncate text-xs text-muted">{FIELD_LABELS[v.field]}</dt>
                    <dd
                      className={`min-w-0 break-words ${
                        typeof v.value === "number" || v.field === "iban" || v.field === "supplierTrn"
                          ? "figures text-[13px]"
                          : ""
                      } ${fieldFailedCheck ? "font-semibold text-ink" : ""}`}
                    >
                      <span>{value}</span>
                      {v.agreement === "conflict" && (
                        <span className="figures mt-0.5 block text-[11px] text-review">
                          Code: {rawValueText(v.textValue, v.field, fields.currency)} · AI:{" "}
                          {rawValueText(v.aiValue, v.field, fields.currency)}
                        </span>
                      )}
                      {fieldFailedCheck && (
                        <span className="mt-0.5 block text-[11px] font-medium text-blocked">
                          ✕ Check failed: {fieldFailedCheck.label.toLowerCase()}
                        </span>
                      )}
                    </dd>
                    <span
                      title={a.label}
                      className={`figures inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${a.pill}`}
                    >
                      <span aria-hidden>{a.mark}</span>
                      <span>{singleSourceLabel}</span>
                      <span className="sr-only"> ({a.label})</span>
                    </span>
                  </div>
                );
              })}
            </dl>

            <h3 className="mt-6 text-xs font-semibold tracking-wide text-muted uppercase">
              Deterministic checks (9 rules)
            </h3>
            <ul className="mt-1.5 space-y-0.5">
              {selected.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="border-t border-rule bg-sheet px-4 py-5 sm:px-5">
        <div className="grid gap-5 text-sm md:grid-cols-3">
          <div>
            <h2 className="font-semibold">How it decides</h2>
            <p className="mt-1 text-muted">
              Two separate reads of every invoice, one by AI and one by plain code. Plain rules do the maths and the
              checks. AI never decides, and nothing clears on one read.
            </p>
          </div>
          <div>
            {(() => {
              const totalCount =
                (report.known?.invoices ?? 0) + (report.heldout?.invoices ?? 0) || report.invoices || 0;
              const target = report.heldout ?? report.known;
              const setInvoices = target?.invoices ?? totalCount;
              const setLabel = report.heldout ? "held-out generated invoices" : "generated invoices";
              const textStats = target?.text ?? report.text;
              const aiStats = target?.ai ?? report.ai;
              const textRight =
                (target?.text.right ?? undefined) ??
                (textStats && textStats.accuracy !== null
                  ? Math.round((textStats.accuracy * textStats.fieldsChecked) / 100)
                  : 0);
              const aiRight =
                (target?.ai?.right ?? undefined) ??
                (aiStats && aiStats.accuracy !== null
                  ? Math.round((aiStats.accuracy * aiStats.fieldsChecked) / 100)
                  : 0);
              const plantedCaught =
                (report.known?.plantedErrors.caught ?? 0) + (report.heldout?.plantedErrors.caught ?? 0) ||
                report.plantedErrors?.caught ||
                0;
              const plantedTotal =
                (report.known?.plantedErrors.total ?? 0) + (report.heldout?.plantedErrors.total ?? 0) ||
                report.plantedErrors?.total ||
                0;
              const falseClears =
                report.totalFalseClears ??
                ((report.known?.falseClears ?? 0) + (report.heldout?.falseClears ?? 0));

              return (
                <>
                  <h2 className="font-semibold">
                    Measured on {totalCount} generated invoices
                    {report.heldout ? ` (${report.heldout.invoices} held-out)` : ""}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {report.model ? `Model: ${report.model}` : "Plain-code mode (AI not yet run)"} · Evaluated{" "}
                    {report.runAt}
                  </p>
                  {aiStats && aiStats.accuracy !== null ? (
                    <p className="mt-1.5 text-muted">
                      AI read {aiRight} of {aiStats.fieldsChecked} fields ({aiStats.accuracy}%) on {setInvoices}{" "}
                      {setLabel}. Checks caught {plantedCaught} of {plantedTotal} planted errors across all{" "}
                      {totalCount} invoices, with {falseClears} false clears.
                    </p>
                  ) : textStats ? (
                    <p className="mt-1.5 text-muted">
                      Plain-code reader read {textRight} of {textStats.fieldsChecked} fields ({textStats.accuracy}%) on{" "}
                      {setInvoices} {setLabel}. Checks caught {plantedCaught} of {plantedTotal} planted errors across
                      all {totalCount} invoices, with {falseClears} false clears.
                    </p>
                  ) : (
                    <p className="mt-1.5 text-muted">
                      Checks caught {plantedCaught} of {plantedTotal} planted errors across {totalCount} generated
                      invoices. AI accuracy hasn&apos;t been measured yet.
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted/80">
                    Real invoices will score lower than generated ones. Zero false clears is the hard safety rule.
                  </p>
                </>
              );
            })()}
          </div>
          <div>
            <h2 className="font-semibold">What this isn&apos;t</h2>
            <p className="mt-1 text-muted">
              It&apos;s a demo, not a client system. The test invoices are generated, so real invoices will score
              differently. A real setup would be tested on your own files first.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
