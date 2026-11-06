import { createHash, timingSafeEqual } from "node:crypto";
import { aiConfigured, readWithAi } from "@/lib/ai-reader";
import { readWithText } from "@/lib/text-reader";

export const maxDuration = 25;

const EXPECTED_TOTAL = 2530.5;

function safeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// A real read of a real file, because a page can load while the service behind it is down.
// Public requests run only the plain-code reader (zero AI cost).
// Full AI verification requires Authorization: Bearer <HEALTH_TOKEN> or x-health-token header.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const token = bearerToken ?? request.headers.get("x-health-token")?.trim() ?? null;

  const serverHealthToken = process.env.HEALTH_TOKEN?.trim() || null;
  const isFullCheckRequested = Boolean(token);

  if (isFullCheckRequested) {
    if (!serverHealthToken || !safeCompare(token, serverHealthToken)) {
      return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }
  }

  const response = await fetch(new URL("/samples/clean-local.pdf", request.url), { cache: "no-store" });
  if (!response.ok) return Response.json({ ok: false, reason: "sample file missing" }, { status: 503 });
  const data = new Uint8Array(await response.arrayBuffer());
  const text = await readWithText(data.slice());
  const textOk = text.status === "ok" && text.fields.total === EXPECTED_TOTAL;

  if (!isFullCheckRequested) {
    return Response.json(
      {
        ok: textOk,
        text: textOk,
        ai: null,
        mode: "text-only",
        checkedAt: new Date().toISOString(),
      },
      { status: textOk ? 200 : 503 },
    );
  }

  const ai = aiConfigured() ? await readWithAi(data.slice()) : null;
  const aiOk = ai !== null && ai.status === "ok" && ai.fields.total === EXPECTED_TOTAL;
  const ok = textOk && aiOk;

  return Response.json(
    {
      ok,
      text: textOk,
      ai: aiOk,
      mode: "full",
      checkedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
