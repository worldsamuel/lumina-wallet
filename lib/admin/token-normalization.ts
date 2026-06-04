type TokenFields = {
  symbol?: string | null;
  contractAddr?: string | null;
  poolAddress?: string | null;
};

export const CORE_TOKEN_FIXUPS: Record<string, { contractAddr: string; poolAddress?: string }> = {
  ORB: {
    contractAddr: "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db",
    poolAddress: "0xee21af1d049211206b20b957d07794e7d0b140b3",
  },
};

export function normalizeTokenFields<T extends TokenFields>(fields: T): T {
  const symbol = String(fields.symbol ?? "").trim().toUpperCase();
  const fixup = CORE_TOKEN_FIXUPS[symbol];
  if (!fixup) return fields;
  return {
    ...fields,
    contractAddr: fixup.contractAddr,
    poolAddress: fixup.poolAddress ?? fields.poolAddress ?? null,
  };
}

export function coreTokenPoolAddress(symbol: string) {
  return CORE_TOKEN_FIXUPS[symbol.toUpperCase()]?.poolAddress ?? null;
}
