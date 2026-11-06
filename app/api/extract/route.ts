import { readWithAi } from "@/lib/ai-reader";
import { processInvoice } from "@/lib/decide";
import { uploadRuleContext } from "@/lib/demo-data";
import { rateLimiter } from "@/lib/rate-limit";
import { readWithText } from "@/lib/text-reader";
import { inspectPdfUpload, isUploadsEnabled, readBoundedFormData } from "@/lib/upload-guard";

export const maxDuration = 25;

// Files are read in memory and never stored.
export async function POST(request: Request) {
  if (!isUploadsEnabled()) {
    return Response.json(
      { error: "PDF uploads are currently disabled. You can test all features using the sample invoices." },
      { status: 403 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limitDecision = await rateLimiter.checkAndRecord(ip);
  if (!limitDecision.allowed) {
    return Response.json(
      { error: limitDecision.error },
      {
        status: 429,
        headers: { "Retry-After": String(limitDecision.retryAfterSeconds) },
      },
    );
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
