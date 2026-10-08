import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env";

const MAX_NAME_ATTEMPTS = 5;

export function getStorageRoot(): string {
  return path.resolve(config.storagePath);
}

export async function ensureStorageDir(): Promise<string> {
  const root = getStorageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

export function assertInsideStorage(targetPath: string): string {
  const root = getStorageRoot();
  const resolved = path.resolve(targetPath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Storage path escaped the evidence directory");
  }

  return resolved;
}

export async function createUniqueStoredPath(extension: string): Promise<string> {
  const root = await ensureStorageDir();

  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const storedFilename = `${randomUUID()}${extension}`;
    const candidate = assertInsideStorage(path.join(root, storedFilename));

    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }

  throw new Error("Failed to allocate a unique stored filename");
}

export async function restrictFilePermissions(filePath: string): Promise<void> {
  await chmod(assertInsideStorage(filePath), 0o600);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(assertInsideStorage(filePath));
    return info.isFile();
  } catch {
    return false;
  }
}

export async function deleteStoredFile(filePath: string): Promise<void> {
  const resolved = assertInsideStorage(filePath);
  await rm(resolved, { force: true });
}

export async function hashFileSha256(filePath: string): Promise<string> {
  const resolved = assertInsideStorage(filePath);
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(resolved)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export function toStoredFilename(absolutePath: string): string {
  return path.basename(assertInsideStorage(absolutePath));
}

export function resolveStoredEvidencePath(storedFilename: string): string {
  return assertInsideStorage(path.join(getStorageRoot(), path.basename(storedFilename)));
}
