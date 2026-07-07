export type I18nText = Record<string, string>;

export type BackendAnnouncement = {
  id: number;
  tag: string;
  titleI18n: I18nText;
  bodyI18n: I18nText;
  publishedAt: string;
  imageUrl?: string | null;
  pinned?: boolean;
};

export type BackendCurrencyRate = {
  code: string;
  name: string;
  symbol: string;
  rate: string;
};

export type BackendContentPage = {
  key: string;
  bodyI18n: I18nText;
};

export type BackendToken = {
  id: string;
  symbol: string;
  name: string;
  contractAddr: string | null;
  decimals: number;
  logoUrl: string | null;
  status: string;
  tier?: string;
  canTransfer?: boolean;
  canSwap?: boolean;
  onTopRanking: boolean;
};

export type BackendFeeConfig = {
  businessType: string;
  percent: string;
  recipient: string | null;
};

export type BackendSystemConfig = {
  maintenance: boolean;
  morphoDepositEnabled: boolean;
  adminLogoUrl: string | null;
  faviconUrl: string | null;
  swapNetworkFeeLabel: string | null;
  pointsHomeBanner?: {
    enabled?: boolean;
    titleI18n?: Record<string, string>;
    subtitleI18n?: Record<string, string>;
    tasksLabelI18n?: Record<string, string>;
    boxLabelI18n?: Record<string, string>;
  };
  welcomeBox?: {
    enabled?: boolean;
    totalCount?: number;
    minPoints?: number;
    maxPoints?: number;
  };
  ico?: {
    enabled?: boolean;
    treasuryAddress?: string;
    rate?: number;
    minWld?: number;
    launchAt?: string | null;
    headlineI18n?: Record<string, string>;
    subtitleI18n?: Record<string, string>;
  };
  socialLinks?: {
    x?: BackendSocialLink | string | null;
    telegram?: BackendSocialLink | string | null;
    website?: BackendSocialLink | string | null;
    discord?: BackendSocialLink | string | null;
    youtube?: BackendSocialLink | string | null;
  };
};

export type BackendSocialLink = {
  url?: string | null;
  logoUrl?: string | null;
};
