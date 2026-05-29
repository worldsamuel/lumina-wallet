"use client";

import Link from "next/link";
import useSWR from "swr";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";
import type { BalanceApiItem, PricesResponse } from "@/lib/chain/use-chain-balance-sync";
import { getTokenBySymbol } from "@/lib/tokens";

type AssetPageProps = {
  symbol: string;
};

type BalancesResponse = {
  balances: BalanceApiItem[];
};

const fetcher = async <T,>(url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to read on-chain data.");
  return (await response.json()) as T;
};

/**
 * Displays a single asset using the authenticated wallet's live World Chain balance.
 */
export function AssetPage({ symbol }: AssetPageProps) {
  const upperSymbol = symbol.toUpperCase();
  const token = getTokenBySymbol(upperSymbol);
  const { address, status, login } = useWalletAuth();
  const balances = useSWR<BalancesResponse>(
    status === "authenticated" && address ? `/api/balances?address=${address}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const prices = useSWR<PricesResponse>(status === "authenticated" ? "/api/prices" : null, fetcher, {
    refreshInterval: 30_000,
  });

  const balance = balances.data?.balances.find((item) => item.symbol.toUpperCase() === upperSymbol);
  const priceUsd =
    typeof prices.data?.[upperSymbol] === "number" ? (prices.data[upperSymbol] as number) : token?.priceUsd ?? 0;
  const usdValue = balance ? (Number.parseFloat(balance.formatted || "0") || 0) * priceUsd : 0;
  const change24h = prices.data?.meta?.changes_24h?.[upperSymbol] ?? null;

  if (status === "not-installed") {
    return (
      <main className="asset-detail-screen">
        <Link className="asset-back" href="/">
          返回
        </Link>
        <section className="asset-detail-card">
          <h1>Please open this app inside World App</h1>
          <p>Lumina needs World App walletAuth before reading your balances.</p>
        </section>
      </main>
    );
  }

  if (status !== "authenticated") {
    return (
      <main className="asset-detail-screen">
        <Link className="asset-back" href="/">
          返回
        </Link>
        <section className="asset-detail-card">
          <h1>{upperSymbol}</h1>
          <p>请先登录后查看真实链上余额。</p>
          <button onClick={login}>登录</button>
        </section>
      </main>
    );
  }

  return (
    <main className="asset-detail-screen">
      <Link className="asset-back" href="/">
        返回
      </Link>
      <section className="asset-detail-card">
        <div className={`asset-detail-logo ${token?.className ?? ""}`}>{token?.logo ?? "?"}</div>
        <h1>{token?.symbol ?? upperSymbol}</h1>
        <p>{token?.name ?? "Unsupported token"}</p>

        {balances.isLoading || prices.isLoading ? (
          <div className="asset-detail-loading">读取链上余额中...</div>
        ) : balances.error ? (
          <div className="asset-detail-error">无法读取链上数据,请稍后重试</div>
        ) : balance ? (
          <>
            <div className="asset-detail-balance">
              {formatTokenAmount(balance.formatted)} {balance.symbol}
            </div>
            <div className="asset-detail-usd">
              ${usdValue.toFixed(2)}
              {change24h === null ? (
                <span> · 无 24h 行情</span>
              ) : (
                <>
                  {" "}
                  · <span className={change24h >= 0 ? "asset-up" : "asset-down"}>{formatChange(change24h)}</span> (24h)
                </>
              )}
            </div>
          </>
        ) : (
          <div className="asset-detail-error">暂不支持这个资产。</div>
        )}

        <div className="asset-detail-actions">
          <Link href="/receive">Receive</Link>
          <Link href="/send">Send</Link>
        </div>
      </section>
    </main>
  );
}

function formatChange(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTokenAmount(value: string) {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  const body = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return Number(body).toLocaleString(undefined, { maximumFractionDigits: 6 });
}
