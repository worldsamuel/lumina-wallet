"use client";

import useSWR from "swr";
import { useEffect } from "react";
import type {
  BackendAnnouncement,
  BackendContentPage,
  BackendCurrencyRate,
  BackendFeeConfig,
  BackendSystemConfig,
  BackendToken,
} from "./types";

declare global {
  interface Window {
    renderAbout?: () => void;
    renderHelp?: () => void;
    renderMoney?: () => void;
    renderAssets?: () => void;
    updateBellDot?: () => void;
    __luminaRefreshTokenLogos?: () => void;
    __luminaApplySystemConfig?: () => void;
  }
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return (await res.json()) as T;
};

function pickText(i18n: Record<string, string> | undefined, lang: string) {
  return i18n?.[lang] ?? i18n?.en ?? i18n?.["zh-CN"] ?? "";
}

function currentLang() {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem("ww_lang") || "en";
}

function formatRelativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  if (Number.isNaN(delta) || delta < 60_000) return "Just now";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))}h ago`;
  return `${Math.floor(delta / (24 * 60 * 60_000))}d ago`;
}

/**
 * Loads admin-managed backend configuration and adapts it into the v22 prototype runtime.
 */
export function useBackendConfigSync(enabled: boolean) {
  const swrOptions = {
    dedupingInterval: 20_000,
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  };
  const announcements = useSWR<BackendAnnouncement[]>(
    enabled ? "/api/announcements" : null,
    fetcher,
    swrOptions,
  );
  const rates = useSWR<BackendCurrencyRate[]>(
    enabled ? "/api/currency-rates" : null,
    fetcher,
    swrOptions,
  );
  const help = useSWR<BackendContentPage>(enabled ? "/api/content/help" : null, fetcher, swrOptions);
  const about = useSWR<BackendContentPage>(
    enabled ? "/api/content/about" : null,
    fetcher,
    swrOptions,
  );
  const tokens = useSWR<BackendToken[]>(enabled ? "/api/tokens" : null, fetcher, swrOptions);
  const topTokens = useSWR<BackendToken[]>(enabled ? "/api/tokens/top" : null, fetcher, swrOptions);
  const fees = useSWR<BackendFeeConfig[]>(enabled ? "/api/fees" : null, fetcher, swrOptions);
  const systemConfig = useSWR<BackendSystemConfig>(
    enabled ? "/api/system-config" : null,
    fetcher,
    swrOptions,
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const lang = currentLang();

    if (announcements.data) {
      window.localStorage.setItem(
        "ww_announcements",
        JSON.stringify(
          announcements.data.map((item) => ({
            id: item.id,
            tag: item.tag,
            title: pickText(item.titleI18n, lang),
            body: pickText(item.bodyI18n, lang),
            time: formatRelativeTime(item.publishedAt),
          })),
        ),
      );
      window.updateBellDot?.();
    }

    if (rates.data) {
      window.localStorage.setItem(
        "ww_currency_rates",
        JSON.stringify(
          Object.fromEntries(rates.data.map((item) => [item.code, Number(item.rate)])),
        ),
      );
      window.renderMoney?.();
    }

    if (help.data) {
      window.localStorage.setItem("ww_help_content", pickText(help.data.bodyI18n, lang));
      window.renderHelp?.();
    }

    if (about.data) {
      window.localStorage.setItem("ww_about_content", pickText(about.data.bodyI18n, lang));
      window.renderAbout?.();
    }

    if (tokens.data) {
      window.localStorage.setItem("ww_tokens", JSON.stringify(tokens.data));
      window.__luminaRefreshTokenLogos?.();
      window.renderAssets?.();
    }
    if (topTokens.data) {
      window.localStorage.setItem("ww_top_tokens", JSON.stringify(topTokens.data));
      window.__luminaRefreshTokenLogos?.();
      window.renderAssets?.();
    }
    if (fees.data) window.localStorage.setItem("ww_fee_configs", JSON.stringify(fees.data));
    if (systemConfig.data) {
      window.localStorage.setItem("ww_system_config", JSON.stringify(systemConfig.data));
      window.__luminaApplySystemConfig?.();
    }
  }, [
    about.data,
    announcements.data,
    enabled,
    fees.data,
    help.data,
    rates.data,
    systemConfig.data,
    tokens.data,
    topTokens.data,
  ]);
}
