import { NextRequest } from "next/server";
import { formatUnits, isAddress, parseAbiItem, type Address } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { publicClient } from "@/lib/chain";
import { ERC20_TOKENS } from "@/lib/tokens";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export function OPTIONS() {
  return optionsResponse();
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
    const logs = (
      await Promise.all(
        ERC20_TOKENS.map(async (token) => {
          const [incoming, outgoing] = await Promise.all([
            publicClient.getLogs({
              address: token.contractAddress,
              event: transferEvent,
              args: { to: address as Address },
              fromBlock,
              toBlock: "latest",
            }),
            publicClient.getLogs({
              address: token.contractAddress,
              event: transferEvent,
              args: { from: address as Address },
              fromBlock,
              toBlock: "latest",
            }),
          ]);
          return [...incoming, ...outgoing].map((log) => {
            const from = String(log.args.from ?? "");
            const to = String(log.args.to ?? "");
            const incomingTx = to.toLowerCase() === lower;
            const value = log.args.value ?? 0n;
            return {
              hash: log.transactionHash,
              type: incomingTx ? "in" : "out",
              title: incomingTx ? `Received ${token.symbol}` : `Sent ${token.symbol}`,
              subtitle: incomingTx ? `From ${shortAddress(from)}` : `To ${shortAddress(to)}`,
              amount: `${incomingTx ? "+" : "-"}${formatUnits(value, token.decimals)} ${token.symbol}`,
              status: "Completed",
              blockNumber: Number(log.blockNumber),
              logIndex: log.logIndex,
            };
          });
        }),
      )
    ).flat();

    logs.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
    return jsonResponse(logs.slice(0, 30));
  } catch (error) {
    console.error("Failed to fetch real activity", error);
    return jsonResponse([]);
  }
}
