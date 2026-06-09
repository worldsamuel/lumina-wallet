import { db } from "@/lib/db";

export type SystemConfig = {
  maintenance: boolean;
  morphoDepositEnabled: boolean;
  adminLogoUrl: string | null;
  faviconUrl: string | null;
  swapNetworkFeeLabel: string | null;
  pointsHomeBanner: {
    enabled: boolean;
    titleI18n: Record<string, string>;
    subtitleI18n: Record<string, string>;
    tasksLabelI18n: Record<string, string>;
    boxLabelI18n: Record<string, string>;
  };
  welcomeBox: {
    enabled: boolean;
    totalCount: number;
    minPoints: number;
    maxPoints: number;
  };
  pointsRules: PointsRulesConfig;
  pointsTasks: PointsTaskConfig[];
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
  checkinRewards: number[];
  swapPoints: number;
  swapPointsPerUsd: number;
  swapDailyUsdCap: number;
  earnPoints: number;
  earnPointsPerUsd: number;
  earnDailyUsdCap: number;
  luckyDayEnabled: boolean;
  luckyDayMultiplier: number;
  luckyDayDates: string[];
  wednesdayDouble: boolean;
  customRules: CustomPointsRule[];
};

export type PointsTaskConfig = {
  id: string;
  type: "checkin" | "swap" | "earn" | "social" | "custom";
  titleI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  points: number;
  actionLabelI18n: Record<string, string>;
  actionUrl: string | null;
  enabled: boolean;
  sortOrder: number;
};

export type SocialLinkConfig = {
  url: string | null;
  logoUrl: string | null;
};

type SystemConfigPatch = Partial<Omit<SystemConfig, "socialLinks" | "welcomeBox" | "pointsHomeBanner" | "pointsRules" | "pointsTasks">> & {
  socialLinks?: unknown;
  welcomeBox?: unknown;
  pointsHomeBanner?: unknown;
  pointsRules?: unknown;
  pointsTasks?: unknown;
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  maintenance: false,
  morphoDepositEnabled: true,
  adminLogoUrl: null,
  faviconUrl: null,
  swapNetworkFeeLabel: "~$0.00",
  pointsHomeBanner: {
    enabled: true,
    titleI18n: { en: "Lumina Points", "zh-CN": "Lumina Points" },
    subtitleI18n: {
      en: "Complete tasks, earn points, and unlock amazing rewards.",
      "zh-CN": "完成任务，赚取积分，解锁更多奖励。",
    },
    tasksLabelI18n: { en: "Tasks", "zh-CN": "任务" },
    boxLabelI18n: { en: "Mystery Box", "zh-CN": "盲盒" },
  },
  welcomeBox: {
    enabled: true,
    totalCount: 1000,
    minPoints: 50,
    maxPoints: 500,
  },
  pointsRules: {
    enabled: true,
    checkinPoints: 5,
    checkinRewards: [10, 15, 20, 25, 30, 40, 100],
    swapPoints: 10,
    swapPointsPerUsd: 1,
    swapDailyUsdCap: 1000,
    earnPoints: 20,
    earnPointsPerUsd: 2,
    earnDailyUsdCap: 1000,
    luckyDayEnabled: false,
    luckyDayMultiplier: 2,
    luckyDayDates: [],
    wednesdayDouble: true,
    customRules: [],
  },
  pointsTasks: [
    {
      id: "daily-checkin",
      type: "checkin",
      titleI18n: { en: "Daily Check-in", "zh-CN": "每日签到" },
      descriptionI18n: { en: "Check in daily to earn more points", "zh-CN": "每日签到获得更多积分" },
      points: 10,
      actionLabelI18n: { en: "Check in" },
      actionUrl: null,
      enabled: true,
      sortOrder: 1,
    },
    {
      id: "open-world-app",
      type: "custom",
      titleI18n: { en: "Open Lumina App", "zh-CN": "打开 Lumina App" },
      descriptionI18n: { en: "Open the app everyday", "zh-CN": "每天打开应用" },
      points: 10,
      actionLabelI18n: { en: "Claim", "zh-CN": "领取" },
      actionUrl: null,
      enabled: true,
      sortOrder: 2,
    },
    {
      id: "make-swap",
      type: "swap",
      titleI18n: { en: "Make a Swap", "zh-CN": "完成一次兑换" },
      descriptionI18n: { en: "Complete any token swap", "zh-CN": "完成任意代币兑换" },
      points: 20,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: "/swap",
      enabled: true,
      sortOrder: 3,
    },
    {
      id: "make-earn",
      type: "earn",
      titleI18n: { en: "Make an Earn", "zh-CN": "完成一次 Earn" },
      descriptionI18n: { en: "Complete any Earn transaction", "zh-CN": "完成任意 Earn 操作" },
      points: 20,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: "/earn",
      enabled: true,
      sortOrder: 4,
    },
    {
      id: "bind-world-app",
      type: "custom",
      titleI18n: { en: "Bind World App", "zh-CN": "绑定 World App" },
      descriptionI18n: { en: "Bind your World App account", "zh-CN": "绑定你的 World App 账户" },
      points: 30,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: null,
      enabled: true,
      sortOrder: 5,
    },
    {
      id: "share-friends",
      type: "social",
      titleI18n: { en: "Share with Friends", "zh-CN": "分享给好友" },
      descriptionI18n: { en: "Share Lumina with your friends", "zh-CN": "把 Lumina 分享给好友" },
      points: 10,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: null,
      enabled: true,
      sortOrder: 6,
    },
    {
      id: "open-mystery-box",
      type: "custom",
      titleI18n: { en: "Open a Mystery Box", "zh-CN": "打开盲盒" },
      descriptionI18n: { en: "Open a mystery box", "zh-CN": "打开一个积分盲盒" },
      points: 50,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: null,
      enabled: true,
      sortOrder: 7,
    },
    {
      id: "invite-friend",
      type: "social",
      titleI18n: { en: "Invite a Friend", "zh-CN": "邀请好友" },
      descriptionI18n: { en: "Invite a friend to join Lumina", "zh-CN": "邀请好友加入 Lumina" },
      points: 100,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: null,
      enabled: true,
      sortOrder: 8,
    },
    {
      id: "follow-twitter",
      type: "social",
      titleI18n: { en: "Follow on Twitter", "zh-CN": "关注 Twitter" },
      descriptionI18n: { en: "Follow @luminafi_xyz", "zh-CN": "关注 @luminafi_xyz" },
      points: 20,
      actionLabelI18n: { en: "Go", "zh-CN": "去完成" },
      actionUrl: "https://x.com/luminafi_xyz",
      enabled: true,
      sortOrder: 9,
    },
  ],
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
    pointsHomeBanner: normalizePointsHomeBanner(source.pointsHomeBanner),
    welcomeBox: normalizeWelcomeBox(source.welcomeBox),
    pointsRules: normalizePointsRules(source.pointsRules),
    pointsTasks: normalizePointsTasks(source.pointsTasks),
    socialLinks: normalizeSocialLinks(source.socialLinks),
  };
}

function normalizePointsHomeBanner(value: unknown): SystemConfig["pointsHomeBanner"] {
  const source = typeof value === "object" && value !== null ? value as Partial<SystemConfig["pointsHomeBanner"]> : {};
  const fallback = DEFAULT_SYSTEM_CONFIG.pointsHomeBanner;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    titleI18n: cleanI18n(source.titleI18n, fallback.titleI18n.en),
    subtitleI18n: cleanI18n(source.subtitleI18n, fallback.subtitleI18n.en),
    tasksLabelI18n: cleanI18n(source.tasksLabelI18n, fallback.tasksLabelI18n.en),
    boxLabelI18n: cleanI18n(source.boxLabelI18n, fallback.boxLabelI18n.en),
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
  const fallbackCheckinRewards = DEFAULT_SYSTEM_CONFIG.pointsRules.checkinRewards;
  const checkinRewards = Array.isArray(source.checkinRewards)
    ? source.checkinRewards.map((item) => Math.max(0, Math.floor(Number(item || 0)))).slice(0, 7)
    : [];
  while (checkinRewards.length < 7) checkinRewards.push(fallbackCheckinRewards[checkinRewards.length] ?? 0);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SYSTEM_CONFIG.pointsRules.enabled,
    checkinPoints: Math.max(0, Math.floor(Number(source.checkinPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.checkinPoints))),
    checkinRewards,
    swapPoints: Math.max(0, Math.floor(Number(source.swapPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.swapPoints))),
    swapPointsPerUsd: Math.max(0, Number(source.swapPointsPerUsd ?? DEFAULT_SYSTEM_CONFIG.pointsRules.swapPointsPerUsd)),
    swapDailyUsdCap: Math.max(0, Number(source.swapDailyUsdCap ?? DEFAULT_SYSTEM_CONFIG.pointsRules.swapDailyUsdCap)),
    earnPoints: Math.max(0, Math.floor(Number(source.earnPoints ?? DEFAULT_SYSTEM_CONFIG.pointsRules.earnPoints))),
    earnPointsPerUsd: Math.max(0, Number(source.earnPointsPerUsd ?? DEFAULT_SYSTEM_CONFIG.pointsRules.earnPointsPerUsd)),
    earnDailyUsdCap: Math.max(0, Number(source.earnDailyUsdCap ?? DEFAULT_SYSTEM_CONFIG.pointsRules.earnDailyUsdCap)),
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

function cleanI18n(value: unknown, fallback: string) {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, text]) => {
    const lang = String(key || "").trim();
    const cleaned = typeof text === "string" ? text.trim() : "";
    if (lang && cleaned) out[lang] = cleaned.slice(0, 240);
  });
  if (!out.en) out.en = fallback;
  return out;
}

function normalizePointsTasks(value: unknown): PointsTaskConfig[] {
  const source = Array.isArray(value) ? value : DEFAULT_SYSTEM_CONFIG.pointsTasks;
  const mergedSource = Array.isArray(value)
    ? [
        ...source,
        ...DEFAULT_SYSTEM_CONFIG.pointsTasks.filter(
          (defaultTask) => !source.some((task) => !!task && typeof task === "object" && String((task as Partial<PointsTaskConfig>).id || "") === defaultTask.id),
        ),
      ]
    : source;
  return mergedSource
    .filter((item) => !!item && typeof item === "object")
    .map((item, index) => {
      const task = item as Partial<PointsTaskConfig>;
      const title = cleanI18n(task.titleI18n, String(task.id || "Task"));
      return {
        id: String(task.id || `task-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 48) || `task-${index + 1}`,
        type: ["checkin", "swap", "earn", "social", "custom"].includes(String(task.type)) ? task.type as PointsTaskConfig["type"] : "custom",
        titleI18n: title,
        descriptionI18n: cleanI18n(task.descriptionI18n, title.en || "Complete this task to earn Lumina Points."),
        points: Math.max(0, Math.floor(Number(task.points ?? 0))),
        actionLabelI18n: cleanI18n(task.actionLabelI18n, "Start"),
        actionUrl: cleanTaskUrl(task.actionUrl),
        enabled: task.enabled !== false,
        sortOrder: Number(task.sortOrder ?? index + 1),
      };
    })
    .filter((task) => task.id && task.points > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function pointsRuleBase(kind: PointsRuleKind, config: SystemConfig) {
  if (kind === "checkin") return config.pointsRules.checkinPoints;
  if (kind === "swap") return config.pointsRules.swapPoints;
  if (kind === "earn") return config.pointsRules.earnPoints;
  const custom = config.pointsRules.customRules.find((rule) => rule.id === kind && rule.enabled);
  if (custom) return custom.points;
  return 0;
}

export function checkinRewardForDay(config: SystemConfig, day: number) {
  const rewards = Array.isArray(config.pointsRules.checkinRewards) && config.pointsRules.checkinRewards.length
    ? config.pointsRules.checkinRewards
    : DEFAULT_SYSTEM_CONFIG.pointsRules.checkinRewards;
  const index = Math.max(0, Math.min(6, Math.floor(Number(day || 1)) - 1));
  return Math.max(0, Math.floor(Number(rewards[index] ?? rewards[0] ?? config.pointsRules.checkinPoints ?? 0)));
}

export function calculateUsdRulePoints(kind: "swap" | "earn", usdValue: number, config: SystemConfig, date = new Date()) {
  const rules = config.pointsRules;
  if (!rules.enabled) return { points: 0, multiplier: 1, reasons: [] as string[], cappedUsd: 0 };
  const cap = kind === "swap" ? rules.swapDailyUsdCap : rules.earnDailyUsdCap;
  const perUsd = kind === "swap" ? rules.swapPointsPerUsd : rules.earnPointsPerUsd;
  const cappedUsd = Math.max(0, Math.min(Number(usdValue || 0), Number(cap || 0)));
  const { multiplier, reasons } = calculatePointsMultiplier(config, date);
  return {
    points: Math.floor(cappedUsd * Number(perUsd || 0) * multiplier),
    multiplier,
    reasons,
    cappedUsd,
  };
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
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/:?#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function cleanTaskUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\/[a-z0-9/_-]*$/i.test(trimmed)) return trimmed;
  return cleanUrl(trimmed);
}

function cleanUndefinedFields<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSystemConfigPatch(
  current: SystemConfig,
  patch: SystemConfigPatch,
): Partial<SystemConfig> {
  const cleaned = cleanUndefinedFields(patch as Record<string, unknown>) as Partial<SystemConfig> & {
    socialLinks?: unknown;
    welcomeBox?: unknown;
    pointsHomeBanner?: unknown;
    pointsRules?: unknown;
    pointsTasks?: unknown;
  };
  const next: Partial<SystemConfig> = { ...cleaned };

  if (isRecord(cleaned.welcomeBox)) {
    next.welcomeBox = { ...current.welcomeBox, ...cleanUndefinedFields(cleaned.welcomeBox) };
  }

  if (isRecord(cleaned.pointsHomeBanner)) {
    next.pointsHomeBanner = { ...current.pointsHomeBanner, ...cleanUndefinedFields(cleaned.pointsHomeBanner) };
  }

  if (isRecord(cleaned.pointsRules)) {
    next.pointsRules = { ...current.pointsRules, ...cleanUndefinedFields(cleaned.pointsRules) };
  }

  if (Array.isArray(cleaned.pointsTasks)) {
    next.pointsTasks = cleaned.pointsTasks as PointsTaskConfig[];
  }

  if (isRecord(cleaned.socialLinks)) {
    const links: SystemConfig["socialLinks"] = { ...current.socialLinks };
    (["x", "telegram", "website", "discord", "youtube"] as const).forEach((key) => {
      const incoming = cleaned.socialLinks?.[key];
      if (incoming === undefined) return;
      const mergedLink = isRecord(incoming)
        ? { ...current.socialLinks[key], ...cleanUndefinedFields(incoming) }
        : incoming;
      links[key] = cleanSocialLink(mergedLink);
    });
    next.socialLinks = links;
  }

  return next;
}

export async function getSystemConfig() {
  const page = await db.contentPage.findUnique({ where: { key: SYSTEM_CONFIG_KEY } });
  return normalizeSystemConfig(page?.bodyI18n);
}

export async function updateSystemConfig(
  patch: SystemConfigPatch,
) {
  const current = await getSystemConfig();
  const mergedPatch = mergeSystemConfigPatch(current, patch);
  const next = normalizeSystemConfig({ ...current, ...mergedPatch });
  await db.contentPage.upsert({
    where: { key: SYSTEM_CONFIG_KEY },
    update: { bodyI18n: next },
    create: { key: SYSTEM_CONFIG_KEY, bodyI18n: next },
  });
  return next;
}
