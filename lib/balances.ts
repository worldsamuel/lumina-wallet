import { formatUnits, type Address } from "viem";
import { readWorldChainWithFallback } from "./chain";
import { db } from "./db";
import { ERC20_TOKENS, TOKENS } from "./tokens";
import worldChainTokenCatalog from "./swap/worldchain-token-catalog.json";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type ChainBalance = {
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
  formatted: string;
  logo: string;
  className: string;
  native: boolean;
  contractAddress?: Address;
  usdValue: string;
};

type CatalogToken = {
  symbol?: string;
  name?: string;
  address?: string;
  decimals?: string | number | null;
  marketCap?: string | number | null;
  volume24h?: string | number | null;
};

type AlchemyTokenBalance = {
  contractAddress?: string;
  tokenBalance?: string | null;
  error?: string | null;
};

type BalanceTokenConfig = {
  symbol: string;
  name: string;
  decimals: number;
  logo: string;
  className: string;
  contractAddress: Address;
  native?: boolean;
  coingeckoId: string;
  aliasOf?: string;
};

const WORLD_CHAIN_ALCHEMY_RPC =
  process.env.WORLD_CHAIN_ALCHEMY_RPC_URL || "https://worldchain-mainnet.g.alchemy.com/public";
const BALANCE_TOKEN_CONFIG_TTL_MS = 300_000;
let cachedBalanceTokens: { expiresAt: number; data: BalanceTokenConfig[] } | null = null;
const LEGACY_BALANCE_TOKENS: BalanceTokenConfig[] = [
  {
    symbol: "ORB",
    name: "Orb",
    decimals: 18,
    logo: "O",
    className: "custom",
    contractAddress: "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db" as Address,
    coingeckoId: "orb",
    aliasOf: "ORB",
  },
];

function toBalance(token: BalanceTokenConfig | (typeof TOKENS)[number], balance: bigint): ChainBalance {
  const formatted = formatUnits(balance, token.decimals);

  return {
    symbol: token.symbol,
    name: token.name,
    balance,
    decimals: token.decimals,
    formatted,
    logo: token.logo,
    className: token.className,
    native: Boolean(token.native),
    contractAddress: token.contractAddress,
    usdValue: "",
  };
}

function toDiscoveredBalance(token: CatalogToken, balance: bigint): ChainBalance | null {
  if (!token.address || !token.symbol) return null;
  const decimals = Number.isInteger(Number(token.decimals)) ? Number(token.decimals) : 18;
  const symbol = String(token.symbol).slice(0, 16);
  const name = String(token.name || symbol).slice(0, 60);
  const formatted = formatUnits(balance, decimals);

  return {
    symbol,
    name,
    balance,
    decimals,
    formatted,
    logo: symbol.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?",
    className: "custom",
    native: false,
    contractAddress: token.address as Address,
    usdValue: "",
  };
}

async function fetchAlchemyTokenMetadata(contractAddress: string): Promise<CatalogToken | null> {
  const response = await fetch(WORLD_CHAIN_ALCHEMY_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "alchemy_getTokenMetadata",
      params: [contractAddress],
    }),
    signal: AbortSignal.timeout(2_500),
  }).catch(() => null);
  if (!response?.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    result?: { name?: string | null; symbol?: string | null; decimals?: number | null };
  } | null;
  const symbol = body?.result?.symbol?.trim();
  if (!symbol) return null;
  return {
    address: contractAddress,
    symbol,
    name: body?.result?.name?.trim() || symbol,
    decimals: body?.result?.decimals ?? 18,
  };
}

/**
 * Reads native ETH and configured ERC-20 balances from World Chain.
 */
export async function fetchBalances(userAddress: Address) {
  const ethToken = TOKENS.find((token) => token.native);
  const balanceTokens = await getBalanceTokens();
  const [nativeBalance, alchemyBalances] = await Promise.all([
    readWorldChainWithFallback((client) => client.getBalance({ address: userAddress })),
    fetchAllAlchemyTokenBalances(userAddress).catch(() => [] as AlchemyTokenBalance[]),
  ]);

  const configuredTokenBalances = alchemyBalances.length
    ? configuredTokenBalancesFromAlchemy(balanceTokens, alchemyBalances)
    : await fetchConfiguredTokenBalances(userAddress, balanceTokens);
  const discoveredBalances = await fetchDiscoveredTokenBalances(alchemyBalances).catch(() => [] as ChainBalance[]);
  const rawConfiguredBalances = balanceTokens.map((token) => toBalance(token, configuredTokenBalances.get(token.contractAddress) ?? 0n));
  const erc20Balances = mergeAliasBalances(rawConfiguredBalances);

  const configured = [
    ...erc20Balances,
    ...(ethToken ? [toBalance(ethToken, nativeBalance)] : []),
  ];
  const configuredAddresses = new Set(
    configured.map((item) => item.contractAddress?.toLowerCase()).filter(Boolean),
  );

  return [
    ...configured,
    ...discoveredBalances.filter((item) => {
      const address = item.contractAddress?.toLowerCase();
      return address && !configuredAddresses.has(address) && item.balance > 0n;
    }),
  ];
}

async function fetchConfiguredTokenBalances(userAddress: Address, balanceTokens: BalanceTokenConfig[]) {
  const erc20Results = await readWorldChainWithFallback((client) =>
    client.multicall({
      allowFailure: true,
      contracts: balanceTokens.map((token) => ({
        address: token.contractAddress,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [userAddress],
      })),
    }),
  );
  const balances = new Map<Address, bigint>();
  const retryTokens: BalanceTokenConfig[] = [];

  balanceTokens.forEach((token, index) => {
    const result = erc20Results[index];
    if (result?.status === "success") {
      balances.set(token.contractAddress, result.result);
    } else {
      retryTokens.push(token);
    }
  });

  await Promise.all(
    retryTokens.map(async (token) => {
      const balance = await readWorldChainWithFallback((client) =>
        client.readContract({
          address: token.contractAddress,
          abi: erc20BalanceAbi,
          functionName: "balanceOf",
          args: [userAddress],
        }),
      );
      balances.set(token.contractAddress, balance);
    }),
  );

  return balances;
}

async function getBalanceTokens(): Promise<BalanceTokenConfig[]> {
  if (cachedBalanceTokens && cachedBalanceTokens.expiresAt > Date.now()) return cachedBalanceTokens.data;
  const core = ERC20_TOKENS.map((token) => ({ ...token }));
  let configured: BalanceTokenConfig[] = [];
  try {
    const rows = await db.token.findMany({
      where: {
        status: "verified",
        contractAddr: { not: null },
      },
      orderBy: { createdAt: "asc" },
    });
    configured = rows
      .filter((row) => row.canTransfer !== false || row.canSwap !== false)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        logo: row.symbol.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?",
        className: "custom",
        contractAddress: row.contractAddr as Address,
        coingeckoId: row.symbol.toLowerCase(),
      }));
  } catch (error) {
    console.error("Failed to load configured balance tokens", error);
  }

  const seen = new Set<string>();
  const data = [...core, ...configured, ...LEGACY_BALANCE_TOKENS].filter((token): token is BalanceTokenConfig => {
    const address = token.contractAddress?.toLowerCase();
    if (!address || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
  cachedBalanceTokens = { data, expiresAt: Date.now() + BALANCE_TOKEN_CONFIG_TTL_MS };
  return data;
}

function configuredTokenBalancesFromAlchemy(balanceTokens: BalanceTokenConfig[], balances: AlchemyTokenBalance[]) {
  const byAddress = new Map(
    balances
      .filter((item) => item.contractAddress && item.tokenBalance && !item.error)
      .map((item) => [item.contractAddress!.toLowerCase(), parseAlchemyBalance(item.tokenBalance!)]),
  );
  return new Map(
    balanceTokens.map((token) => [
      token.contractAddress,
      byAddress.get(token.contractAddress.toLowerCase()) ?? 0n,
    ]),
  );
}

async function fetchDiscoveredTokenBalances(knownBalances: AlchemyTokenBalance[]) {
  const balances = knownBalances;
  const catalog = worldChainTokenCatalog as CatalogToken[];
  const catalogByAddress = new Map(
    catalog
      .filter((token) => token.address)
      .map((token) => [String(token.address).toLowerCase(), token]),
  );

  const positiveBalances = balances
    .map((item) => {
      if (!item.contractAddress || !item.tokenBalance || item.error) return null;
      const balance = parseAlchemyBalance(item.tokenBalance);
      if (balance <= 0n) return null;
      return { contractAddress: item.contractAddress, balance };
    })
    .filter((item): item is { contractAddress: string; balance: bigint } => Boolean(item));

  const discovered = await Promise.all(
    positiveBalances.map(async (item) => {
      const token =
        catalogByAddress.get(item.contractAddress.toLowerCase()) ??
        (await fetchAlchemyTokenMetadata(item.contractAddress));
      if (!token) return null;
      return toDiscoveredBalance(token, item.balance);
    }),
  );

  return discovered.filter((item): item is ChainBalance => Boolean(item));
}

async function fetchAllAlchemyTokenBalances(userAddress: Address) {
  const out = await fetchAlchemyTokenBalancePages([userAddress, "erc20"]);
  if (out.length) return out;
  return fetchAlchemyTokenBalancePages([userAddress]);
}

async function fetchAlchemyTokenBalancePages(baseParams: unknown[]) {
  const out: AlchemyTokenBalance[] = [];
  let pageKey: string | undefined;

  for (let page = 0; page < 8; page += 1) {
    const params = [...baseParams];
    if (pageKey) params.push({ pageKey });
    const response = await fetch(WORLD_CHAIN_ALCHEMY_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: page + 1,
        jsonrpc: "2.0",
        method: "alchemy_getTokenBalances",
        params,
      }),
      signal: AbortSignal.timeout(4_500),
    });
    if (!response.ok) break;

    const body = (await response.json()) as {
      result?: { tokenBalances?: AlchemyTokenBalance[]; pageKey?: string };
    };
    out.push(...(body.result?.tokenBalances ?? []));
    pageKey = body.result?.pageKey;
    if (!pageKey) break;
  }

  return out;
}

function mergeAliasBalances(items: ChainBalance[]) {
  const byKey = new Map<string, ChainBalance>();
  for (const item of items) {
    const token = [...ERC20_TOKENS, ...LEGACY_BALANCE_TOKENS].find(
      (candidate) => candidate.contractAddress?.toLowerCase() === item.contractAddress?.toLowerCase(),
    ) as (BalanceTokenConfig | (typeof ERC20_TOKENS)[number]) | undefined;
    const key = String((token && "aliasOf" in token ? token.aliasOf : null) || item.symbol).toUpperCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item, symbol: key });
      continue;
    }
    existing.balance += item.balance;
    existing.formatted = formatUnits(existing.balance, existing.decimals);
  }
  return Array.from(byKey.values());
}

function parseAlchemyBalance(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
