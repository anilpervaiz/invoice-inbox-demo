import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { EMPTY_FIELDS, type ReadResult } from "./types";

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

export const aiConfigured = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

export async function readWithAi(data: Uint8Array): Promise<ReadResult> {
  if (!aiConfigured()) {
    return { reader: "ai", status: "unavailable", fields: { ...EMPTY_FIELDS }, note: "No AI key is set." };
  }
  try {
    const { output } = await generateText({
      model: google(process.env.GEMINI_MODEL ?? "gemini-2.5-flash"),
      temperature: 0,
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
  } catch (error) {
    return { reader: "ai", status: "error", fields: { ...EMPTY_FIELDS }, note: String(error).slice(0, 200) };
  }
}
