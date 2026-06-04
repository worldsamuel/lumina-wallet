import { isAddress, parseUnits, type Address } from "viem";
import { quoteBestV3 } from "@/lib/swap/v3-quoter";
import { SWAP_TOKENS, type SwapToken } from "@/lib/swap/tokens";

type TokenSwapFields = {
  symbol?: string | null;
  name?: string | null;
  contractAddr?: string | null;
  decimals?: number | null;
  canSwap?: boolean;
};

const SELL_REFERENCES = [SWAP_TOKENS.WLD, SWAP_TOKENS.USDC, SWAP_TOKENS.WETH] as const;
const CORE_SWAP_ADDRESSES = new Set(Object.values(SWAP_TOKENS).map((token) => token.address.toLowerCase()));

export async function applySellRouteValidation<T extends TokenSwapFields>(fields: T): Promise<T> {
  if (fields.canSwap === false) return fields;
  if (!fields.contractAddr || !isAddress(fields.contractAddr)) return { ...fields, canSwap: false };

  const address = fields.contractAddr.toLowerCase();
  if (CORE_SWAP_ADDRESSES.has(address)) return fields;

  const result = await validateSellRoute({
    symbol: String(fields.symbol || "TOKEN").toUpperCase(),
    name: String(fields.name || fields.symbol || "Token"),
    address: fields.contractAddr as Address,
    decimals: Number.isInteger(fields.decimals) ? Number(fields.decimals) : 18,
    priceSymbol: "USDC",
    trust: "audited",
  });

  if (result === "unknown") return fields;
  return { ...fields, canSwap: result === "sellable" };
}

async function validateSellRoute(token: SwapToken): Promise<"sellable" | "not_sellable" | "unknown"> {
  const amountIn = parseUnits("1", token.decimals);
  if (amountIn <= 0n) return "unknown";

  try {
    const results = await Promise.all(
      SELL_REFERENCES
        .filter((ref) => ref.address.toLowerCase() !== token.address.toLowerCase())
        .map(async (ref) => {
          const quote = await withTimeout(quoteBestV3(token, ref, amountIn), 4_500);
          return quote.bestQuote && BigInt(quote.bestQuote.amountOutRaw) > 0n;
        }),
    );
    return results.some(Boolean) ? "sellable" : "not_sellable";
  } catch (error) {
    console.error("Failed to validate token sell route", token.symbol, token.address, error);
    return "unknown";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("sell_route_validation_timeout")), timeoutMs);
    }),
  ]);
}
