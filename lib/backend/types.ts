export type I18nText = Record<string, string>;

export type BackendAnnouncement = {
  id: number;
  tag: string;
  titleI18n: I18nText;
  bodyI18n: I18nText;
  publishedAt: string;
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
