import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
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
    const vaults = await Promise.all(
      getEnabledVaults().map(async (vault) => ({
        ...vault,
        depositsPaused: depositsPaused(),
        liveData: await fetchVaultLiveData(vault.address).catch((error) => {
          console.error(`Failed to fetch Morpho live data for ${vault.address}`, error);
          return emptyLiveData();
        }),
      })),
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
