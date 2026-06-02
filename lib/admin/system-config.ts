import { db } from "@/lib/db";

export type SystemConfig = {
  maintenance: boolean;
  morphoDepositEnabled: boolean;
  adminLogoUrl: string | null;
  faviconUrl: string | null;
  swapNetworkFeeLabel: string | null;
  socialLinks: {
    x: string | null;
    telegram: string | null;
    website: string | null;
    discord: string | null;
    youtube: string | null;
  };
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  maintenance: false,
  morphoDepositEnabled: true,
  adminLogoUrl: null,
  faviconUrl: null,
  swapNetworkFeeLabel: "~$0.00",
  socialLinks: {
    x: null,
    telegram: null,
    website: null,
    discord: null,
    youtube: null,
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
    x: cleanUrl(source.x),
    telegram: cleanUrl(source.telegram),
    website: cleanUrl(source.website),
    discord: cleanUrl(source.discord),
    youtube: cleanUrl(source.youtube),
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
  patch: Partial<Omit<SystemConfig, "socialLinks">> & { socialLinks?: Partial<SystemConfig["socialLinks"]> },
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
