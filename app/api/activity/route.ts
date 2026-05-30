import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseAbi, parseAbiItem, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { publicClient } from "@/lib/chain";
import { ERC20_TOKENS } from "@/lib/tokens";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const erc20MetaAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

export function OPTIONS() {
  return optionsResponse();
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value: bigint, decimals: number) {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, 3).replace(/0+$/, "");
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

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:activity", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  if (!isAddress(address)) return jsonResponse([]);

  try {
    const latest = await publicClient.getBlockNumber();
    const fromBlock = latest > 200_000n ? latest - 200_000n : 0n;
    const lower = address.toLowerCase();
    const [incoming, outgoing] = await Promise.all([
      publicClient.getLogs({
        event: transferEvent,
        args: { to: address as Address },
        fromBlock,
        toBlock: "latest",
      }),
      publicClient.getLogs({
        event: transferEvent,
        args: { from: address as Address },
        fromBlock,
        toBlock: "latest",
      }),
    ]);
    const seen = new Set<string>();
    const logs = await Promise.all(
      [...incoming, ...outgoing]
        .filter((log) => {
          const value = log.args.value ?? 0n;
          if (value <= 0n) return false;
          const key = `${log.transactionHash}-${log.logIndex}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(async (log) => {
          const from = String(log.args.from ?? "");
          const to = String(log.args.to ?? "");
          const incomingTx = to.toLowerCase() === lower;
          const value = log.args.value ?? 0n;
          const meta = await getTokenMeta(log.address);
          return {
            hash: log.transactionHash,
            type: incomingTx ? "in" : "out",
            title: incomingTx ? `Received ${meta.symbol}` : `Sent ${meta.symbol}`,
            subtitle: incomingTx ? `From ${shortAddress(from)}` : `To ${shortAddress(to)}`,
            amount: `${incomingTx ? "+" : "-"}${formatTokenAmount(value, meta.decimals)} ${meta.symbol}`,
            status: "Completed",
            blockNumber: Number(log.blockNumber),
            logIndex: log.logIndex,
          };
        }),
    );

    logs.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    return jsonResponse(logs.slice(0, 30));
  } catch (error) {
    console.error("Failed to fetch real activity", error);
    return jsonResponse([]);
  }
}
