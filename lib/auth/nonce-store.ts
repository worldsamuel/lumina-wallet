const NONCE_TTL_MS = 5 * 60 * 1000;

type NonceEntry = {
  expiresAt: number;
};

const nonceStore = new Map<string, NonceEntry>();

function pruneExpiredNonces() {
  const now = Date.now();
  Array.from(nonceStore.entries()).forEach(([nonce, entry]) => {
    if (entry.expiresAt <= now) nonceStore.delete(nonce);
  });
}

/**
 * Short-lived in-memory nonce cache for walletAuth.
 */
export function createNonce() {
  // TODO 改 Redis
  pruneExpiredNonces();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  nonceStore.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS });
  return nonce;
}

export function consumeNonce(nonce: string) {
  // TODO 改 Redis
  pruneExpiredNonces();
  const entry = nonceStore.get(nonce);
  if (!entry) return false;
  nonceStore.delete(nonce);
  return entry.expiresAt > Date.now();
}
