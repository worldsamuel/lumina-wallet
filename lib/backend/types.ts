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
    x?: string | null;
    telegram?: string | null;
    website?: string | null;
    discord?: string | null;
    youtube?: string | null;
  };
};
