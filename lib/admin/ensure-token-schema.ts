import { db } from "@/lib/db";
import { TOKENS, type TokenConfig } from "@/lib/tokens";

let ensured: Promise<void> | null = null;

export function ensureTokenControlColumns() {
  ensured ??= db
    .$executeRawUnsafe(`
      ALTER TABLE "Token"
        ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'community',
        ADD COLUMN IF NOT EXISTS "canTransfer" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "canSwap" BOOLEAN NOT NULL DEFAULT true
    `)
    .then(() => undefined);
  return ensured;
}

function coreTokenContractAddr(token: TokenConfig) {
  return token.native ? null : (token.contractAddress ?? token.wrappedAddress ?? null);
}

export async function ensureCoreTokens() {
  await ensureTokenControlColumns();

  for (const token of TOKENS) {
    const contractAddr = coreTokenContractAddr(token);
    const data = {
      symbol: token.symbol,
      name: token.name,
      contractAddr,
      decimals: token.decimals,
      status: "verified",
      tier: "core",
      canTransfer: true,
      canSwap: true,
    };

    const existingBySymbol = await db.token.findUnique({ where: { symbol: token.symbol } });
    if (existingBySymbol) {
      try {
        await db.token.update({ where: { id: existingBySymbol.id }, data });
      } catch {
        await db.token.update({
          where: { id: existingBySymbol.id },
          data: { ...data, contractAddr: existingBySymbol.contractAddr },
        });
      }
      continue;
    }

    const existingByContract = contractAddr ? await db.token.findUnique({ where: { contractAddr } }) : null;
    if (existingByContract) {
      await db.token.update({ where: { id: existingByContract.id }, data });
      continue;
    }

    await db.token.create({
      data: {
        ...data,
        logoUrl: null,
        onTopRanking: token.symbol === "WLD",
      },
    });
  }
}
