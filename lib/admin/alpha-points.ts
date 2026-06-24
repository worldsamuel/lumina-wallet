import { isAddress, type Address } from "viem";
import { getStoredActivitiesForAddress } from "@/lib/admin/activity-store";
import { DEFAULT_ALPHA_RULES, normalizeAlphaRules, type AlphaRulesConfig } from "@/lib/admin/alpha-config";
import { addPointsAdjustment, getPointsAdjustments, getPointsAdjustmentTotal, type PointsAdjustmentConfig } from "@/lib/admin/points-products";
import { getSystemConfig } from "@/lib/admin/system-config";
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
  spentScore: number;
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

function isAlphaSpendRow(row: PointsAdjustmentConfig) {
  return String(row.createdBy || "").startsWith("alpha:spend:");
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

async function loadAlphaRules() {
  const config = await getSystemConfig().catch(() => null);
  return normalizeAlphaRules(config?.alphaRules || DEFAULT_ALPHA_RULES);
}

function balanceTierPoints(portfolioUsd: number, rules: AlphaRulesConfig) {
  const tier = rules.balanceTiers.find((item) => portfolioUsd >= item.minUsd);
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
    const existingUsd = finitePrice(item.usdValue);
    if (existingUsd > 0) return sum + existingUsd;
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

async function syncAlphaBalance(address: string, rules: AlphaRulesConfig) {
  const dayKey = utc8DayKey();
  const key = alphaKey("balance", dayKey);
  const portfolioUsd = await estimatePortfolioUsd(address);
  const points = rules.enabled ? balanceTierPoints(portfolioUsd, rules) : 0;
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

async function syncAlphaSwap(address: string, rules: AlphaRulesConfig) {
  const dayKey = utc8DayKey();
  const key = alphaKey("swap", dayKey);
  const todayStart = startOfUtc8Day(dayKey).getTime();
  const activities = await getStoredActivitiesForAddress(address, 300).catch(() => []);
  const todayUsd = activities
    .filter((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= todayStart)
    .reduce((sum, item) => sum + activityAmountUsd(item), 0);
  const todaySwapCount = activities.filter((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= todayStart).length;
  const volumePoints = rules.swapUsdPerPoint > 0 ? Math.floor(todayUsd / rules.swapUsdPerPoint) : 0;
  const minPoints = todaySwapCount > 0 ? Math.max(0, Math.floor(Number(rules.swapMinPoints || 0))) : 0;
  const points = rules.enabled ? Math.min(rules.swapDailyCapPoints, Math.max(volumePoints, minPoints)) : 0;
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

async function alphaBreakdown(address: string, rules: AlphaRulesConfig, portfolioUsd = 0, swapUsdToday = 0): Promise<AlphaBreakdown> {
  const windowStart = daysAgoStart(rules.windowDays).getTime();
  const recentSwapStart = daysAgoStart(rules.recentSwapDays).getTime();
  const [adjustments, activities] = await Promise.all([
    getPointsAdjustments(address),
    getStoredActivitiesForAddress(address, 300).catch(() => []),
  ]);
  const rows = adjustments.filter((row) => isAlphaRow(row) && rowTime(row) >= windowStart);
  const balanceScore = rows.filter((row) => isAlphaRow(row, "balance")).reduce((sum, row) => sum + positivePoints(row), 0);
  const swapScore = rows.filter((row) => isAlphaRow(row, "swap")).reduce((sum, row) => sum + positivePoints(row), 0);
  const spentScore = rows.filter(isAlphaSpendRow).reduce((sum, row) => sum + Math.abs(Math.min(0, Math.floor(Number(row.points || 0)))), 0);
  const recentSwapOk = rows.some((row) => isAlphaRow(row, "swap") && rowTime(row) >= recentSwapStart) ||
    activities.some((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= recentSwapStart);
  const swapUsdWindow = activities
    .filter((item) => String(item.type || "").toLowerCase() === "swap" && activityTime(item.createdAt) >= windowStart)
    .reduce((sum, item) => sum + activityAmountUsd(item), 0);
  const latestAlpha = rows.reduce((latest, row) => Math.max(latest, rowTime(row)), 0);
  return {
    balanceScore,
    swapScore,
    spentScore,
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
  const rules = await loadAlphaRules();
  const balanceSync = await syncAlphaBalance(address, rules);
  const swapSync = await syncAlphaSwap(address, rules);
  const breakdown = await alphaBreakdown(address, rules, balanceSync?.portfolioUsd ?? 0, swapSync?.todayUsd ?? 0);
  const spendablePoints = await getPointsAdjustmentTotal(address);
  const score = Math.max(0, breakdown.balanceScore + breakdown.swapScore - breakdown.spentScore);
  return {
    enabled: rules.enabled,
    ...breakdown,
    score,
    windowDays: rules.windowDays,
    minScoreToOpenBox: rules.minScoreToOpenBox,
    boxCost: rules.boxCost,
    recentSwapDays: rules.recentSwapDays,
    eligibleForBox: rules.enabled && score >= rules.minScoreToOpenBox && breakdown.recentSwapOk,
    spendablePoints,
    nextScoreNeeded: Math.max(0, rules.minScoreToOpenBox - score),
  };
}

export async function assertAlphaBlindBoxEligibility(address: string) {
  const profile = await getAlphaPointsProfile(address);
  if (!profile.enabled) {
    throw new Error("Alpha Score is currently disabled.");
  }
  if (profile.score < profile.minScoreToOpenBox) {
    throw new Error(`Alpha Score ${profile.minScoreToOpenBox} required. Need ${profile.nextScoreNeeded} more.`);
  }
  if (!profile.recentSwapOk) {
    throw new Error(`Complete one swap in the last ${profile.recentSwapDays} days to open a mystery box.`);
  }
  return profile;
}

export async function spendAlphaBlindBoxPoints(input: { address: string; orderId: string; productTitle?: string | null }) {
  const address = String(input.address || "").toLowerCase();
  if (!isAddress(address)) throw new Error("Invalid wallet address.");
  const orderId = String(input.orderId || "").trim();
  if (!orderId) throw new Error("Invalid Alpha order id.");
  const uniqueKey = `alpha:spend:${orderId}`;
  const existing = await getPointsAdjustments(address);
  const spent = existing.find((row) => row.createdBy === uniqueKey);
  if (spent) return { row: spent, points: Math.abs(spent.points), skipped: true };
  const profile = await assertAlphaBlindBoxEligibility(address);
  const row = await addPointsAdjustment({
    address,
    points: -profile.boxCost,
    note: `Open Alpha box${input.productTitle ? `: ${input.productTitle}` : ""}`,
    createdBy: uniqueKey,
  });
  return { row, points: profile.boxCost, skipped: false };
}
