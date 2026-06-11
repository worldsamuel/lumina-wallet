import { createPublicClient, defineChain, fallback, http } from "viem";

const DEFAULT_WORLD_CHAIN_RPC_URLS = [
  "https://worldchain.drpc.org",
  "https://worldchain-mainnet.g.alchemy.com/public",
];

export const WORLD_CHAIN_RPC_URLS = Array.from(
  new Set(
    [
      process.env.TENDERLY_RPC_URL,
      process.env.WORLD_CHAIN_RPC_URL,
      process.env.WORLD_CHAIN_ALCHEMY_RPC_URL,
      ...(process.env.WORLD_CHAIN_RPC_URLS ?? "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean),
      ...DEFAULT_WORLD_CHAIN_RPC_URLS,
    ].filter((url): url is string => Boolean(url)),
  ),
);

/**
 * Read-only World Chain public client.
 */
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
 * Public RPC client for read-only chain calls. Do not use it for transactions.
 */
export const publicClient = createPublicClient({
  chain: worldChain,
  transport: fallback(WORLD_CHAIN_RPC_URLS.map((url) => http(url, { timeout: 6_000 })), {
    retryCount: 2,
  }),
});

export const worldChainReadClients = WORLD_CHAIN_RPC_URLS.map((url) =>
  createPublicClient({
    chain: worldChain,
    transport: http(url, { timeout: 6_000 }),
  }),
);

export async function readWorldChainWithFallback<T>(
  read: (client: (typeof worldChainReadClients)[number]) => Promise<T>,
) {
  let lastError: unknown;
  for (const client of worldChainReadClients) {
    try {
      return await read(client);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All World Chain RPC reads failed.");
}
