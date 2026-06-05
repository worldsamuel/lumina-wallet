import { db } from "@/lib/db";
import { TOKENS, type TokenConfig } from "@/lib/tokens";
import { coreTokenPoolAddress, normalizeTokenFields } from "./token-normalization";

let ensured: Promise<void> | null = null;

export function ensureTokenControlColumns() {
  ensured ??= db
    .$executeRawUnsafe(`
      ALTER TABLE "Token"
        ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'community',
        ADD COLUMN IF NOT EXISTS "canTransfer" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "canSwap" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "poolAddress" TEXT
    `)
    .then(() => undefined);
  return ensured;
}

function coreTokenContractAddr(token: TokenConfig) {
  return token.native ? null : (token.contractAddress ?? token.wrappedAddress ?? null);
}

const LEGACY_CORE_CONTRACTS: Record<string, string[]> = {
  ORB: [
    "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db",
    "0xee21af1d049211206b20b957d07794e7d0b140b3",
  ],
};

function shouldRefreshCoreContract(symbol: string, existing: string | null, next: string | null) {
  if (!next) return existing !== null;
  if (!existing) return true;
  return LEGACY_CORE_CONTRACTS[symbol.toUpperCase()]?.includes(existing.toLowerCase()) ?? false;
}

export async function ensureCoreTokens() {
  await ensureTokenControlColumns();

  for (const token of TOKENS) {
    const contractAddr = coreTokenContractAddr(token);
    const data = normalizeTokenFields({
      symbol: token.symbol,
      name: token.name,
      contractAddr,
      poolAddress: coreTokenPoolAddress(token.symbol),
      decimals: token.decimals,
      tier: "core",
      canTransfer: true,
      canSwap: true,
    });

    const existingBySymbol = await db.token.findUnique({ where: { symbol: token.symbol } });
    if (existingBySymbol) {
      const nextContractAddr = shouldRefreshCoreContract(token.symbol, existingBySymbol.contractAddr, contractAddr)
        ? contractAddr
        : existingBySymbol.contractAddr;
      const updateData = normalizeTokenFields({
        symbol: token.symbol,
        name: token.name,
        contractAddr: nextContractAddr,
        poolAddress: coreTokenPoolAddress(token.symbol),
        decimals: token.decimals,
        tier: existingBySymbol.tier || "core",
      });
      try {
        await db.token.update({ where: { id: existingBySymbol.id }, data: updateData });
      } catch {
        await db.token.update({
          where: { id: existingBySymbol.id },
          data: normalizeTokenFields({ ...updateData, contractAddr: existingBySymbol.contractAddr }),
        });
      }
      continue;
    }

    const existingByContract = contractAddr ? await db.token.findUnique({ where: { contractAddr } }) : null;
    if (existingByContract) {
      await db.token.update({
        where: { id: existingByContract.id },
        data: normalizeTokenFields({
          symbol: token.symbol,
          name: token.name,
          contractAddr,
          poolAddress: coreTokenPoolAddress(token.symbol),
          decimals: token.decimals,
          tier: existingByContract.tier || "core",
        }),
      });
      continue;
    }

    await db.token.create({
      data: {
        ...data,
        status: "verified",
        logoUrl: null,
        onTopRanking: token.symbol === "WLD",
      },
    });
  }
}
