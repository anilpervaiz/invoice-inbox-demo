import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { EMPTY_FIELDS, type ReadResult } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_AI_TIMEOUT_MS = 15_000;

export const geminiModelId = (): string => process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

const money = z.number().nullable();
const schema = z.object({
  supplierName: z.string().nullable().describe("The company that issued the invoice, not the customer"),
  supplierTrn: z.string().nullable().describe("Tax registration number, digits only"),
  invoiceNumber: z.string().nullable(),
  issueDate: z.string().nullable().describe("YYYY-MM-DD"),
  dueDate: z.string().nullable().describe("YYYY-MM-DD"),
  currency: z.string().nullable().describe("Three letter code"),
  subtotal: money,
  vatRate: z.number().nullable().describe("Percent, for example 5"),
  vatAmount: money,
  total: money,
  iban: z.string().nullable(),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      amount: z.number(),
    }),
  ),
});

const PROMPT = `Read this invoice and copy out what is printed.
Copy amounts exactly as printed, even if the arithmetic looks wrong. Never calculate or correct anything.
If something isn't printed or you can't read it, use null.
Dates on this invoice use day before month when written with slashes.`;

export const aiConfigured = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());

function sanitizeLogMessage(err: unknown): string {
  const raw = String(err instanceof Error ? err.stack ?? err.message : err);
  return raw
    .replace(/(?:key|apiKey|token|secret)=([A-Za-z0-9_-]+)/gi, "$1=[REDACTED]")
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_GOOGLE_KEY]");
}

export type ReadWithAiOptions = {
  timeoutMs?: number;
  model?: Parameters<typeof generateText>[0]["model"];
};

export async function readWithAi(data: Uint8Array, options?: ReadWithAiOptions): Promise<ReadResult> {
  if (!aiConfigured()) {
    return { reader: "ai", status: "unavailable", fields: { ...EMPTY_FIELDS }, note: "No AI key is set." };
  }
  try {
    const targetModel = options?.model ?? google(geminiModelId());
    const timeoutMs = options?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;

    const { output } = await generateText({
      model: targetModel,
      temperature: 0,
      timeout: timeoutMs,
      maxRetries: 0,
      output: Output.object({ schema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "file", data, mediaType: "application/pdf" },
          ],
        },
      ],
    });
    return { reader: "ai", status: "ok", fields: output };
  } catch (error: unknown) {
    const sanitized = sanitizeLogMessage(error);
    console.error("[ai-reader] AI read failed:", sanitized);

    const err = error as { name?: string; message?: string } | null;
    const errorName = String(err?.name ?? "");
    const errorMsg = String(err?.message ?? "").toLowerCase();
    const isTimeout =
      errorName === "AbortError" ||
      errorName === "TimeoutError" ||
      errorMsg.includes("timeout") ||
      errorMsg.includes("timed out") ||
      errorMsg.includes("abort");

    return {
      reader: "ai",
      status: "error",
      fields: { ...EMPTY_FIELDS },
      note: isTimeout ? "The AI reader timed out." : "The AI reader couldn't read this invoice right now.",
    };
  }
}
