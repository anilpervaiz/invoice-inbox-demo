import { aiConfigured, readWithAi } from "@/lib/ai-reader";
import { readWithText } from "@/lib/text-reader";

const EXPECTED_TOTAL = 2530.5;

// A real read of a real file, because a page can load while the service behind it is down.
export async function GET(request: Request) {
  const response = await fetch(new URL("/samples/clean-local.pdf", request.url), { cache: "no-store" });
  if (!response.ok) return Response.json({ ok: false, reason: "sample file missing" }, { status: 503 });
  const data = new Uint8Array(await response.arrayBuffer());
  const text = await readWithText(data.slice());
  const ai = aiConfigured() ? await readWithAi(data.slice()) : null;
  const textOk = text.status === "ok" && text.fields.total === EXPECTED_TOTAL;
  const aiOk = ai === null ? null : ai.status === "ok" && ai.fields.total === EXPECTED_TOTAL;
  const ok = textOk && aiOk !== false;
  return Response.json({ ok, text: textOk, ai: aiOk, checkedAt: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
