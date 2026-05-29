import { createPublicClient, defineChain, http } from "viem";

/**
 * Read-only World Chain public client.
 */
export const worldChain = defineChain({
  id: 480,
  name: "World Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://worldchain-mainnet.g.alchemy.com/public"] },
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
  transport: http(),
});
