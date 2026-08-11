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
  imageUrl?: string | null;
  apyOverride: string | null;
  description: MorphoVault["description"];
  sortOrder: number;
};

export type EarnProductPayload = EarnProductConfig & {
  liveData: VaultLiveData;
  displayApy: number | null;
};

export function parseDisplayApy(value: string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const hasPercentSign = normalized.endsWith("%");
  const numeric = Number(hasPercentSign ? normalized.slice(0, -1).trim() : normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (hasPercentSign || numeric > 1) return numeric / 100;
  return numeric;
}

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

function builtInDescription(address: string, fallback?: MorphoVault["description"]) {
  const vault = RE7_VAULTS.find((item) => item.address.toLowerCase() === address.toLowerCase());
  return vault?.description || fallback || { en: "", "zh-CN": "" };
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
      imageUrl: typeof product.imageUrl === "string" ? product.imageUrl : null,
      apyOverride: product.apyOverride ?? null,
      description: builtInDescription(String(product.address), product.description),
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
    imageUrl: input.imageUrl === undefined ? existing?.imageUrl ?? null : input.imageUrl,
    apyOverride: input.apyOverride === undefined ? existing?.apyOverride ?? null : input.apyOverride,
    description: builtInDescription(input.address, input.description || existing?.description),
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
    imageUrl: product.imageUrl ?? null,
    displayApy: parseDisplayApy(product.apyOverride),
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
      return {
        ...product,
        displayApy: parseDisplayApy(product.apyOverride),
        liveData,
      };
    }),
  );
}
