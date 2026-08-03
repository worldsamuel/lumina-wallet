import { createPublicClient, defineChain, fallback, http } from "viem";

const DEFAULT_WORLD_CHAIN_RPC_URLS = [
  "https://worldchain.drpc.org",
  "https://worldchain-mainnet.g.alchemy.com/public",
];

const RPC_TIMEOUT_MS = Number(process.env.WORLD_CHAIN_RPC_TIMEOUT_MS || 3_500);
const RPC_HEDGE_DELAY_MS = Number(process.env.WORLD_CHAIN_RPC_HEDGE_DELAY_MS || 250);

function rpcTransport(url: string) {
  return http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 });
}

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
  transport: fallback(WORLD_CHAIN_RPC_URLS.map(rpcTransport), {
    retryCount: 0,
  }),
});

export const worldChainReadClients = WORLD_CHAIN_RPC_URLS.map((url) =>
  createPublicClient({
    chain: worldChain,
    transport: rpcTransport(url),
  }),
);

export async function readWorldChainWithFallback<T>(
  read: (client: (typeof worldChainReadClients)[number]) => Promise<T>,
) {
  if (!worldChainReadClients.length) throw new Error("No World Chain RPC endpoints configured.");

  return new Promise<T>((resolve, reject) => {
    let completed = 0;
    let settled = false;
    let lastError: unknown;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const run = (client: (typeof worldChainReadClients)[number]) => {
      void read(client).then(
        (value) => {
          if (settled) return;
          settled = true;
          timers.forEach(clearTimeout);
          resolve(value);
        },
        (error) => {
          lastError = error;
          completed += 1;
          if (!settled && completed === worldChainReadClients.length) {
            settled = true;
            reject(lastError instanceof Error ? lastError : new Error("All World Chain RPC reads failed."));
          }
        },
      );
    };

    worldChainReadClients.forEach((client, index) => {
      timers.push(setTimeout(() => run(client), index * RPC_HEDGE_DELAY_MS));
    });
  });
}
