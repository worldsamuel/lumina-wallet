"use client";

import { useEffect } from "react";
import useSWR from "swr";

export type BalanceApiItem = {
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  formatted: string;
  logo: string;
  className: string;
  native: boolean;
  contractAddress?: string;
  priceUsd: number;
  usdValue: string;
};

type BalancesResponse = {
  balances: BalanceApiItem[];
  cached: boolean;
};

export type PricesResponse = Record<string, number | string | PriceMeta> & {
  updated_at: string;
  meta: PriceMeta;
};

type PriceMeta = {
  source: "worldchain" | "cache" | "fallback";
  changes_24h: Record<string, number | null>;
  last_updated_at: Record<string, number>;
  liquidity_usd?: Record<string, number>;
  volume_24h_usd?: Record<string, number>;
};

type PrototypeAsset = {
  sym: string;
  full: string;
  amt: string;
  usdNum: number;
  cls: string;
  logo: string;
};

const fetcher = async <T,>(url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Unable to read on-chain data.");
  }
  return (await response.json()) as T;
};

/**
 * Polls World Chain balances and syncs them into the mounted v22 prototype runtime.
 */
export function useChainBalanceSync(enabled: boolean, userAddress: string | null) {
  const balances = useSWR<BalancesResponse>(
    enabled && userAddress ? `/api/balances?address=${userAddress}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const prices = useSWR<PricesResponse>(enabled ? "/api/prices" : null, fetcher, {
    refreshInterval: 30_000,
  });

  useEffect(() => {
    if (!enabled) return;

    if (balances.isLoading || prices.isLoading) {
      renderBalanceSkeleton();
      return;
    }

    if (balances.error) {
      renderBalanceError();
      return;
    }

    if (!balances.data?.balances) return;
    syncBalancesToPrototype(balances.data.balances, prices.data);
  }, [
    balances.data,
    balances.error,
    balances.isLoading,
    enabled,
    prices.data,
    prices.isLoading,
  ]);
}

function syncBalancesToPrototype(items: BalanceApiItem[], pricesData?: PricesResponse) {
  const assets = items.map((item) => {
    const formatted = formatTokenAmount(item.formatted);
    const priceUsd = pickPrice(item.symbol, pricesData, item.priceUsd);
    const usdValue = (Number.parseFloat(item.formatted || "0") || 0) * priceUsd;
    return {
      sym: item.symbol,
      full: item.name,
      amt: `${formatted} ${item.symbol}`,
      usdNum: usdValue,
      cls: item.className,
      logo: item.logo,
    };
  });
  const balanceMap = Object.fromEntries(
    items.map((item) => [item.symbol, formatTokenAmount(item.formatted)]),
  );
  const availableMap = Object.fromEntries(
    items.map((item) => [item.symbol, `${formatTokenAmount(item.formatted)} ${item.symbol}`]),
  );
  const priceMap = Object.fromEntries(
    items.map((item) => [item.symbol, pickPrice(item.symbol, pricesData, item.priceUsd)]),
  );
  const changeMap = pricesData?.meta?.changes_24h ?? {};
  const totalUsd = assets.reduce((sum, item) => sum + item.usdNum, 0);
  const changeUsd = items.reduce((sum, item) => {
    const currentValue = (Number.parseFloat(item.formatted || "0") || 0) * pickPrice(item.symbol, pricesData, item.priceUsd);
    const changePct = changeMap[item.symbol] ?? 0;
    return sum + currentValue * (changePct / 100);
  }, 0);
  const weightedChangePct = totalUsd > 0 ? (changeUsd / totalUsd) * 100 : 0;

  runInPrototypeScope(`
    assets = ${JSON.stringify(assets)};
    balances = ${JSON.stringify(balanceMap)};
    availMap = ${JSON.stringify(availableMap)};
    prices = ${JSON.stringify(priceMap)};
    totalUsdNum = ${JSON.stringify(totalUsd)};
    change24hUsdNum = ${JSON.stringify(changeUsd)};
    tokenChanges24h = ${JSON.stringify(changeMap)};
    if (document.querySelector(".balance-change")) {
      document.querySelector(".balance-change").childNodes[0].textContent = ${JSON.stringify(formatChangePct(weightedChangePct))} + " ";
      document.querySelector(".balance-change").classList.toggle("down", ${JSON.stringify(weightedChangePct < 0)});
    }
    if (typeof renderMoney === "function") renderMoney();
    if (typeof refreshSwapLabels === "function") refreshSwapLabels();
  `);
}

function pickPrice(symbol: string, pricesData: PricesResponse | undefined, fallback: number) {
  const value = pricesData?.[symbol];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatChangePct(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function renderBalanceSkeleton() {
  const list = document.getElementById("assetList");
  if (!list || list.querySelector(".asset-skeleton")) return;
  list.innerHTML = Array.from({ length: 3 })
    .map(
      () =>
        '<div class="asset asset-skeleton"><div class="coin"></div><div class="name"><div class="sym"></div><div class="full"></div></div><div class="spark"></div><div class="vals"><div class="amt"></div><div class="usd"></div></div></div>',
    )
    .join("");
}

function renderBalanceError() {
  const list = document.getElementById("assetList");
  if (list) {
    list.innerHTML = '<div class="article-empty">无法读取链上数据,请稍后重试</div>';
  }
}

function formatTokenAmount(value: string) {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  const body = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return Number(body).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function runInPrototypeScope(source: string) {
  const script = document.createElement("script");
  script.text = `try { ${source} } catch (error) { console.error("Failed to sync chain balances", error); }`;
  document.body.appendChild(script);
  script.remove();
}
