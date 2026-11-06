"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toCsv } from "@/lib/csv";
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

type Report = {
  runAt: string;
  invoices: number;
  scans: number;
  source: string;
  model: string | null;
  text: { accuracy: number | null; fieldsChecked: number };
  ai: { accuracy: number | null; fieldsChecked: number } | null;
  plantedErrors: { caught: number; total: number; notRead: number };
  cleanInvoicesCleared: { cleared: number; total: number } | null;
};

type Outcome = { result: "approved" | "held"; fields: InvoiceFields };
type Stored = Record<string, Outcome>;

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

const GROUPS: { route: Route; title: string; text: string; dot: string }[] = [
  { route: "review", title: "Needs you", text: "text-review", dot: "bg-review" },
  { route: "blocked", title: "Blocked", text: "text-blocked", dot: "bg-blocked" },
  { route: "ready", title: "Ready to post", text: "text-ready", dot: "bg-ready" },
];

const CARD: Record<Route, string> = {
  review: "bg-review-soft border-review/30",
  blocked: "bg-blocked-soft border-blocked/30",
  ready: "bg-ready-soft border-ready/30",
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
  return (
    <button
      onClick={onSelect}
      aria-current={selected}
      className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
        selected ? "border-ink bg-sheet" : "border-transparent hover:bg-sheet/60"
      }`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{f.supplierName ?? invoice.fileName}</span>
        <span className="figures shrink-0 text-xs">{f.total === null ? "" : formatMoney(f.total)}</span>
      </span>
      <span className="mt-0.5 flex justify-between gap-3 text-xs text-muted">
        <span className="truncate">{invoice.title ?? invoice.fileName}</span>
        <span className="figures shrink-0">{f.currency}</span>
      </span>
    </button>
  );
}

function fieldText(v: FieldView, currency: string | null) {
  if (v.value === null) return "Not found";
  if (MONEY_FIELDS.includes(v.field) && typeof v.value === "number") return formatMoney(v.value, currency);
  if (v.field === "vatRate") return `${v.value}%`;
  return String(v.value);
}

const AGREEMENT = {
  agreed: { label: "Both reads agree", mark: "✓✓", tone: "text-ready" },
  single: { label: "One read only", mark: "✓", tone: "text-muted" },
  conflict: { label: "Reads disagree", mark: "≠", tone: "text-review" },
  missing: { label: "Not found", mark: "–", tone: "text-muted" },
};

function CheckRow({ check }: { check: Check }) {
  const mark = check.status === "pass" ? "✓" : check.status === "fail" ? "✕" : "–";
  const tone = check.status === "pass" ? "text-ready" : check.status === "fail" ? "text-blocked" : "text-muted";
  return (
    <li className="flex gap-2.5 py-1.5 text-sm">
      <span aria-hidden className={`figures w-3 shrink-0 ${tone}`}>
        {mark}
      </span>
      <span>
        <span className={check.status === "fail" ? "font-medium" : ""}>{check.label}</span>
        <span className="sr-only"> ({check.status})</span>
        {check.status !== "pass" && <span className="block text-xs text-muted">{check.detail}</span>}
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
  }, []);

  const selected = items.find((i) => i.id === selectedId) ?? items[0];
  const outcome = selected ? outcomes[selected.id] : undefined;
  const open = items.filter((i) => !outcomes[i.id]);
  const done = items.filter((i) => outcomes[i.id]);
  const approved = useMemo(
    () => Object.values(outcomes).filter((o) => o.result === "approved").map((o) => o.fields),
    [outcomes],
  );

  const settle = (invoice: SampleInvoice, option: QuestionOption) => {
    const next: Stored = {
      ...outcomes,
      [invoice.id]: {
        result: option.outcome === "approve" ? "approved" : "held",
        fields: { ...invoice.fields, ...option.set },
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
    const url = URL.createObjectURL(new Blob([toCsv(approved)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "approved-invoices.csv";
    link.click();
    URL.revokeObjectURL(url);
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
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-sheet px-4 py-3 sm:px-5">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Invoice Inbox</h1>
          <p className="text-xs text-muted">Harbourline Accounting · client: Juniper Street Trading</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {uploadsEnabled && (
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
                className="rounded border border-rule px-3 py-1.5 text-sm hover:bg-paper disabled:opacity-50"
              >
                {busy ? "Reading…" : "Try your own PDF"}
              </button>
            </>
          )}
          <button
            onClick={exportCsv}
            disabled={!approved.length}
            className="rounded bg-ink px-3 py-1.5 text-sm text-sheet disabled:opacity-35"
          >
            Export approved ({approved.length})
          </button>
        </div>
      </header>

      <div id="upload-privacy-notice" className="border-b border-rule bg-desk px-4 py-2 text-xs text-muted sm:px-5">
        <p>
          Demo by{" "}
          <a href="https://anilpervaiz.com" className="underline">
            Anil Pervaiz
          </a>
          . Every company and invoice here is made up. <strong>Please don&apos;t upload real invoices.</strong>
        </p>
        {uploadsEnabled && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted/90">
            Uploaded PDFs are processed in memory and never saved to a database or disk by this site. When AI is enabled,
            the PDF is sent to Google&apos;s Gemini API for extraction. On billed API keys, Google does not train on your
            data and logs requests temporarily only for abuse prevention; on free-tier keys, Google terms allow data to
            be used for model improvement and human review. Do not upload confidential, personal, or financial documents.
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

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_400px]">
        <nav aria-label="Invoices" className="border-b border-rule lg:border-r lg:border-b-0">
          {GROUPS.map((g) => {
            const list = open.filter((i) => i.decision.route === g.route);
            if (!list.length) return null;
            return (
              <section key={g.route}>
                <h2 className={`flex items-center gap-2 px-4 pt-4 pb-1 text-xs font-semibold ${g.text}`}>
                  <span aria-hidden className={`size-1.5 rounded-full ${g.dot}`} />
                  {g.title} ({list.length})
                </h2>
                {list.map((i) => (
                  <Row key={i.id} invoice={i} selected={i.id === selected.id} onSelect={() => openInvoice(i.id)} />
                ))}
              </section>
            );
          })}
          {done.length > 0 && (
            <section>
              <h2 className="flex items-center justify-between px-4 pt-4 pb-1 text-xs font-semibold text-muted">
                Done ({done.length})
                <button onClick={reset} className="font-normal underline">
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

        <section aria-label="Invoice document" className="order-3 bg-desk p-4 sm:p-6 lg:order-none">
          {previewUrl ? (
            <iframe src={previewUrl} title={selected.fileName} className="h-[80vh] w-full bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/samples/${selected.id}.png`}
              alt={`Sample invoice from ${selected.fields.supplierName ?? "a supplier"}`}
              className="mx-auto w-full max-w-[640px] bg-white shadow-sm"
            />
          )}
        </section>

        <aside ref={decisionPanel} aria-label="Decision" className="scroll-mt-2 border-l-0 border-rule bg-sheet lg:border-l">
          <div className={`border-b p-4 sm:p-5 ${CARD[decision.route]}`}>
            {outcome ? (
              <>
                <p className="text-base font-semibold">{outcome.result === "approved" ? "Approved" : "Held"}</p>
                <p className="mt-1 text-sm text-muted">
                  {outcome.result === "approved"
                    ? "This one will be in your CSV export."
                    : "This one won't be posted. Nothing was exported."}
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold">{decision.headline}</p>
                {decision.question && <p className="mt-1.5 text-sm leading-relaxed">{decision.question}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {decision.options.map((option, index) => (
                    <button
                      key={option.label}
                      onClick={() => settle(selected, option)}
                      className={`rounded px-3 py-1.5 text-sm ${
                        index === 0 ? "bg-ink text-sheet" : "border border-ink/25 hover:bg-sheet/70"
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
            <h3 className="text-xs font-semibold text-muted">What was read</h3>
            <dl className="mt-2">
              {selected.views.map((v) => {
                const a = AGREEMENT[v.agreement];
                const value = fields[v.field] === v.value ? fieldText(v, fields.currency) : fieldText({ ...v, value: fields[v.field] }, fields.currency);
                return (
                  <div key={v.field} className="grid grid-cols-[110px_minmax(0,1fr)_22px] items-baseline gap-2 border-b border-rule/70 py-1.5 text-sm">
                    <dt className="text-xs text-muted">{FIELD_LABELS[v.field]}</dt>
                    <dd className={`min-w-0 break-words ${typeof v.value === "number" || v.field === "iban" || v.field === "supplierTrn" ? "figures text-[13px]" : ""}`}>
                      {value}
                    </dd>
                    <span title={a.label} className={`figures text-right text-xs ${a.tone}`}>
                      <span aria-hidden>{a.mark}</span>
                      <span className="sr-only">{a.label}</span>
                    </span>
                  </div>
                );
              })}
            </dl>

            <h3 className="mt-6 text-xs font-semibold text-muted">Checks</h3>
            <ul className="mt-1">
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
            <h2 className="font-semibold">Measured on {report.invoices} test invoices</h2>
            {report.ai ? (
              <p className="mt-1 text-muted">
                AI read {report.ai.accuracy}% of {report.ai.fieldsChecked} fields correctly. Checks caught{" "}
                {report.plantedErrors.caught} of {report.plantedErrors.total} planted errors.
                {report.cleanInvoicesCleared &&
                  ` ${report.cleanInvoicesCleared.cleared} of ${report.cleanInvoicesCleared.total} clean invoices cleared without a person.`}
              </p>
            ) : (
              <p className="mt-1 text-muted">
                Checks caught {report.plantedErrors.caught} of {report.plantedErrors.total} planted errors on invoices
                they could read. AI accuracy hasn&apos;t been measured yet.
              </p>
            )}
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
