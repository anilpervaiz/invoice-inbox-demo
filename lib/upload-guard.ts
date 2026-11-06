import { getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_PDF_PAGES = 5;
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024; // 64 KB overhead margin for multipart boundary/headers

export function isUploadsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.UPLOADS_ENABLED?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  return env.NODE_ENV !== "production";
}

export type InspectionResult =
  | { ok: true; numPages: number }
  | { ok: false; status: 400; error: string };

export async function inspectPdfUpload(data: Uint8Array, maxPages = MAX_PDF_PAGES): Promise<InspectionResult> {
  // 1. Check real PDF magic header (%PDF-)
  if (
    data.length < 5 ||
    data[0] !== 0x25 || // '%'
    data[1] !== 0x50 || // 'P'
    data[2] !== 0x44 || // 'D'
    data[3] !== 0x46 || // 'F'
    data[4] !== 0x2d // '-'
  ) {
    return { ok: false, status: 400, error: "Only PDF files work here." };
  }

  // 2. Inspect document structure, password protection, and page count
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string } | null;
    const msg = String(err?.message ?? "").toLowerCase();
    const name = String(err?.name ?? "");
    if (name === "PasswordException" || msg.includes("password") || msg.includes("need password")) {
      return {
        ok: false,
        status: 400,
        error: "This PDF is password-protected. Please upload an unlocked copy.",
      };
    }
    return { ok: false, status: 400, error: "Only valid PDF files work here." };
  }

  try {
    const numPages = pdf.numPages;
    if (numPages < 1) {
      return { ok: false, status: 400, error: "This PDF has no pages." };
    }
    if (numPages > maxPages) {
      return {
        ok: false,
        status: 400,
        error: `Please use an invoice of ${maxPages} pages or fewer.`,
      };
    }
    return { ok: true, numPages };
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      // Ignore destruction error on teardown
    }
  }
}

export type BoundedFormResult =
  | { ok: true; file: File; data: Uint8Array }
  | { ok: false; status: 400 | 413; error: string };

export async function readBoundedFormData(
  request: Request,
  maxBytes = MAX_UPLOAD_BYTES,
): Promise<BoundedFormResult> {
  // Check Content-Length header before reading body
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > maxBytes + MULTIPART_OVERHEAD_BYTES) {
      return { ok: false, status: 413, error: "Please use a PDF under 4 MB." };
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "Invalid form upload request." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 400, error: "Please choose a PDF." };
  }

  if (file.size > maxBytes) {
    return { ok: false, status: 413, error: "Please use a PDF under 4 MB." };
  }

  if (file.size === 0) {
    return { ok: false, status: 400, error: "The chosen file is empty." };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  return { ok: true, file, data };
}
