import { open } from "node:fs/promises";
import path from "node:path";

export const ALLOWED_EXTENSIONS = [".txt", ".log", ".json", ".csv", ".pdf", ".png", ".jpg", ".zip"] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<AllowedExtension, string[]> = {
  ".txt": ["text/plain"],
  ".log": ["text/plain", "text/x-log"],
  ".json": ["application/json", "text/json", "text/plain"],
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

const TEXT_EXTENSIONS = new Set<AllowedExtension>([".txt", ".log", ".json", ".csv"]);

export function normalizeOriginalFilename(originalname: string): string {
  const sanitized = originalname.replace(/\\/g, "/");
  const base = path.basename(sanitized);
  return base.length > 0 ? base.slice(0, 255) : "unnamed";
}

export function getAllowedExtension(originalname: string): AllowedExtension | null {
  const filename = normalizeOriginalFilename(originalname);
  const extension = path.extname(filename).toLowerCase() as AllowedExtension;
  return ALLOWED_EXTENSIONS.includes(extension) ? extension : null;
}

export function expectedMimeTypes(extension: AllowedExtension): string[] {
  return MIME_BY_EXTENSION[extension];
}

export function isAllowedMimeType(extension: AllowedExtension, mimeType: string | undefined): boolean {
  if (!mimeType) {
    return TEXT_EXTENSIONS.has(extension);
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "application/octet-stream") {
    return true;
  }

  return expectedMimeTypes(extension).includes(normalized);
}

export function canonicalMimeType(extension: AllowedExtension, mimeType: string | undefined): string {
  const normalized = mimeType?.toLowerCase().split(";")[0].trim();
  if (normalized && expectedMimeTypes(extension).includes(normalized)) {
    return normalized;
  }

  return expectedMimeTypes(extension)[0];
}

export async function hasExpectedSignature(filePath: string, extension: AllowedExtension): Promise<boolean> {
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, 8, 0);
    const header = buffer.subarray(0, bytesRead);

    if (extension === ".pdf") {
      return header.toString("ascii", 0, 4) === "%PDF";
    }

    if (extension === ".png") {
      return header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }

    if (extension === ".jpg") {
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }

    if (extension === ".zip") {
      return (
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)
      );
    }

    return false;
  } finally {
    await handle.close();
  }
}
