export type SwapQuoteResult = {
  amountOut: string;
  amountOutRaw: string;
  fee: number;
  route?: {
    tokens: string[];
    fees: number[];
  };
  sqrtPriceX96After?: string;
  gasEstimate: string;
};

export type SwapQuoteAttempt =
  | (SwapQuoteResult & { ok: true })
  | {
      ok: false;
      fee: number;
      error: string;
    };

export type SwapQuoteSet = {
  bestQuote: SwapQuoteResult | null;
  allQuotes: SwapQuoteAttempt[];
};
