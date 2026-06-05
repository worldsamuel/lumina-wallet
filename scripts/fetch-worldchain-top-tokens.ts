import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createPublicClient, encodePacked, getAddress, http, isAddress, parseAbi, parseUnits, type Address } from "viem";

const GECKO_POOLS_URL = "https://api.geckoterminal.com/api/v2/networks/world-chain/pools";
const WORLD_CHAIN_RPC = "https://worldchain-mainnet.g.alchemy.com/public";
const QUOTER_ADDRESS = "0x10158D43e6cc414deE1Bd1eB0EfC6a5cBCfF244c" as Address;
const USDC_ADDRESS = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as Address;
const WLD_ADDRESS = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PAGE_COUNT = 5;
const PAGE_SLEEP_MS = 7_000;
const TARGET_WHITELIST_SIZE = 50;
const MIN_LIQUIDITY_USD = 50;
const MIN_VOLUME_24H_USD = 5;

const OFFICIAL_TOKENS: Record<string, string> = {
  "0x2cfc85d8e48f8eab294be644d9e25c3030863003": "Worldcoin official",
  "0x79a02482a880bce3f13e09da970dc34db4cd24d1": "Circle official USDC",
  "0x4200000000000000000000000000000000000006": "World Chain WETH",
  "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3": "Wrapped Bitcoin",
  "0x102d758f688a4c1c5a80b116bd945d4455460282": "Stargate bridged USDT0",
  "0x1c60ba0a0ed1019e8eb035e6daf4155a5ce2380b": "Circle EURC",
};

const client = createPublicClient({
  chain: {
    id: 480,
    name: "World Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [WORLD_CHAIN_RPC] } },
  },
  transport: http(WORLD_CHAIN_RPC),
});

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
]);

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

type GeckoToken = {
  id: string;
  type: string;
  attributes?: {
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number | string;
    image_url?: string;
  };
};

type CandidateToken = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  priceUsd: number;
  volume24h: number;
  liquidityUsd: number;
  priceChange24h: number;
  poolCount: number;
  pools: Set<string>;
};

type SafetyResult = {
  hasMetadata: boolean;
  decimalsValid: boolean;
  hasOwner: boolean;
  isPausable: boolean;
  hasLiquidity: boolean;
  passedHoneypot: boolean;
  ageInDays: number;
  blocked: boolean;
  reason: string | null;
  sellbackRatio: number | null;
  warningHighSlippage: boolean;
  metadata?: { name: string; symbol: string; decimals: number; totalSupply: string };
};

type AuditRow = CandidateToken & {
  safety: SafetyResult;
  score: number;
  decision: "recommended" | "warning" | "rejected";
  note: string;
};

async function main() {
  const candidates = await fetchCandidates();
  const sortedCandidates = Array.from(candidates.values()).sort((a, b) => b.volume24h - a.volume24h);
  const auditRows: AuditRow[] = [];

  console.log(`Auditing ${sortedCandidates.length} merged tokens...`);
  for (let i = 0; i < sortedCandidates.length; i += 1) {
    const token = sortedCandidates[i];
    process.stdout.write(`[${i + 1}/${sortedCandidates.length}] ${token.symbol} ${token.address} ... `);
    const safety = await safetyCheck(token);
    const score = scoreToken(token, safety);
    const decision = decideToken(token, safety);
    const note = noteFor(token, safety);
    auditRows.push({ ...token, safety, score, decision, note });
    console.log(decision, safety.reason ? `(${safety.reason})` : "");
  }

  const approved = auditRows
    .filter((row) => row.decision !== "rejected")
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_WHITELIST_SIZE);
  const recommended = approved.filter((row) => row.decision === "recommended").slice(0, 25);
  const warning = approved.filter((row) => row.decision === "warning");
  const rejected = auditRows.filter((row) => row.decision === "rejected");

  writeReport(auditRows, recommended, warning, rejected);
  writePermit2Paste(approved);
  writeSwappableConfig(approved);

  console.log("\nDone:");
  console.log("- scripts/world-chain-token-audit.md");
  console.log("- scripts/permit2-tokens-paste.txt");
  console.log("- scripts/swappable-tokens-config.ts");
}

async function fetchCandidates() {
  const tokenMap = new Map<string, CandidateToken>();

  for (let page = 1; page <= PAGE_COUNT; page += 1) {
    console.log(`Fetching GeckoTerminal pools page ${page}/${PAGE_COUNT}...`);
    const url = `${GECKO_POOLS_URL}?page=${page}&sort=h24_volume_usd_desc&include=base_token,quote_token`;
    const payload = await fetchJsonWithRetry(url, page);
    const included = new Map<string, GeckoToken>(
      (Array.isArray(payload.included) ? payload.included : [])
        .filter((item: GeckoToken) => item.type === "token")
        .map((item: GeckoToken) => [item.id, item]),
    );

    for (const pool of Array.isArray(payload.data) ? payload.data : []) {
      const attrs = pool.attributes ?? {};
      const volume = numberValue(attrs.volume_usd?.h24);
      const liquidity = numberValue(attrs.reserve_in_usd);
      const priceChange24h = numberValue(attrs.price_change_percentage?.h24);
      const poolId = String(pool.id || attrs.address || "");
      const tokenIds = [
        pool.relationships?.base_token?.data?.id,
        pool.relationships?.quote_token?.data?.id,
      ].filter(Boolean);

      for (const tokenId of tokenIds) {
        const token = included.get(tokenId);
        const address = safeAddress(token?.attributes?.address);
        if (!address) continue;
        const key = address.toLowerCase();
        const existing = tokenMap.get(key);
        if (existing) {
          existing.volume24h += volume;
          existing.liquidityUsd += liquidity;
          existing.poolCount += 1;
          if (poolId) existing.pools.add(poolId);
          continue;
        }

        tokenMap.set(key, {
          address,
          symbol: cleanSymbol(token?.attributes?.symbol || "TOKEN"),
          name: cleanName(token?.attributes?.name || token?.attributes?.symbol || "Token"),
          decimals: normalizeDecimals(token?.attributes?.decimals),
          logoUrl: token?.attributes?.image_url || null,
          priceUsd: numberValue(attrs.base_token_price_usd) || numberValue(attrs.quote_token_price_usd),
          volume24h: volume,
          liquidityUsd: liquidity,
          priceChange24h,
          poolCount: 1,
          pools: new Set(poolId ? [poolId] : []),
        });
      }
    }

    if (page < PAGE_COUNT) await sleep(PAGE_SLEEP_MS);
  }

  return tokenMap;
}

async function safetyCheck(token: CandidateToken): Promise<SafetyResult> {
  const checks: SafetyResult = {
    hasMetadata: false,
    decimalsValid: false,
    hasOwner: false,
    isPausable: false,
    hasLiquidity: token.liquidityUsd >= MIN_LIQUIDITY_USD,
    passedHoneypot: false,
    ageInDays: 0,
    blocked: false,
    reason: null,
    sellbackRatio: null,
    warningHighSlippage: false,
  };

  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: token.address, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address: token.address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token.address, abi: erc20Abi, functionName: "totalSupply" }),
    ]);
    checks.hasMetadata = Boolean(name && symbol);
    checks.decimalsValid = Number(decimals) >= 0 && Number(decimals) <= 18;
    checks.metadata = { name, symbol, decimals: Number(decimals), totalSupply: totalSupply.toString() };
    token.name = cleanName(name || token.name);
    token.symbol = cleanSymbol(symbol || token.symbol);
    token.decimals = Number(decimals);
  } catch {
    return { ...checks, blocked: true, reason: "no_metadata" };
  }

  if (!checks.decimalsValid) return { ...checks, blocked: true, reason: "invalid_decimals" };
  if (token.liquidityUsd < MIN_LIQUIDITY_USD) return { ...checks, blocked: true, reason: "low_liquidity" };
  if (token.volume24h < MIN_VOLUME_24H_USD) return { ...checks, blocked: true, reason: "low_volume" };

  try {
    const owner = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "owner" });
    checks.hasOwner = String(owner).toLowerCase() !== ZERO_ADDRESS;
  } catch {
    checks.hasOwner = false;
  }

  try {
    await client.readContract({ address: token.address, abi: erc20Abi, functionName: "paused" });
    checks.isPausable = true;
  } catch {
    checks.isPausable = false;
  }

  const officialNote = OFFICIAL_TOKENS[token.address.toLowerCase()];
  if (officialNote && token.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
    return { ...checks, passedHoneypot: true, sellbackRatio: 1 };
  }

  try {
    const buyAmount = await simulateQuote(USDC_ADDRESS, token.address, parseUnits("1", 6));
    if (!buyAmount) return { ...checks, blocked: true, reason: "no_pool" };

    const sellAmount = await simulateQuote(token.address, USDC_ADDRESS, buyAmount);
    if (!sellAmount) return { ...checks, blocked: true, reason: "cannot_sell" };

    const sellbackRatio = Number(sellAmount) / 1_000_000;
    if (sellbackRatio < 0.5) {
      return { ...checks, blocked: true, reason: "honeypot_or_high_tax", sellbackRatio };
    }

    checks.sellbackRatio = sellbackRatio;
    checks.passedHoneypot = sellbackRatio >= 0.9;
    checks.warningHighSlippage = sellbackRatio < 0.9;
  } catch {
    return { ...checks, blocked: true, reason: "honeypot_check_failed" };
  }

  return checks;
}

async function simulateQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return amountIn;
  const fees = [500, 3000, 10000] as const;
  let bestQuote = 0n;

  for (const fee of fees) {
    try {
      const result = await client.readContract({
        address: QUOTER_ADDRESS,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      if (result[0] > bestQuote) bestQuote = result[0];
    } catch {
      // Try the next fee tier.
    }
  }

  if (
    bestQuote === 0n &&
    tokenIn.toLowerCase() !== WLD_ADDRESS.toLowerCase() &&
    tokenOut.toLowerCase() !== WLD_ADDRESS.toLowerCase()
  ) {
    for (const firstFee of fees) {
      for (const secondFee of fees) {
        try {
          const path = encodePacked(
            ["address", "uint24", "address", "uint24", "address"],
            [tokenIn, firstFee, WLD_ADDRESS, secondFee, tokenOut],
          );
          const result = await client.readContract({
            address: QUOTER_ADDRESS,
            abi: quoterAbi,
            functionName: "quoteExactInput",
            args: [path, amountIn],
          });
          if (result[0] > bestQuote) bestQuote = result[0];
        } catch {
          // Try the next fee path.
        }
      }
    }
  }

  return bestQuote;
}

function decideToken(token: CandidateToken, safety: SafetyResult): AuditRow["decision"] {
  if (safety.blocked) return "rejected";
  if (!safety.hasMetadata || !safety.decimalsValid || !safety.hasLiquidity) return "rejected";
  if (safety.warningHighSlippage || safety.hasOwner || safety.isPausable || !safety.passedHoneypot) return "warning";
  if (token.liquidityUsd < 5_000) return "warning";
  return "recommended";
}

function scoreToken(token: CandidateToken, safety: SafetyResult) {
  const liquidityScore = Math.log(Math.max(1, token.liquidityUsd));
  const volumeScore = Math.log(Math.max(1, token.volume24h));
  const poolCountScore = token.poolCount * 2;
  const noOwnerBonus = safety.hasOwner ? 0 : 10;
  const noPausableBonus = safety.isPausable ? -5 : 0;
  const sellbackBonus = safety.sellbackRatio === null ? 0 : Math.min(10, safety.sellbackRatio * 10);
  const officialBonus = OFFICIAL_TOKENS[token.address.toLowerCase()] ? 20 : 0;
  return liquidityScore + volumeScore + poolCountScore + noOwnerBonus + noPausableBonus + sellbackBonus + officialBonus;
}

function noteFor(token: CandidateToken, safety: SafetyResult) {
  const official = OFFICIAL_TOKENS[token.address.toLowerCase()];
  if (official) return `✓ ${official}`;
  if (safety.reason) return safety.reason;
  const notes: string[] = [];
  if (safety.sellbackRatio !== null) notes.push(`sellback ${safety.sellbackRatio.toFixed(2)}`);
  if (safety.hasOwner) notes.push("owner");
  if (safety.isPausable) notes.push("pausable");
  if (!notes.length) notes.push("passed");
  return notes.join(", ");
}

function writeReport(rows: AuditRow[], recommended: AuditRow[], warning: AuditRow[], rejected: AuditRow[]) {
  const passedCount = rows.filter((row) => row.decision !== "rejected").length;
  const lines = [
    "# World Chain Token 安全审核报告",
    "",
    `生成时间: ${new Date().toISOString().slice(0, 10)}`,
    `候选 token 总数: ${rows.length}`,
    `通过审核: ${passedCount}`,
    `拒绝: ${rejected.length}`,
    "",
    "## ✅ 推荐加入白名单 (Top 25)",
    "",
    "| # | Symbol | Name | Address | Liquidity | Volume24h | Pools | 备注 |",
    "|---|--------|------|---------|-----------|-----------|-------|------|",
    ...recommended.map((row, index) =>
      `| ${index + 1} | ${escapeMd(row.symbol)} | ${escapeMd(row.name)} | ${shortAddress(row.address)} | ${usd(row.liquidityUsd)} | ${usd(row.volume24h)} | ${row.poolCount} | ${escapeMd(row.note)} |`,
    ),
    "",
    "## ⚠️ 警告但可加 (有风险标记)",
    "",
    "| Symbol | 警告 | 是否加 |",
    "|--------|------|--------|",
    ...warning.map((row) =>
      `| ${escapeMd(row.symbol)} | ${escapeMd(row.note)} | 加,UI 提示 |`,
    ),
    "",
    "## ❌ 拒绝",
    "",
    "| Symbol | 原因 |",
    "|--------|------|",
    ...rejected.map((row) => `| ${escapeMd(row.symbol)} | ${escapeMd(row.note)} |`),
    "",
  ];
  fs.writeFileSync(path.join("scripts", "world-chain-token-audit.md"), lines.join("\n"));
}

function writePermit2Paste(tokens: AuditRow[]) {
  fs.writeFileSync(
    path.join("scripts", "permit2-tokens-paste.txt"),
    tokens.map((token) => token.address).join(","),
  );
}

function writeSwappableConfig(tokens: AuditRow[]) {
  const lines = [
    "export const SWAPPABLE_TOKENS = [",
    ...tokens.map((token) => {
      const fields = [
        `address: "${token.address}"`,
        `symbol: "${escapeTs(token.symbol)}"`,
        `name: "${escapeTs(token.name)}"`,
        `decimals: ${token.decimals}`,
        `logoUrl: ${token.logoUrl ? `"${escapeTs(token.logoUrl)}"` : "null"}`,
      ];
      return `  { ${fields.join(", ")} },`;
    }),
    "] as const;",
    "",
  ];
  fs.writeFileSync(path.join("scripts", "swappable-tokens-config.ts"), lines.join("\n"));
}

function safeAddress(value: unknown): Address | null {
  const text = String(value ?? "");
  if (!isAddress(text)) return null;
  return getAddress(text);
}

function normalizeDecimals(value: unknown) {
  const decimals = Number(value);
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 18;
}

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cleanSymbol(value: string) {
  return String(value || "TOKEN").trim().replace(/\s+/g, "").slice(0, 24) || "TOKEN";
}

function cleanName(value: string) {
  return String(value || "Token").trim().replace(/\s+/g, " ").slice(0, 80) || "Token";
}

function shortAddress(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function usd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function escapeMd(value: string) {
  return String(value).replace(/\|/g, "\\|");
}

function escapeTs(value: string) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url: string, page: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`GeckoTerminal page ${page} responded ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(2_000 * attempt);
    }
  }
  try {
    const source = [
      "import json, sys, urllib.request",
      "url = sys.argv[1]",
      "req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'})",
      "with urllib.request.urlopen(req, timeout=30) as r:",
      "    sys.stdout.write(r.read().decode())",
    ].join("\n");
    const output = execFileSync("python3", ["-c", source, url], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(output);
  } catch (fallbackError) {
    throw lastError instanceof Error
      ? lastError
      : fallbackError instanceof Error
        ? fallbackError
        : new Error(`Failed to fetch GeckoTerminal page ${page}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
