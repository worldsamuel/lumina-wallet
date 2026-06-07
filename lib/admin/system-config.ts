import { db } from "@/lib/db";

export type SystemConfig = {
  maintenance: boolean;
  morphoDepositEnabled: boolean;
  adminLogoUrl: string | null;
  faviconUrl: string | null;
  swapNetworkFeeLabel: string | null;
  welcomeBox: {
    enabled: boolean;
    totalCount: number;
    minPoints: number;
    maxPoints: number;
  };
  pointsRules: PointsRulesConfig;
  socialLinks: {
    x: SocialLinkConfig;
    telegram: SocialLinkConfig;
    website: SocialLinkConfig;
    discord: SocialLinkConfig;
    youtube: SocialLinkConfig;
  };
};

export type PointsRuleKind = string;

export type CustomPointsRule = {
  id: string;
  label: string;
  points: number;
  enabled: boolean;
};

export type PointsRulesConfig = {
  enabled: boolean;
  checkinPoints: number;
  swapPoints: number;
  earnPoints: number;
  luckyDayEnabled: boolean;
  luckyDayMultiplier: number;
  luckyDayDates: string[];
  wednesdayDouble: boolean;
  customRules: CustomPointsRule[];
};

export type SocialLinkConfig = {
  url: string | null;
  logoUrl: string | null;
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  maintenance: false,
  morphoDepositEnabled: true,
  adminLogoUrl: null,
  faviconUrl: null,
  swapNetworkFeeLabel: "~$0.00",
  welcomeBox: {
    enabled: true,
    totalCount: 1000,
    minPoints: 50,
    maxPoints: 500,
  },
  pointsRules: {
    enabled: true,
    checkinPoints: 5,
    swapPoints: 10,
    earnPoints: 20,
    luckyDayEnabled: false,
    luckyDayMultiplier: 2,
    luckyDayDates: [],
    wednesdayDouble: true,
    customRules: [],
  },
  socialLinks: {
    x: { url: null, logoUrl: null },
    telegram: { url: null, logoUrl: null },
    website: { url: null, logoUrl: null },
    discord: { url: null, logoUrl: null },
    youtube: { url: null, logoUrl: null },
  },
};

const SYSTEM_CONFIG_KEY = "system_config";

function normalizeSystemConfig(value: unknown): SystemConfig {
  const source = typeof value === "object" && value !== null ? value as Partial<SystemConfig> : {};
  return {
    maintenance:
      typeof source.maintenance === "boolean"
        ? source.maintenance
        : DEFAULT_SYSTEM_CONFIG.maintenance,
    morphoDepositEnabled:
      typeof source.morphoDepositEnabled === "boolean"
        ? source.morphoDepositEnabled
        : DEFAULT_SYSTEM_CONFIG.morphoDepositEnabled,
    adminLogoUrl: typeof source.adminLogoUrl === "string" && source.adminLogoUrl ? source.adminLogoUrl : null,
    faviconUrl: typeof source.faviconUrl === "string" && source.faviconUrl ? source.faviconUrl : null,
    swapNetworkFeeLabel:
      typeof source.swapNetworkFeeLabel === "string" && source.swapNetworkFeeLabel.trim()
        ? source.swapNetworkFeeLabel.trim()
        : DEFAULT_SYSTEM_CONFIG.swapNetworkFeeLabel,
    welcomeBox: normalizeWelcomeBox(source.welcomeBox),
    pointsRules: normalizePointsRules(source.pointsRules),
    socialLinks: normalizeSocialLinks(source.socialLinks),
  };
}

function normalizeWelcomeBox(value: unknown): SystemConfig["welcomeBox"] {
  const source = typeof value === "object" && value !== null ? value as Partial<SystemConfig["welcomeBox"]> : {};
  const minPoints = Math.max(0, Math.floor(Number(source.minPoints ?? DEFAULT_SYSTEM_CONFIG.welcomeBox.minPoints)));
  const maxPoints = Math.max(minPoints, Math.floor(Number(source.maxPoints ?? DEFAULT_SYSTEM_CONFIG.welcomeBox.maxPoints)));
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SYSTEM_CONFIG.welcomeBox.enabled,
    totalCount: Math.max(0, Math.floor(Number(source.totalCount ?? DEFAULT_SYSTEM_CONFIG.welcomeBox.totalCount))),
    minPoints,
    maxPoints,
  };
}

function normalizePointsRules(value: unknown): PointsRulesConfig {
  const source = typeof value === "object" && value !== null ? value as Partial<PointsRulesConfig> : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SYSTEM_CONFIG.pointsRules.enabled,
    checkinPoints: Math.max(0, Math.floor(Number(source.checkinPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.checkinPoints))),
    swapPoints: Math.max(0, Math.floor(Number(source.swapPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.swapPoints))),
    earnPoints: Math.max(0, Math.floor(Number(source.earnPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.earnPoints))),
    luckyDayEnabled: typeof source.luckyDayEnabled === "boolean" ? source.luckyDayEnabled : DEFAULT_SYSTEM_CONFIG.pointsRules.luckyDayEnabled,
    luckyDayMultiplier: Math.max(1, Number(source.luckyDayMultiplier ?? DEFAULT_SYSTEM_CONFIG.pointsRules.luckyDayMultiplier)),
    luckyDayDates: Array.isArray(source.luckyDayDates)
      ? Array.from(new Set(source.luckyDayDates.map((item) => String(item || "").trim()).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))))
      : [],
    wednesdayDouble: typeof source.wednesdayDouble === "boolean" ? source.wednesdayDouble : DEFAULT_SYSTEM_CONFIG.pointsRules.wednesdayDouble,
    customRules: Array.isArray(source.customRules)
      ? source.customRules
          .filter((item) => !!item && typeof item === "object")
          .map((item) => {
            const rule = item as Partial<CustomPointsRule>;
            return {
              id: String(rule.id || "").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 48),
              label: String(rule.label || rule.id || "Custom rule").trim().slice(0, 80),
              points: Math.max(0, Math.floor(Number(rule.points || 0))),
              enabled: rule.enabled !== false,
            };
          })
          .filter((item) => item.id && item.points > 0)
      : [],
  };
}

export function pointsRuleBase(kind: PointsRuleKind, config: SystemConfig) {
  if (kind === "checkin") return config.pointsRules.checkinPoints;
  if (kind === "swap") return config.pointsRules.swapPoints;
  if (kind === "earn") return config.pointsRules.earnPoints;
  const custom = config.pointsRules.customRules.find((rule) => rule.id === kind && rule.enabled);
  if (custom) return custom.points;
  return 0;
}

export function calculateRulePoints(kind: PointsRuleKind, config: SystemConfig, date = new Date()) {
  const rules = config.pointsRules;
  if (!rules.enabled) return { points: 0, multiplier: 1, reasons: [] as string[] };
  const { multiplier, reasons } = calculatePointsMultiplier(config, date);
  return {
    points: Math.floor(pointsRuleBase(kind, config) * multiplier),
    multiplier,
    reasons,
  };
}

export function calculatePointsMultiplier(config: SystemConfig, date = new Date()) {
  const rules = config.pointsRules;
  if (!rules.enabled) return { multiplier: 1, reasons: [] as string[] };
  let multiplier = 1;
  const reasons: string[] = [];
  const day = date.toISOString().slice(0, 10);
  if (rules.wednesdayDouble && date.getUTCDay() === 3) {
    multiplier *= 2;
    reasons.push("Wednesday double points");
  }
  if (rules.luckyDayEnabled && rules.luckyDayDates.includes(day)) {
    multiplier *= Math.max(1, Number(rules.luckyDayMultiplier || 1));
    reasons.push("Lucky day points");
  }
  return { multiplier, reasons };
}

function normalizeSocialLinks(value: unknown): SystemConfig["socialLinks"] {
  const source = typeof value === "object" && value !== null ? value as Partial<SystemConfig["socialLinks"]> : {};
  return {
    x: cleanSocialLink(source.x),
    telegram: cleanSocialLink(source.telegram),
    website: cleanSocialLink(source.website),
    discord: cleanSocialLink(source.discord),
    youtube: cleanSocialLink(source.youtube),
  };
}

function cleanSocialLink(value: unknown): SocialLinkConfig {
  if (typeof value === "string") return { url: cleanUrl(value), logoUrl: null };
  const source = typeof value === "object" && value !== null ? value as Partial<SocialLinkConfig> : {};
  return {
    url: cleanUrl(source.url),
    logoUrl: cleanUrl(source.logoUrl),
  };
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

export async function getSystemConfig() {
  const page = await db.contentPage.findUnique({ where: { key: SYSTEM_CONFIG_KEY } });
  return normalizeSystemConfig(page?.bodyI18n);
}

export async function updateSystemConfig(
  patch: Partial<Omit<SystemConfig, "socialLinks" | "welcomeBox" | "pointsRules">> & { socialLinks?: unknown; welcomeBox?: unknown; pointsRules?: unknown },
) {
  const current = await getSystemConfig();
  const next = normalizeSystemConfig({ ...current, ...patch });
  await db.contentPage.upsert({
    where: { key: SYSTEM_CONFIG_KEY },
    update: { bodyI18n: next },
    create: { key: SYSTEM_CONFIG_KEY, bodyI18n: next },
  });
  return next;
}
