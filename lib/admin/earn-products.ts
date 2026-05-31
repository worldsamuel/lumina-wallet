import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchVaultLiveData, type VaultLiveData } from "@/lib/morpho/api";
import { getEnabledVaults, RE7_VAULTS, type MorphoVault } from "@/lib/morpho/vaults";

const EARN_PRODUCTS_KEY = "earn_products";

export type EarnProductConfig = {
  address: `0x${string}`;
  displayName: string;
  assetAddress: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  riskLevel: MorphoVault["riskLevel"];
  enabled: boolean;
  apyOverride: string | null;
  description: MorphoVault["description"];
  sortOrder: number;
};

export type EarnProductPayload = EarnProductConfig & {
  liveData: VaultLiveData;
};

function defaultConfigs(): EarnProductConfig[] {
  return RE7_VAULTS.map((vault, index) => ({
    address: vault.address,
    displayName: vault.displayName,
    assetAddress: vault.asset.address,
    assetSymbol: vault.asset.symbol,
    assetDecimals: vault.asset.decimals,
    riskLevel: vault.riskLevel,
    enabled: vault.enabled,
    apyOverride: null,
    description: vault.description,
    sortOrder: index + 1,
  }));
}

function parseConfigs(value: unknown): EarnProductConfig[] {
  if (!Array.isArray(value)) return defaultConfigs();
  const defaults = defaultConfigs();
  const byAddress = new Map(defaults.map((item) => [item.address.toLowerCase(), item]));
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const product = item as Partial<EarnProductConfig>;
    if (!product.address) continue;
    byAddress.set(String(product.address).toLowerCase(), {
      address: product.address as `0x${string}`,
      displayName: product.displayName || product.assetSymbol || "Earn Vault",
      assetAddress: (product.assetAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`,
      assetSymbol: product.assetSymbol || "TOKEN",
      assetDecimals: Number(product.assetDecimals ?? 18),
      riskLevel: product.riskLevel || "medium",
      enabled: product.enabled !== false,
      apyOverride: product.apyOverride ?? null,
      description: product.description || { en: "", "zh-CN": "" },
      sortOrder: Number(product.sortOrder ?? byAddress.size + 1),
    });
  }
  return [...byAddress.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

async function readStoredConfigs() {
  const page = await db.contentPage.findUnique({ where: { key: EARN_PRODUCTS_KEY } });
  return parseConfigs(page?.bodyI18n);
}

async function writeStoredConfigs(products: EarnProductConfig[]) {
  await db.contentPage.upsert({
    where: { key: EARN_PRODUCTS_KEY },
    update: { bodyI18n: products as unknown as Prisma.InputJsonValue },
    create: { key: EARN_PRODUCTS_KEY, bodyI18n: products as unknown as Prisma.InputJsonValue },
  });
  return products;
}

export async function getEarnProducts() {
  return readStoredConfigs();
}

export async function getPublicEarnProducts() {
  return (await readStoredConfigs()).filter((product) => product.enabled);
}

export async function upsertEarnProduct(input: Partial<EarnProductConfig> & { address: string }) {
  const products = await readStoredConfigs();
  const index = products.findIndex((item) => item.address.toLowerCase() === input.address.toLowerCase());
  const existing = index >= 0 ? products[index] : null;
  const next: EarnProductConfig = {
    address: input.address as `0x${string}`,
    displayName: input.displayName || existing?.displayName || "Earn Vault",
    assetAddress: (input.assetAddress || existing?.assetAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    assetSymbol: input.assetSymbol || existing?.assetSymbol || "TOKEN",
    assetDecimals: Number(input.assetDecimals ?? existing?.assetDecimals ?? 18),
    riskLevel: input.riskLevel || existing?.riskLevel || "medium",
    enabled: input.enabled ?? existing?.enabled ?? true,
    apyOverride: input.apyOverride === undefined ? existing?.apyOverride ?? null : input.apyOverride,
    description: input.description || existing?.description || { en: "", "zh-CN": "" },
    sortOrder: Number(input.sortOrder ?? existing?.sortOrder ?? products.length + 1),
  };
  if (index >= 0) products[index] = next;
  else products.push(next);
  return writeStoredConfigs(products.sort((a, b) => a.sortOrder - b.sortOrder));
}

export async function deleteEarnProduct(address: string) {
  const products = await readStoredConfigs();
  return writeStoredConfigs(products.filter((item) => item.address.toLowerCase() !== address.toLowerCase()));
}

export function productToVault(product: EarnProductConfig): MorphoVault {
  return {
    address: product.address,
    displayName: product.displayName,
    asset: {
      address: product.assetAddress,
      symbol: product.assetSymbol,
      decimals: product.assetDecimals,
    },
    riskLevel: product.riskLevel,
    enabled: product.enabled,
    description: product.description,
  };
}

export async function getEnabledEarnVaults() {
  const configured = await getPublicEarnProducts();
  if (configured.length) return configured.map(productToVault);
  return getEnabledVaults();
}

export async function getEarnProductsWithLiveData(): Promise<EarnProductPayload[]> {
  const products = await readStoredConfigs();
  return Promise.all(
    products.map(async (product) => {
      const liveData = await fetchVaultLiveData(product.address).catch(() => ({
        netApy: null,
        apy: null,
        totalAssetsUsd: null,
        totalAssets: null,
      }));
      const override = product.apyOverride === null ? null : Number(product.apyOverride);
      return {
        ...product,
        liveData: {
          ...liveData,
          netApy: Number.isFinite(override) ? override : liveData.netApy,
          apy: Number.isFinite(override) ? override : liveData.apy,
        },
      };
    }),
  );
}
