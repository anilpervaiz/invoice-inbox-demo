import { readWithAi } from "@/lib/ai-reader";
import { processInvoice } from "@/lib/decide";
import { uploadRuleContext } from "@/lib/demo-data";
import { readWithText } from "@/lib/text-reader";

const MAX_BYTES = 4 * 1024 * 1024;
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
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Please choose a PDF." }, { status: 400 });
  if (file.type !== "application/pdf") return Response.json({ error: "Only PDF files work here." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Please use a PDF under 4 MB." }, { status: 400 });

  const data = new Uint8Array(await file.arrayBuffer());
  const [text, ai] = await Promise.all([readWithText(data.slice()), readWithAi(data.slice())]);
  const id = `upload-${Date.now()}`;
  return Response.json(processInvoice(id, file.name, text, ai, uploadRuleContext()));
}
