import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getPublicEarnProducts, productToVault } from "@/lib/admin/earn-products";
import { fetchVaultLiveData, type VaultLiveData } from "@/lib/morpho/api";
import { getEnabledVaults, type MorphoVault } from "@/lib/morpho/vaults";

const CACHE_TTL_MS = 60_000;

export const dynamic = "force-dynamic";

type VaultPayload = MorphoVault & {
  liveData: VaultLiveData;
  depositsPaused: boolean;
};

let cachedVaults: { expiresAt: number; data: VaultPayload[] } | null = null;
let lastGoodVaults: VaultPayload[] | null = null;

function depositsPaused() {
  return process.env.MORPHO_DEPOSITS_PAUSED === "true";
}

function emptyLiveData(): VaultLiveData {
  return {
    netApy: null,
    apy: null,
    totalAssetsUsd: null,
    totalAssets: null,
  };
}

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:morpho-vaults", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  if (cachedVaults && cachedVaults.expiresAt > Date.now()) {
    return jsonResponse(cachedVaults.data.map((vault) => ({ ...vault, depositsPaused: depositsPaused() })));
  }

  try {
    const configured = await getPublicEarnProducts();
    const sourceVaults = configured.length ? configured.map(productToVault) : getEnabledVaults();
    const overrideByAddress = new Map(configured.map((product) => [product.address.toLowerCase(), product.apyOverride]));
    const vaults = await Promise.all(
      sourceVaults.map(async (vault) => {
        const liveData = await fetchVaultLiveData(vault.address).catch((error) => {
          console.error(`Failed to fetch Morpho live data for ${vault.address}`, error);
          return emptyLiveData();
        });
        const override = overrideByAddress.get(vault.address.toLowerCase());
        const overrideValue = override == null ? null : Number(override);
        return {
        ...vault,
        depositsPaused: depositsPaused(),
        liveData: Number.isFinite(overrideValue)
          ? { ...liveData, netApy: overrideValue, apy: overrideValue }
          : liveData,
      };
      }),
    );
    cachedVaults = { data: vaults, expiresAt: Date.now() + CACHE_TTL_MS };
    lastGoodVaults = vaults;
    return jsonResponse(vaults);
  } catch (error) {
    console.error("Failed to fetch Morpho vaults", error);
    if (lastGoodVaults) {
      return jsonResponse(lastGoodVaults.map((vault) => ({ ...vault, depositsPaused: depositsPaused(), stale: true })));
    }
    return jsonResponse({ error: "Unable to fetch Morpho vaults." }, { status: 502 });
  }
}
