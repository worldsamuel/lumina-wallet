import { MORPHO_API_ENDPOINT, WORLD_CHAIN_ID } from "./vaults";

export type VaultLiveData = {
  netApy: number | null;
  apy: number | null;
  totalAssetsUsd: number | null;
  totalAssets: string | null;
};

export type UserVaultPosition = {
  shares: string | null;
  assets: string | null;
  assetsUsd: number | null;
};

type GraphqlResponse = {
  data?: unknown;
  errors?: Array<{ message?: string }>;
};

const VAULT_QUERY = `
  query LuminaVault($address: String!, $chainId: Int!) {
    vaultByAddress(address: $address, chainId: $chainId) {
      address
      state {
        netApy
        apy
        totalAssets
        totalAssetsUsd
      }
    }
  }
`;

const POSITION_QUERY = `
  query LuminaVaultPosition($userAddress: String!, $vaultAddress: String!, $chainId: Int!) {
    vaultPosition(userAddress: $userAddress, vaultAddress: $vaultAddress, chainId: $chainId) {
      shares
      assets
      assetsUsd
    }
  }
`;

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(MORPHO_API_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Morpho GraphQL responded ${response.status}`);
  const body = (await response.json()) as GraphqlResponse;
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).filter(Boolean).join("; "));
  }
  return body.data as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function deepFindRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  if (keys.some((key) => key in record)) return record;
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = deepFindRecord(item, keys);
        if (found) return found;
      }
      continue;
    }
    const found = deepFindRecord(child, keys);
    if (found) return found;
  }
  return null;
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export async function fetchVaultLiveData(
  vaultAddress: string,
  chainId = WORLD_CHAIN_ID,
): Promise<VaultLiveData> {
  const data = await graphql<unknown>(VAULT_QUERY, { address: vaultAddress, chainId });
  const state = deepFindRecord(data, ["netApy", "apy", "totalAssetsUsd", "totalAssets"]);
  return {
    netApy: num(state?.netApy),
    apy: num(state?.apy),
    totalAssetsUsd: num(state?.totalAssetsUsd),
    totalAssets: str(state?.totalAssets),
  };
}

export async function fetchUserPosition(
  userAddress: string,
  vaultAddress: string,
  chainId = WORLD_CHAIN_ID,
): Promise<UserVaultPosition> {
  const data = await graphql<unknown>(POSITION_QUERY, { userAddress, vaultAddress, chainId });
  const position = deepFindRecord(data, ["shares", "assets", "assetsUsd"]);
  return {
    shares: str(position?.shares),
    assets: str(position?.assets),
    assetsUsd: num(position?.assetsUsd),
  };
}
