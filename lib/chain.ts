import { createPublicClient, defineChain, fallback, http } from "viem";

const DEFAULT_WORLD_CHAIN_RPC_URLS = [
  "https://worldchain.drpc.org",
  "https://worldchain-mainnet.g.alchemy.com/public",
];

const RPC_TIMEOUT_MS = positiveNumber(process.env.WORLD_CHAIN_RPC_TIMEOUT_MS, 3_500);
const RPC_RETRY_DELAY_MS = positiveNumber(process.env.WORLD_CHAIN_RPC_RETRY_DELAY_MS, 120);
const RPC_ERROR_COOLDOWN_MS = positiveNumber(process.env.WORLD_CHAIN_RPC_ERROR_COOLDOWN_MS, 15_000);
const RPC_RATE_LIMIT_COOLDOWN_MS = positiveNumber(process.env.WORLD_CHAIN_RPC_RATE_LIMIT_COOLDOWN_MS, 60_000);

function configuredUrls(value?: string) {
  return String(value || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * Ordered read-only endpoints. Paid provider keys stay server-side.
 */
export const WORLD_CHAIN_RPC_URLS = Array.from(
  new Set(
    [
      process.env.WORLD_CHAIN_ALCHEMY_RPC_URL,
      process.env.WORLD_CHAIN_QUICKNODE_RPC_URL,
      process.env.QUICKNODE_RPC_URL,
      process.env.WORLD_CHAIN_RPC_URL,
      ...configuredUrls(process.env.WORLD_CHAIN_RPC_URLS),
      process.env.TENDERLY_RPC_URL,
      ...DEFAULT_WORLD_CHAIN_RPC_URLS,
    ].filter((url): url is string => Boolean(url)),
  ),
);

function rpcTransport(url: string) {
  return http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 });
}

export const worldChain = defineChain({
  id: 480,
  name: "World Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: WORLD_CHAIN_RPC_URLS },
  },
  blockExplorers: {
    default: { name: "Worldscan", url: "https://worldscan.org" },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
});

/**
 * Generic viem client for existing read call sites. Ordered fallback is retained,
 * while latency-sensitive reads use readWorldChainWithFallback below.
 */
export const publicClient = createPublicClient({
  chain: worldChain,
  transport: fallback(WORLD_CHAIN_RPC_URLS.map(rpcTransport), {
    retryCount: 0,
    rank: false,
  }),
});

export const worldChainReadClients = WORLD_CHAIN_RPC_URLS.map((url) => ({
  url,
  client: createPublicClient({
    chain: worldChain,
    transport: rpcTransport(url),
  }),
}));

type RpcHealth = {
  consecutiveFailures: number;
  cooldownUntil: number;
};

const rpcHealthStore = globalThis as typeof globalThis & {
  __luminaRpcHealth?: Map<string, RpcHealth>;
};
const rpcHealth = rpcHealthStore.__luminaRpcHealth ?? new Map<string, RpcHealth>();
rpcHealthStore.__luminaRpcHealth = rpcHealth;

/**
 * Executes one provider at a time in configured priority order. A transient
 * failure gets one short retry; rate-limited or repeatedly failing providers
 * are cooled down so every wallet refresh does not keep hitting a bad node.
 */
export async function readWorldChainWithFallback<T>(
  read: (client: (typeof worldChainReadClients)[number]["client"]) => Promise<T>,
) {
  if (!worldChainReadClients.length) throw new Error("No World Chain RPC endpoints configured.");

  const now = Date.now();
  const available = worldChainReadClients.filter(({ url }) => (rpcHealth.get(url)?.cooldownUntil ?? 0) <= now);
  const candidates = available.length ? available : [oldestCoolingEndpoint()];
  let lastError: unknown;

  for (const endpoint of candidates) {
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const value = await read(endpoint.client);
        rpcHealth.set(endpoint.url, { consecutiveFailures: 0, cooldownUntil: 0 });
        return value;
      } catch (error) {
        lastError = error;
        const kind = rpcErrorKind(error);
        if (kind === "rate_limit" || kind === "permanent" || attempt === attempts - 1) {
          markRpcFailure(endpoint.url, kind);
          break;
        }
        await sleep(RPC_RETRY_DELAY_MS + Math.floor(Math.random() * 80));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All World Chain RPC reads failed.");
}

function oldestCoolingEndpoint() {
  return [...worldChainReadClients].sort(
    (a, b) => (rpcHealth.get(a.url)?.cooldownUntil ?? 0) - (rpcHealth.get(b.url)?.cooldownUntil ?? 0),
  )[0];
}

function markRpcFailure(url: string, kind: ReturnType<typeof rpcErrorKind>) {
  const previous = rpcHealth.get(url) ?? { consecutiveFailures: 0, cooldownUntil: 0 };
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldCoolDown = kind === "rate_limit" || consecutiveFailures >= 2;
  rpcHealth.set(url, {
    consecutiveFailures,
    cooldownUntil: shouldCoolDown
      ? Date.now() + (kind === "rate_limit" ? RPC_RATE_LIMIT_COOLDOWN_MS : RPC_ERROR_COOLDOWN_MS)
      : 0,
  });
}

function rpcErrorKind(error: unknown): "rate_limit" | "transient" | "permanent" {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return "rate_limit";
  if (/timeout|timed out|abort|network|fetch failed|\b5\d\d\b|socket|econn/i.test(text)) return "transient";
  return "permanent";
}

function positiveNumber(value: string | undefined, fallbackValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
