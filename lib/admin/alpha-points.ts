import { isAddress, type Address } from "viem";
import { getStoredActivitiesForAddress } from "@/lib/admin/activity-store";
import { ALPHA_BALANCE_TIERS, ALPHA_BOX_COST, ALPHA_MIN_SCORE_TO_OPEN_BOX, ALPHA_RECENT_SWAP_DAYS, ALPHA_SWAP_DAILY_CAP_POINTS, ALPHA_SWAP_USD_PER_POINT, ALPHA_WINDOW_DAYS } from "@/lib/admin/alpha-config";
import { addPointsAdjustment, getPointsAdjustments, getPointsAdjustmentTotal, type PointsAdjustmentConfig } from "@/lib/admin/points-products";
import { fetchBalances } from "@/lib/balances";
import { COINGECKO_IDS } from "@/lib/tokens/coingecko-ids";

const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const PRICE_CACHE_TTL_MS = 30_000;
const STABLE_PRICES: Record<string, number> = { USDC: 1, USDT: 1, DAI: 1, USDCE: 1, EURC: 1.08 };
let priceCache: { expiresAt: number; data: Record<string, number> } | null = null;

type AlphaKind = "balance" | "swap";

type AlphaBreakdown = {
  balanceScore: number;
  swapScore: number;
  recentSwapOk: boolean;
  portfolioUsd: number;
  swapUsdWindow: number;
  swapUsdToday: number;
  lastSyncedAt: string;
};

export type AlphaPointsProfile = AlphaBreakdown & {
  enabled: boolean;
  score: number;
  windowDays: number;
  minScoreToOpenBox: number;
  boxCost: number;
  recentSwapDays: number;
  eligibleForBox: boolean;
  spendablePoints: number;
  nextScoreNeeded: number;
};

function utc8DayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function startOfUtc8Day(dayKey: string) {
  return new Date(`${dayKey}T00:00:00+08:00`);
}

function daysAgoStart(days: number) {
  const now = new Date();
  const utc8 = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  utc8.setDate(utc8.getDate() - Math.max(0, days - 1));
  return startOfUtc8Day(utc8DayKey(utc8));
}

function alphaKey(kind: AlphaKind, dayKey: string) {
  return `alpha:${kind}:${dayKey}`;
}

function isAlphaRow(row: PointsAdjustmentConfig, kind?: AlphaKind) {
  const prefix = kind ? `alpha:${kind}:` : "alpha:";
  return String(row.createdBy || "").startsWith(prefix);
}

function rowTime(row: PointsAdjustmentConfig) {
  const time = new Date(row.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function positivePoints(row: PointsAdjustmentConfig) {
  return Math.max(0, Math.floor(Number(row.points || 0)));
}

async function fetchCorePrices() {
  if (priceCache && priceCache.expiresAt > Date.now()) return priceCache.data;
  const ids = [COINGECKO_IDS.WLD, COINGECKO_IDS.ETH, COINGECKO_IDS.BTC].filter(Boolean).join(",");
  const data: Record<string, number> = { ...STABLE_PRICES };
  try {
    const response = await fetch(`${COINGECKO_SIMPLE_PRICE_URL}?ids=${ids}&vs_currencies=usd`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1800),
    });
    if (response.ok) {
      const raw = (await response.json().catch(() => ({}))) as Record<string, { usd?: number }>;
      data.WLD = finitePrice(raw[COINGECKO_IDS.WLD]?.usd);
      data.ETH = finitePrice(raw[COINGECKO_IDS.ETH]?.usd);
      data.WETH = data.ETH;
      data.BTC = finitePrice(raw[COINGECKO_IDS.BTC]?.usd);
      data.WBTC = data.BTC;
    }
  } catch {
    // Alpha balance scoring can safely fall back to stablecoin-only pricing.
  }
  priceCache = { data, expiresAt: Date.now() + PRICE_CACHE_TTL_MS };
  return data;
}

function finitePrice(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function balanceTierPoints(portfolioUsd: number) {
  const tier = ALPHA_BALANCE_TIERS.find((item) => portfolioUsd >= item.minUsd);
  return tier ? tier.points : 0;
}

async function estimatePortfolioUsd(address: string) {
  const [balances, prices] = await Promise.all([
    fetchBalances(address as Address).catch(() => []),
    fetchCorePrices(),
  ]);
  return balances.reduce((sum, item) => {
    const amount = Number(item.formatted || 0);
    const price = finitePrice(prices[String(item.symbol || "").toUpperCase()]);
    if (!Number.isFinite(amount) || amount <= 0 || price <= 0) return sum;
    return sum + amount * price;
  }, 0);
}

function activityTime(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function activityAmountUsd(activity: Awaited<ReturnType<typeof getStoredActivitiesForAddress>>[number]) {
  const metadata = activity.metadata && typeof activity.metadata === "object" ? activity.metadata as Record<string, unknown> : {};
  const amountUsd = finitePrice(metadata.amountUsd ?? metadata.usdValue ?? metadata.usd);
  if (amountUsd > 0) return amountUsd;
  const text = String(activity.amount || "");
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s+(USDC|USDT|USDCE|DAI)\b/i);
  return match ? finitePrice(match[1]) : 0;
}

async function syncAlphaBalance(address: string) {
  const dayKey = utc8DayKey();
  const key = alphaKey("balance", dayKey);
  const portfolioUsd = await estimatePortfolioUsd(address);
  const points = balanceTierPoints(portfolioUsd);
  if (points <= 0) return { portfolioUsd, row: null };
  const latest = await getPointsAdjustments(address);
  const awarded = latest
    .filter((row) => String(row.createdBy || "").startsWith(key))
    .reduce((sum, row) => sum + positivePoints(row), 0);
  const delta = points - awarded;
  if (delta <= 0) return { portfolioUsd, row: null };
  const deltaKey = `${key}:${points}`;
  if (latest.some((row) => row.createdBy === deltaKey)) return { portfolioUsd, row: null };
  const row = await addPointsAdjustment({
    address,
    points: delta,
    note: `Alpha balance score ($${portfolioUsd.toFixed(2)})`,
    createdBy: deltaKey,
  });
  return { portfolioUsd, row };
}

async function syncAlphaSwap(address: string) {
  const dayKey = utc8DayKey();
  const key = alphaKey("swap", dayKey);
  const todayStart = startOfUtc8Day(dayKey).getTime();
  const activities = await getStoredActivitiesForAddress(address, 300).catch(() => []);
  const todayUsd = activities
    .filter((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= todayStart)
    .reduce((sum, item) => sum + activityAmountUsd(item), 0);
  const points = Math.min(ALPHA_SWAP_DAILY_CAP_POINTS, Math.floor(todayUsd / ALPHA_SWAP_USD_PER_POINT));
  if (points <= 0) return { todayUsd, row: null };
  const latest = await getPointsAdjustments(address);
  const awarded = latest
    .filter((row) => String(row.createdBy || "").startsWith(key))
    .reduce((sum, row) => sum + positivePoints(row), 0);
  const delta = points - awarded;
  if (delta <= 0) return { todayUsd, row: null };
  const deltaKey = `${key}:${points}`;
  if (latest.some((row) => row.createdBy === deltaKey)) return { todayUsd, row: null };
  const row = await addPointsAdjustment({
    address,
    points: delta,
    note: `Alpha swap score ($${todayUsd.toFixed(2)})`,
    createdBy: deltaKey,
  });
  return { todayUsd, row };
}

async function alphaBreakdown(address: string, portfolioUsd = 0, swapUsdToday = 0): Promise<AlphaBreakdown> {
  const windowStart = daysAgoStart(ALPHA_WINDOW_DAYS).getTime();
  const recentSwapStart = daysAgoStart(ALPHA_RECENT_SWAP_DAYS).getTime();
  const [adjustments, activities] = await Promise.all([
    getPointsAdjustments(address),
    getStoredActivitiesForAddress(address, 300).catch(() => []),
  ]);
  const rows = adjustments.filter((row) => isAlphaRow(row) && rowTime(row) >= windowStart);
  const balanceScore = rows.filter((row) => isAlphaRow(row, "balance")).reduce((sum, row) => sum + positivePoints(row), 0);
  const swapScore = rows.filter((row) => isAlphaRow(row, "swap")).reduce((sum, row) => sum + positivePoints(row), 0);
  const recentSwapOk = rows.some((row) => isAlphaRow(row, "swap") && rowTime(row) >= recentSwapStart) ||
    activities.some((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= recentSwapStart);
  const swapUsdWindow = activities
    .filter((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= windowStart)
    .reduce((sum, item) => sum + activityAmountUsd(item), 0);
  const latestAlpha = rows.reduce((latest, row) => Math.max(latest, rowTime(row)), 0);
  return {
    balanceScore,
    swapScore,
    recentSwapOk,
    portfolioUsd,
    swapUsdWindow,
    swapUsdToday,
    lastSyncedAt: latestAlpha ? new Date(latestAlpha).toISOString() : new Date().toISOString(),
  };
}

export async function getAlphaPointsProfile(addressInput: string): Promise<AlphaPointsProfile> {
  const address = String(addressInput || "").toLowerCase();
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  const balanceSync = await syncAlphaBalance(address);
  const swapSync = await syncAlphaSwap(address);
  const breakdown = await alphaBreakdown(address, balanceSync?.portfolioUsd ?? 0, swapSync?.todayUsd ?? 0);
  const spendablePoints = await getPointsAdjustmentTotal(address);
  const score = breakdown.balanceScore + breakdown.swapScore;
  return {
    enabled: true,
    ...breakdown,
    score,
    windowDays: ALPHA_WINDOW_DAYS,
    minScoreToOpenBox: ALPHA_MIN_SCORE_TO_OPEN_BOX,
    boxCost: ALPHA_BOX_COST,
    recentSwapDays: ALPHA_RECENT_SWAP_DAYS,
    eligibleForBox: score >= ALPHA_MIN_SCORE_TO_OPEN_BOX && breakdown.recentSwapOk,
    spendablePoints,
    nextScoreNeeded: Math.max(0, ALPHA_MIN_SCORE_TO_OPEN_BOX - score),
  };
}

export async function assertAlphaBlindBoxEligibility(address: string) {
  const profile = await getAlphaPointsProfile(address);
  if (profile.score < ALPHA_MIN_SCORE_TO_OPEN_BOX) {
    throw new Error(`Alpha Score ${ALPHA_MIN_SCORE_TO_OPEN_BOX} required. Need ${profile.nextScoreNeeded} more.`);
  }
  if (!profile.recentSwapOk) {
    throw new Error(`Complete one swap in the last ${ALPHA_RECENT_SWAP_DAYS} days to open a mystery box.`);
  }
  if (profile.spendablePoints < ALPHA_BOX_COST) {
    throw new Error(`Need ${ALPHA_BOX_COST} Lumina Points to open this mystery box.`);
  }
  return profile;
}
