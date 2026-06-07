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
  socialLinks: {
    x: SocialLinkConfig;
    telegram: SocialLinkConfig;
    website: SocialLinkConfig;
    discord: SocialLinkConfig;
    youtube: SocialLinkConfig;
  };
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
  patch: Partial<Omit<SystemConfig, "socialLinks" | "welcomeBox">> & { socialLinks?: unknown; welcomeBox?: unknown },
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
