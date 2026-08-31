import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";

const SHARED_CACHE_ROOT = "/tmp/lumina-shared-cache";

export type SharedCacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  data: T;
};

export async function readSharedCache<T>(namespace: string, key: string) {
  try {
    const entry = JSON.parse(await readFile(cachePath(namespace, key), "utf8")) as SharedCacheEntry<T>;
    if (!entry || typeof entry !== "object" || entry.staleUntil <= Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function writeSharedCache<T>(namespace: string, key: string, entry: SharedCacheEntry<T>) {
  const directory = namespacePath(namespace);
  const destination = cachePath(namespace, key);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, destination);
}

function namespacePath(namespace: string) {
  const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${SHARED_CACHE_ROOT}/${safeNamespace}`;
}

function cachePath(namespace: string, key: string) {
  const digest = createHash("sha256").update(key).digest("hex");
  return `${namespacePath(namespace)}/${digest}.json`;
}
