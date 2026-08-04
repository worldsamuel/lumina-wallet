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

  try {
    const configured = await getPublicEarnProducts();
    if (cachedVaults && cachedVaults.expiresAt > Date.now()) {
      const displayApyByAddress = new Map(
        configured.map((product) => {
          const vault = productToVault(product);
          return [vault.address.toLowerCase(), vault.displayApy ?? null] as const;
        }),
      );
      return jsonResponse(
        cachedVaults.data.map((vault) => ({
          ...vault,
          displayApy: displayApyByAddress.has(vault.address.toLowerCase())
            ? displayApyByAddress.get(vault.address.toLowerCase())
            : vault.displayApy ?? null,
          depositsPaused: depositsPaused(),
        })),
      );
    }
    const sourceVaults = configured.length ? configured.map(productToVault) : getEnabledVaults();
    const vaults = await Promise.all(
      sourceVaults.map(async (vault) => {
        const liveData = await fetchVaultLiveData(vault.address).catch((error) => {
          console.error(`Failed to fetch Morpho live data for ${vault.address}`, error);
          return emptyLiveData();
        });
        return {
          ...vault,
          depositsPaused: depositsPaused(),
          liveData,
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
