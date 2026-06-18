"use client";

import { useEffect, useRef } from "react";
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
  stale?: boolean;
  warning?: string;
};

const fetcher = async <T,>(url: string) => {
  const response = await fetch(url);
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
  const portfolioPricesRef = useRef<Record<string, number>>({});
  const balances = useSWR<BalancesResponse>(
    enabled && userAddress ? `/api/balances?address=${userAddress}` : null,
    fetcher,
    { dedupingInterval: 30_000, refreshInterval: 90_000, revalidateOnFocus: false, refreshWhenHidden: false },
  );
  const market = useSWR<MarketPricesResponse>(enabled ? "/api/prices/market" : null, fetcher, {
    dedupingInterval: 300_000,
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  });
  const onchain = useSWR<OnchainPricesResponse>(enabled ? "/api/prices/onchain" : null, fetcher, {
    dedupingInterval: 300_000,
    refreshInterval: 300_000,
    revalidateOnFocus: false,
  });

  useEffect(() => {
    if (!enabled || !userAddress) return;

    const refreshBalances = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
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
      const snapshot = readBalanceSnapshot(userAddress);
      if (snapshot?.balances?.length) {
        syncBalancesToPrototype(snapshot.balances, market.data, onchain.data, portfolioPricesRef.current, true);
        return;
      }
      renderBalanceSkeleton();
      return;
    }

    if (balances.error) {
      const snapshot = readBalanceSnapshot(userAddress);
      if (snapshot?.balances?.length) {
        syncBalancesToPrototype(snapshot.balances, market.data, onchain.data, portfolioPricesRef.current, true);
      }
      renderBalanceError();
      return;
    }

    if (!balances.data?.balances) return;
    writeBalanceSnapshot(userAddress, balances.data.balances);
    syncBalancesToPrototype(
      balances.data.balances,
      market.data,
      onchain.data,
      portfolioPricesRef.current,
      Boolean(balances.data.stale),
    );
  }, [
    balances.data,
    balances.error,
    balances.isLoading,
    enabled,
    userAddress,
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
  portfolioPrices: Record<string, number> = {},
  stale = false,
) {
  const assets = items.map((item) => {
    const formatted = formatTokenAmount(item.formatted);
    const livePriceUsd = pickOnchainPrice(item.symbol, onchainData) ?? pickMarketPrice(item.symbol, marketData);
    const amount = Number.parseFloat(item.formatted || "0") || 0;
    const previousPortfolioPrice = portfolioPrices[item.symbol];
    const portfolioPriceUsd =
      amount > 0 && previousPortfolioPrice > 0
        ? previousPortfolioPrice
        : livePriceUsd;
    if (amount > 0 && livePriceUsd !== null && !(previousPortfolioPrice > 0)) {
      portfolioPrices[item.symbol] = livePriceUsd;
    }
    const usdValue = portfolioPriceUsd === null ? null : amount * portfolioPriceUsd;
    return {
      sym: item.symbol,
      full: item.name,
      amt: `${formatted} ${item.symbol}`,
      usdNum: usdValue,
      portfolioUsdNum: usdValue,
      cls: item.className,
      logo: item.logo,
      contractAddress: item.contractAddress ?? null,
      address: item.contractAddress ?? null,
      custom: item.className === "custom",
      hasBalance: amount > 0,
    };
  });
  if (!assets.some((item) => item.sym === "BTC")) {
    assets.push({
      sym: "BTC",
      full: "Bitcoin",
      amt: "0 BTC",
      usdNum: 0,
      portfolioUsdNum: 0,
      cls: "btc",
      logo: "B",
      contractAddress: null,
      address: null,
      custom: false,
      hasBalance: false,
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
    items.map((item) => [item.symbol, pickOnchainPrice(item.symbol, onchainData) ?? pickMarketPrice(item.symbol, marketData)]),
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
    const currentValue = assets.find((asset) => asset.sym === item.symbol)?.portfolioUsdNum ?? 0;
    const changePct = changeMap[item.symbol] ?? 0;
    return sum + currentValue * (changePct / 100);
  }, 0);
  const weightedChangePct = totalUsd > 0 ? (changeUsd / totalUsd) * 100 : 0;

  runInPrototypeScope(`
    assets = ${JSON.stringify(assets)};
    balances = ${JSON.stringify(balanceMap)};
    availMap = ${JSON.stringify(availableMap)};
    prices = ${JSON.stringify(priceMap)};
    marketPrices = ${JSON.stringify(marketPriceMap)};
    window.__luminaBalancesStale = ${JSON.stringify(stale)};
    window.__luminaWalletBaseTotalUsd = ${JSON.stringify(totalUsd)};
    totalUsdNum = window.__luminaWalletBaseTotalUsd + (Number(window.__luminaEarnTotalUsd || 0) || 0);
    change24hUsdNum = ${JSON.stringify(changeUsd)};
    tokenChanges24h = ${JSON.stringify(changeMap)};
    tokenMarketCaps = ${JSON.stringify(marketCapMap)};
    (function(){
      try {
        var pending = window.__luminaPendingBalanceOverrides || {};
        Object.keys(pending).forEach(function(sym){
          var item = pending[sym] || {};
          var target = Number(item.amount);
          var current = Number(String(balances[sym] || "0").replace(/,/g, "").replace(/^</, ""));
          if (!Number.isFinite(target) || !Number.isFinite(current) || Date.now() > Number(item.expiresAt || 0)) {
            delete pending[sym];
            return;
          }
          var shouldHold = (item.mode === "max" && current > target + 0.0000001) || (item.mode === "min" && current + 0.0000001 < target);
          if (shouldHold) {
            balances[sym] = target.toLocaleString("en-US", { useGrouping:false, maximumFractionDigits:8 });
            availMap[sym] = balances[sym] + " " + sym;
            (assets || []).forEach(function(asset){
              if (String(asset && asset.sym || "").toUpperCase() !== sym) return;
              asset.amt = balances[sym] + " " + sym;
              var amountNum = Number(String(balances[sym]).replace(/,/g, ""));
              var price = Number(prices && prices[sym] || 0);
              if (!(price > 0) && (sym === "USDC" || sym === "USDT" || sym === "EURC")) price = 1;
              if (Number.isFinite(amountNum) && price > 0) asset.usdNum = amountNum * price;
              asset.hasBalance = amountNum > 0;
            });
          } else {
            delete pending[sym];
          }
        });
        window.__luminaPendingBalanceOverrides = pending;
      } catch(e) {}
    })();
    (function(){
      try {
        var recent = JSON.parse(localStorage.getItem("lumina_recent_swap_assets_v1") || "[]");
        if (!Array.isArray(recent)) return;
        var existing = new Set((assets || []).map(function(asset){ return String(asset && asset.sym || "").toUpperCase(); }));
        recent.forEach(function(token){
          var sym = String(token && token.symbol || "").toUpperCase();
          if (!sym || existing.has(sym)) return;
          var amount = String(token.amount || balances[sym] || "0");
          var amountNum = Number(amount.replace(/,/g, ""));
          if (!Number.isFinite(amountNum)) amountNum = 0;
          if (!tokenFull[sym]) tokenFull[sym] = token.name || sym;
          if (!tokenLogo[sym]) tokenLogo[sym] = sym.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
          if (balances[sym] === undefined) balances[sym] = amount;
          if (availMap[sym] === undefined) availMap[sym] = amount + " " + sym;
          assets.push({
            sym: sym,
            full: tokenFull[sym] || token.name || sym,
            amt: amount + " " + sym,
            usdNum: Number(token.usdNum || 0),
            cls: "custom",
            logo: tokenLogo[sym],
            contractAddress: token.contractAddr || token.address || null,
            address: token.contractAddr || token.address || null,
            custom: true,
            hasBalance: amountNum > 0,
            recentSwapAsset: true,
            homeSwapAsset: true
          });
          existing.add(sym);
        });
      } catch(e) {}
    })();
    window.__luminaOnchainPrices = ${JSON.stringify(onchainData ?? null)};
    window.__luminaMarketPrices = ${JSON.stringify(marketData ?? null)};
    if (typeof renderGainers === "function") renderGainers(window.__luminaMarketPrices);
    if (document.querySelector(".balance-change")) {
      document.querySelector(".balance-change").childNodes[0].textContent = ${JSON.stringify(formatChangePct(weightedChangePct))} + " ";
      document.querySelector(".balance-change").classList.toggle("down", ${JSON.stringify(weightedChangePct < 0)});
    }
    if (typeof renderMoney === "function") renderMoney();
    if (typeof renderAssets === "function") renderAssets();
    if (typeof window.__luminaRefreshHomeTotalFromAssets === "function") window.__luminaRefreshHomeTotalFromAssets();
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
  // Keep the last rendered balances on transient RPC/API failures.
  // A global toast here appears on Home, Earn, and Swap every refresh cycle.
}

function snapshotKey(userAddress: string | null) {
  return userAddress ? `lumina_balance_snapshot_v2:${userAddress.toLowerCase()}` : null;
}

function readBalanceSnapshot(userAddress: string | null): BalancesResponse | null {
  const key = snapshotKey(userAddress);
  if (!key) return null;
  try {
    const snapshot = JSON.parse(localStorage.getItem(key) || "null") as (BalancesResponse & { savedAt?: number }) | null;
    if (!snapshot?.balances?.length || !snapshot.savedAt) return null;
    if (Date.now() - snapshot.savedAt > 30 * 60_000) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function writeBalanceSnapshot(userAddress: string | null, balances: BalanceApiItem[]) {
  const key = snapshotKey(userAddress);
  if (!key || !balances.length) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        balances,
        cached: true,
        stale: true,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // localStorage can be unavailable in restricted WebViews.
  }
}

function formatTokenAmount(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0";
  if (parsed >= 1000) return parsed.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const maximumFractionDigits = parsed < 0.00001 ? 12 : parsed < 1 ? 8 : 6;
  const display = parsed.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits });
  if (display !== "0") return display;
  return normalized.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function runInPrototypeScope(source: string) {
  const script = document.createElement("script");
  script.text = `try { ${source} } catch (error) { console.error("Failed to sync chain balances", error); }`;
  document.body.appendChild(script);
  script.remove();
}
