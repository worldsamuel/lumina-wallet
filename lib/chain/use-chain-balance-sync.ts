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

type PrototypeAsset = {
  sym: string;
  full: string;
  amt: string;
  usdNum: number;
  cls: string;
  logo: string;
};

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Unable to read on-chain data.");
  }
  return (await response.json()) as BalancesResponse;
};

/**
 * Polls World Chain balances and syncs them into the mounted v22 prototype runtime.
 */
export function useChainBalanceSync(enabled: boolean, userAddress: string | null) {
  const { data, error, isLoading } = useSWR(
    enabled && userAddress ? `/api/balances?address=${userAddress}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );

  useEffect(() => {
    if (!enabled) return;

    if (isLoading) {
      renderBalanceSkeleton();
      return;
    }

    if (error) {
      renderBalanceError();
      return;
    }

    if (!data?.balances) return;
    syncBalancesToPrototype(data.balances);
  }, [data, enabled, error, isLoading]);
}

function syncBalancesToPrototype(items: BalanceApiItem[]) {
  const assets = items.map((item) => {
    const formatted = formatTokenAmount(item.formatted);
    return {
      sym: item.symbol,
      full: item.name,
      amt: `${formatted} ${item.symbol}`,
      usdNum: Number.parseFloat(item.usdValue || "0") || 0,
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
  const priceMap = Object.fromEntries(items.map((item) => [item.symbol, item.priceUsd]));
  const totalUsd = assets.reduce((sum, item) => sum + item.usdNum, 0);

  runInPrototypeScope(`
    assets = ${JSON.stringify(assets)};
    balances = ${JSON.stringify(balanceMap)};
    availMap = ${JSON.stringify(availableMap)};
    prices = ${JSON.stringify(priceMap)};
    totalUsdNum = ${JSON.stringify(totalUsd)};
    change24hUsdNum = 0;
    if (typeof renderMoney === "function") renderMoney();
    if (typeof refreshSwapLabels === "function") refreshSwapLabels();
  `);
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
