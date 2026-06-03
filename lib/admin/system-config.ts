import { db } from "@/lib/db";

export type SystemConfig = {
  maintenance: boolean;
  morphoDepositEnabled: boolean;
  adminLogoUrl: string | null;
  faviconUrl: string | null;
  swapNetworkFeeLabel: string | null;
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
    socialLinks: normalizeSocialLinks(source.socialLinks),
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
  patch: Partial<Omit<SystemConfig, "socialLinks">> & { socialLinks?: unknown },
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
