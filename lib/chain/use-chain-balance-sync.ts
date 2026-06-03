"use client";

import { useEffect } from "react";
import useSWR from "swr";
import type { MarketPricesResponse, OnchainPricesResponse } from "@/lib/prices";

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
  usdValue: string;
};

type BalancesResponse = {
  balances: BalanceApiItem[];
  cached: boolean;
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
    { dedupingInterval: 5_000, refreshInterval: 10_000, revalidateOnFocus: true },
  );
  const market = useSWR<MarketPricesResponse>(enabled ? "/api/prices/market" : null, fetcher, {
    dedupingInterval: 15_000,
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });
  const onchain = useSWR<OnchainPricesResponse>(enabled ? "/api/prices/onchain" : null, fetcher, {
    dedupingInterval: 15_000,
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (!enabled || !userAddress) return;

    const refreshBalances = () => {
      void balances.mutate();
    };
    document.addEventListener("visibilitychange", refreshBalances);
    window.addEventListener("focus", refreshBalances);
    return () => {
      document.removeEventListener("visibilitychange", refreshBalances);
      window.removeEventListener("focus", refreshBalances);
    };
  }, [balances, enabled, userAddress]);

  useEffect(() => {
    if (!enabled) return;

    if (balances.isLoading && !balances.data) {
      renderBalanceSkeleton();
      return;
    }

    if (balances.error) {
      renderBalanceError();
      return;
    }

    if (!balances.data?.balances) return;
    syncBalancesToPrototype(balances.data.balances, market.data, onchain.data);
  }, [
    balances.data,
    balances.error,
    balances.isLoading,
    enabled,
    market.data,
    market.isLoading,
    onchain.data,
    onchain.isLoading,
  ]);
}

function syncBalancesToPrototype(
  items: BalanceApiItem[],
  marketData?: MarketPricesResponse,
  onchainData?: OnchainPricesResponse,
) {
  const assets = items.map((item) => {
    const formatted = formatTokenAmount(item.formatted);
    const priceUsd = pickOnchainPrice(item.symbol, onchainData);
    const amount = Number.parseFloat(item.formatted || "0") || 0;
    const usdValue = priceUsd === null ? null : amount * priceUsd;
    return {
      sym: item.symbol,
      full: item.name,
      amt: `${formatted} ${item.symbol}`,
      usdNum: usdValue,
      cls: item.className,
      logo: item.logo,
      address: item.contractAddress ?? null,
    };
  });
  if (!assets.some((item) => item.sym === "BTC")) {
    assets.push({
      sym: "BTC",
      full: "Bitcoin",
      amt: "0 BTC",
      usdNum: 0,
      cls: "btc",
      logo: "B",
      address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3",
    });
  }
  const balanceMap: Record<string, string> = Object.fromEntries(
    items.map((item) => [item.symbol, formatTokenAmount(item.formatted)]),
  );
  balanceMap.BTC ??= "0";
  const availableMap: Record<string, string> = Object.fromEntries(
    items.map((item) => [item.symbol, `${formatTokenAmount(item.formatted)} ${item.symbol}`]),
  );
  availableMap.BTC ??= "0 BTC";
  const priceMap: Record<string, number | null> = Object.fromEntries(
    items.map((item) => [item.symbol, pickOnchainPrice(item.symbol, onchainData)]),
  );
  priceMap.BTC ??= pickMarketPrice("BTC", marketData);
  const marketPriceMap: Record<string, number | null> = Object.fromEntries(
    items.map((item) => [item.symbol, pickMarketPrice(item.symbol, marketData)]),
  );
  marketPriceMap.BTC ??= pickMarketPrice("BTC", marketData);
  const changeMap: Record<string, number | null> = Object.fromEntries(
    items.map((item) => [item.symbol, pickMarketChange(item.symbol, marketData)]),
  );
  changeMap.BTC ??= pickMarketChange("BTC", marketData);
  const marketCapMap: Record<string, number | null> = Object.fromEntries(
    items.map((item) => [item.symbol, pickMarketCap(item.symbol, marketData)]),
  );
  marketCapMap.BTC ??= pickMarketCap("BTC", marketData);
  const totalUsd = assets.reduce((sum, item) => sum + (item.usdNum ?? 0), 0);
  const changeUsd = items.reduce((sum, item) => {
    const priceUsd = pickOnchainPrice(item.symbol, onchainData);
    if (priceUsd === null) return sum;
    const currentValue = (Number.parseFloat(item.formatted || "0") || 0) * priceUsd;
    const changePct = changeMap[item.symbol] ?? 0;
    return sum + currentValue * (changePct / 100);
  }, 0);
  const weightedChangePct = totalUsd > 0 ? (changeUsd / totalUsd) * 100 : 0;

  runInPrototypeScope(`
    var previousPrices = prices || {};
    var previousAssets = Array.isArray(assets) ? assets : [];
    var previousAssetUsd = {};
    previousAssets.forEach(function(asset){
      if (asset && asset.sym && Number(asset.usdNum) > 0) previousAssetUsd[String(asset.sym).toUpperCase()] = Number(asset.usdNum);
    });
    var incomingAssets = ${JSON.stringify(assets)};
    assets = incomingAssets.map(function(asset){
      var sym = String(asset.sym || "").toUpperCase();
      if ((asset.usdNum === null || asset.usdNum === undefined || Number(asset.usdNum) <= 0) && previousAssetUsd[sym] > 0) {
        return Object.assign({}, asset, { usdNum: previousAssetUsd[sym] });
      }
      return asset;
    });
    balances = ${JSON.stringify(balanceMap)};
    availMap = ${JSON.stringify(availableMap)};
    var incomingPrices = ${JSON.stringify(priceMap)};
    prices = Object.assign({}, previousPrices);
    Object.keys(incomingPrices).forEach(function(sym){
      var value = incomingPrices[sym];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) prices[sym] = value;
      else if (prices[sym] === undefined) prices[sym] = value;
    });
    marketPrices = ${JSON.stringify(marketPriceMap)};
    totalUsdNum = ${JSON.stringify(totalUsd)};
    change24hUsdNum = ${JSON.stringify(changeUsd)};
    tokenChanges24h = ${JSON.stringify(changeMap)};
    tokenMarketCaps = ${JSON.stringify(marketCapMap)};
    window.__luminaOnchainPrices = ${JSON.stringify(onchainData ?? null)};
    window.__luminaMarketPrices = ${JSON.stringify(marketData ?? null)};
    if (typeof renderGainers === "function") renderGainers(window.__luminaMarketPrices);
    if (document.querySelector(".balance-change")) {
      document.querySelector(".balance-change").childNodes[0].textContent = ${JSON.stringify(formatChangePct(weightedChangePct))} + " ";
      document.querySelector(".balance-change").classList.toggle("down", ${JSON.stringify(weightedChangePct < 0)});
    }
    if (typeof renderMoney === "function") renderMoney();
    if (typeof window.__luminaApplyBalancePrivacy === "function") window.__luminaApplyBalancePrivacy();
    if (typeof refreshSwapLabels === "function") refreshSwapLabels();
  `);
}

function pickOnchainPrice(symbol: string, pricesData: OnchainPricesResponse | undefined) {
  const value = pricesData?.[symbol as keyof OnchainPricesResponse];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickMarketPrice(symbol: string, marketData: MarketPricesResponse | undefined) {
  const value = marketData?.[symbol as keyof MarketPricesResponse];
  return typeof value === "object" && value && "usd" in value && typeof value.usd === "number"
    ? value.usd
    : null;
}

function pickMarketChange(symbol: string, marketData: MarketPricesResponse | undefined) {
  const value = marketData?.[symbol as keyof MarketPricesResponse];
  return typeof value === "object" &&
    value &&
    "usd_24h_change" in value &&
    typeof value.usd_24h_change === "number"
    ? value.usd_24h_change
    : null;
}

function pickMarketCap(symbol: string, marketData: MarketPricesResponse | undefined) {
  const value = marketData?.[symbol as keyof MarketPricesResponse];
  return typeof value === "object" &&
    value &&
    "usd_market_cap" in value &&
    typeof value.usd_market_cap === "number"
    ? value.usd_market_cap
    : null;
}

function formatChangePct(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function renderBalanceSkeleton() {
  const list = document.getElementById("assetList");
  if (!list || list.children.length > 0 || list.querySelector(".asset-skeleton")) return;
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
  const trimmedFraction = fraction.slice(0, 3).replace(/0+$/, "");
  const body = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return Number(body).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function runInPrototypeScope(source: string) {
  const script = document.createElement("script");
  script.text = `try { ${source} } catch (error) { console.error("Failed to sync chain balances", error); }`;
  document.body.appendChild(script);
  script.remove();
}
