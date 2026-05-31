import { formatUnits, parseAbi, parseAbiItem, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import { ERC20_TOKENS } from "@/lib/tokens";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const erc20MetaAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value: bigint, decimals: number) {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

async function getTokenMeta(address: Address) {
  const key = address.toLowerCase();
  const configured = ERC20_TOKENS.find((token) => token.contractAddress.toLowerCase() === key);
  if (configured) return { symbol: configured.symbol, decimals: configured.decimals };
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;

  try {
    const [symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20MetaAbi, functionName: "symbol" }),
      publicClient.readContract({ address, abi: erc20MetaAbi, functionName: "decimals" }),
    ]);
    const meta = { symbol: String(symbol || "TOKEN").slice(0, 12), decimals: Number(decimals || 18) };
    tokenMetaCache.set(key, meta);
    return meta;
  } catch {
    return { symbol: "TOKEN", decimals: 18 };
  }
}

export type AdminActivityRow = {
  id: string;
  cat: string;
  type: string;
  typeT: string;
  user: string;
  amount: string;
  hash: string;
  time: string;
  status: string;
  statusT: string;
  createdAt: string;
  blockNumber: number;
  logIndex: number;
};

export async function getRecentUserActivity(addresses: Address[], maxRows = 80) {
  if (!addresses.length) return [];

  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 200_000n ? latest - 200_000n : 0n;
  const unique = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const seen = new Set<string>();
  const rows: AdminActivityRow[] = [];

  await Promise.all(
    unique.slice(0, 40).map(async (lower) => {
      const address = lower as Address;
      const [incoming, outgoing] = await Promise.all([
        publicClient.getLogs({
          event: transferEvent,
          args: { to: address },
          fromBlock,
          toBlock: "latest",
        }),
        publicClient.getLogs({
          event: transferEvent,
          args: { from: address },
          fromBlock,
          toBlock: "latest",
        }),
      ]);

      await Promise.all(
        [...incoming, ...outgoing].map(async (log) => {
          const value = log.args.value ?? 0n;
          if (value <= 0n) return;
          const key = `${log.transactionHash}-${log.logIndex}`;
          if (seen.has(key)) return;
          seen.add(key);

          const from = String(log.args.from ?? "");
          const to = String(log.args.to ?? "");
          const incomingTx = to.toLowerCase() === lower;
          const meta = await getTokenMeta(log.address);
          const createdAt = new Date().toISOString();

          rows.push({
            id: key,
            cat: incomingTx ? "received" : "sent",
            type: incomingTx ? "received" : "sent",
            typeT: incomingTx ? `Received ${meta.symbol}` : `Sent ${meta.symbol}`,
            user: shortAddress(incomingTx ? to : from),
            amount: `${incomingTx ? "+" : "-"}${formatTokenAmount(value, meta.decimals)} ${meta.symbol}`,
            hash: log.transactionHash,
            time: `Block ${log.blockNumber.toString()}`,
            status: "completed",
            statusT: "Completed",
            createdAt,
            blockNumber: Number(log.blockNumber),
            logIndex: log.logIndex,
          });
        }),
      );
    }),
  );

  rows.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  return rows.slice(0, maxRows);
}
