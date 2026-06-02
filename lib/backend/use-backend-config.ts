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
    __luminaApplySwapSystemConfig?: () => void;
  }
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return (await res.json()) as T;
};

function escapeAttr(value: string) {
  return value.replace(/"/g, "&quot;");
}

function applySystemConfig(config: BackendSystemConfig) {
  if (typeof document === "undefined") return;

  if (config.faviconUrl) {
    const favicon =
      document.querySelector<HTMLLinkElement>("link[rel='icon']") || document.createElement("link");
    favicon.rel = "icon";
    favicon.href = config.faviconUrl;
    if (!favicon.parentNode) document.head.appendChild(favicon);
  }

  if (config.adminLogoUrl) {
    document
      .querySelectorAll<HTMLElement>(".brand .logo, .lumina-legal-logo, .mini-auth-logo, .maintenance-logo")
      .forEach((el) => {
        el.innerHTML = `<img src="${escapeAttr(config.adminLogoUrl || "")}" alt="Lumina" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;" />`;
      });
  }

  const existing = document.getElementById("luminaMaintenanceOverlay");
  if (!config.maintenance) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const overlay = document.createElement("div");
  overlay.id = "luminaMaintenanceOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#030503;display:flex;align-items:center;justify-content:center;padding:28px;color:#fff;text-align:center;";
  const mark = config.adminLogoUrl
    ? `<img src="${escapeAttr(config.adminLogoUrl)}" alt="Lumina" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`
    : "L";
  overlay.innerHTML = `<div style="max-width:320px;"><div class="maintenance-logo" style="width:74px;height:74px;margin:0 auto 22px;border-radius:50%;border:2px solid #6ee787;display:flex;align-items:center;justify-content:center;color:#6ee787;font-size:34px;font-weight:900;box-shadow:0 0 40px rgba(74,222,128,.22);overflow:hidden;">${mark}</div><h1 style="font-size:30px;line-height:1.05;margin:0 0 12px;font-weight:950;">Lumina is under maintenance</h1><p style="margin:0;color:#9ca39c;font-size:15px;line-height:1.55;">We are updating the service. Please check back shortly.</p></div>`;
  document.body.appendChild(overlay);
}

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

function normalizeTokenAddress(value: string | null | undefined) {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function uniqueVerifiedTokens(rows: BackendToken[] | undefined, swapOnly = false) {
  const seen = new Set<string>();
  return (rows || []).filter((token) => {
    if (token.status !== "verified") return false;
    if (swapOnly && token.canSwap === false) return false;
    const symbol = String(token.symbol || "").trim().toUpperCase();
    if (!symbol) return false;
    const address = normalizeTokenAddress(token.contractAddr);
    const key = address || `native:${symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Loads admin-managed backend configuration and adapts it into the v22 prototype runtime.
 */
export function useBackendConfigSync(enabled: boolean) {
  const swrOptions = {
    dedupingInterval: 2_000,
    refreshInterval: 5_000,
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
      window.localStorage.setItem("ww_tokens", JSON.stringify(uniqueVerifiedTokens(tokens.data)));
      window.localStorage.setItem("ww_swap_tokens", JSON.stringify(uniqueVerifiedTokens(tokens.data, true)));
      window.__luminaRefreshTokenLogos?.();
      window.renderAssets?.();
    }
    if (topTokens.data) {
      window.localStorage.setItem("ww_top_tokens", JSON.stringify(uniqueVerifiedTokens(topTokens.data)));
      window.__luminaRefreshTokenLogos?.();
      window.renderAssets?.();
    }
    if (fees.data) window.localStorage.setItem("ww_fee_configs", JSON.stringify(fees.data));
    if (systemConfig.data) {
      window.localStorage.setItem("ww_system_config", JSON.stringify(systemConfig.data));
      applySystemConfig(systemConfig.data);
      window.__luminaApplySystemConfig?.();
      window.__luminaApplySwapSystemConfig?.();
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
