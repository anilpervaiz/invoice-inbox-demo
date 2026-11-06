import { readWithAi } from "@/lib/ai-reader";
import { processInvoice } from "@/lib/decide";
import { uploadRuleContext } from "@/lib/demo-data";
import { readWithText } from "@/lib/text-reader";
import { inspectPdfUpload, readBoundedFormData } from "@/lib/upload-guard";

const HOURLY_LIMIT = 10;
const hits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > HOURLY_LIMIT;
}

// Files are read in memory and never stored.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (limited(ip)) {
    return Response.json({ error: "That's the limit for this demo. Try again in an hour." }, { status: 429 });
  }

  const bounded = await readBoundedFormData(request);
  if (!bounded.ok) {
    return Response.json({ error: bounded.error }, { status: bounded.status });
  }
  const { file, data } = bounded;

  const inspection = await inspectPdfUpload(data);
  if (!inspection.ok) {
    return Response.json({ error: inspection.error }, { status: inspection.status });
  }

  const [text, ai] = await Promise.all([readWithText(data.slice()), readWithAi(data.slice())]);
  const id = `upload-${Date.now()}`;
  return Response.json(processInvoice(id, file.name, text, ai, uploadRuleContext()));
}
