export const ALPHA_WINDOW_DAYS = 15;
export const ALPHA_BOX_COST = 15;
export const ALPHA_MIN_SCORE_TO_OPEN_BOX = 30;
export const ALPHA_RECENT_SWAP_DAYS = 7;
export const ALPHA_BOX_DEFAULT_STOCK = 10000;
export const ALPHA_SWAP_USD_PER_POINT = 10;
export const ALPHA_SWAP_DAILY_CAP_POINTS = 20;
export const ALPHA_SWAP_MIN_POINTS = 1;

export const ALPHA_BALANCE_TIERS = [
  { minUsd: 1000, points: 10 },
  { minUsd: 200, points: 6 },
  { minUsd: 50, points: 3 },
  { minUsd: 10, points: 1 },
] as const;

export type AlphaBalanceTierConfig = {
  minUsd: number;
  points: number;
};

export type AlphaRulesConfig = {
  enabled: boolean;
  windowDays: number;
  minScoreToOpenBox: number;
  boxCost: number;
  recentSwapDays: number;
  swapUsdPerPoint: number;
  swapDailyCapPoints: number;
  swapMinPoints: number;
  balanceTiers: AlphaBalanceTierConfig[];
  legalTitleI18n: Record<string, string>;
  legalBodyI18n: Record<string, string>;
};

export const DEFAULT_ALPHA_RULES: AlphaRulesConfig = {
  enabled: true,
  windowDays: ALPHA_WINDOW_DAYS,
  minScoreToOpenBox: ALPHA_MIN_SCORE_TO_OPEN_BOX,
  boxCost: ALPHA_BOX_COST,
  recentSwapDays: ALPHA_RECENT_SWAP_DAYS,
  swapUsdPerPoint: ALPHA_SWAP_USD_PER_POINT,
  swapDailyCapPoints: ALPHA_SWAP_DAILY_CAP_POINTS,
  swapMinPoints: ALPHA_SWAP_MIN_POINTS,
  balanceTiers: [...ALPHA_BALANCE_TIERS],
  legalTitleI18n: {
    en: "Alpha Rules",
    "zh-CN": "Alpha 规则",
  },
  legalBodyI18n: {
    en: [
      "Alpha Score is separate from Lumina Points. Check-in, invite, and regular task points do not count toward Alpha mystery boxes.",
      "Balance score is calculated from your wallet's estimated USD asset value using the active balance tiers.",
      "Swap score is calculated from eligible swap volume. Small completed swaps may receive the configured minimum swap score, subject to the daily cap.",
      "Opening an Alpha token mystery box requires the configured minimum Alpha Score and one recent swap, then deducts the configured Alpha box cost.",
    ].join("\n"),
    "zh-CN": [
      "Alpha Score 与 Lumina Points 分开计算。签到、邀请、普通任务积分不进入 Alpha 代币盲盒积分。",
      "余额分根据钱包资产的预估美元价值和后台配置的余额档位计算。",
      "Swap 分根据有效兑换交易量计算，小额已完成 Swap 可获得后台配置的保底分，并受每日上限限制。",
      "打开 Alpha 代币盲盒需要达到后台配置的最低 Alpha Score，并满足近期 Swap 条件，开盒后扣除配置的 Alpha 分。",
    ].join("\n"),
  },
};

function finiteNumber(value: unknown, fallback: number, min = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, number) : fallback;
}

function finiteInteger(value: unknown, fallback: number, min = 0) {
  return Math.floor(finiteNumber(value, fallback, min));
}

function cleanI18n(value: unknown, fallback: Record<string, string>, maxLength = 4000) {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, text]) => {
    const lang = String(key || "").trim();
    const cleaned = typeof text === "string" ? text.trim() : "";
    if (lang && cleaned) out[lang] = cleaned.slice(0, maxLength);
  });
  Object.entries(fallback).forEach(([key, text]) => {
    if (!out[key]) out[key] = text;
  });
  return out;
}

export function normalizeAlphaRules(value: unknown): AlphaRulesConfig {
  const source = typeof value === "object" && value !== null ? value as Partial<AlphaRulesConfig> : {};
  const tiers = Array.isArray(source.balanceTiers)
    ? source.balanceTiers
        .filter((item) => !!item && typeof item === "object")
        .map((item) => {
          const tier = item as Partial<AlphaBalanceTierConfig>;
          return {
            minUsd: finiteNumber(tier.minUsd, 0),
            points: finiteInteger(tier.points, 0),
          };
        })
        .filter((item) => item.points > 0)
        .sort((a, b) => b.minUsd - a.minUsd)
    : [];

  return {
    enabled: source.enabled !== false,
    windowDays: finiteInteger(source.windowDays, DEFAULT_ALPHA_RULES.windowDays, 1),
    minScoreToOpenBox: finiteInteger(source.minScoreToOpenBox, DEFAULT_ALPHA_RULES.minScoreToOpenBox, 0),
    boxCost: finiteInteger(source.boxCost, DEFAULT_ALPHA_RULES.boxCost, 0),
    recentSwapDays: finiteInteger(source.recentSwapDays, DEFAULT_ALPHA_RULES.recentSwapDays, 1),
    swapUsdPerPoint: finiteNumber(source.swapUsdPerPoint, DEFAULT_ALPHA_RULES.swapUsdPerPoint, 0),
    swapDailyCapPoints: finiteInteger(source.swapDailyCapPoints, DEFAULT_ALPHA_RULES.swapDailyCapPoints, 0),
    swapMinPoints: finiteInteger(source.swapMinPoints, DEFAULT_ALPHA_RULES.swapMinPoints, 0),
    balanceTiers: tiers.length ? tiers : DEFAULT_ALPHA_RULES.balanceTiers,
    legalTitleI18n: cleanI18n(source.legalTitleI18n, DEFAULT_ALPHA_RULES.legalTitleI18n, 120),
    legalBodyI18n: cleanI18n(source.legalBodyI18n, DEFAULT_ALPHA_RULES.legalBodyI18n, 6000),
  };
}
