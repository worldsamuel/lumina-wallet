"use client";

import Link from "next/link";
import useSWR from "swr";
import { TokenLogo } from "@/components/TokenLogo";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";
import type { BalanceApiItem } from "@/lib/chain/use-chain-balance-sync";
import type { MarketPricesResponse, OnchainPricesResponse } from "@/lib/prices";
import { getTokenBySymbol, getTokenLogoAddress } from "@/lib/tokens";

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
  const market = useSWR<MarketPricesResponse>(status === "authenticated" ? "/api/prices/market" : null, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });
  const onchain = useSWR<OnchainPricesResponse>(status === "authenticated" ? "/api/prices/onchain" : null, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  const balance = balances.data?.balances.find((item) => item.symbol.toUpperCase() === upperSymbol);
  const priceUsd = pickOnchainPrice(upperSymbol, onchain.data);
  const usdValue =
    balance && priceUsd !== null ? (Number.parseFloat(balance.formatted || "0") || 0) * priceUsd : null;
  const change24h = pickMarketChange(upperSymbol, market.data);

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
        <div className={`asset-detail-logo ${token?.className ?? ""}`}>
          <TokenLogo symbol={upperSymbol} address={getTokenLogoAddress(upperSymbol)} size={56} />
        </div>
        <h1>{token?.symbol ?? upperSymbol}</h1>
        <p>{token?.name ?? "Unsupported token"}</p>

        {balances.isLoading || market.isLoading || onchain.isLoading ? (
          <div className="asset-detail-loading">读取链上余额中...</div>
        ) : balances.error ? (
          <div className="asset-detail-error">无法读取链上数据,请稍后重试</div>
        ) : balance ? (
          <>
            <div className="asset-detail-balance">
              {formatTokenAmount(balance.formatted)} {balance.symbol}
            </div>
            <div className="asset-detail-usd">
              {usdValue === null ? "—" : `$${usdValue.toFixed(2)}`}
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

function pickOnchainPrice(symbol: string, pricesData: OnchainPricesResponse | undefined) {
  const value = pricesData?.[symbol as keyof OnchainPricesResponse];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function formatTokenAmount(value: string) {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");
  const body = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return Number(body).toLocaleString(undefined, { maximumFractionDigits: 6 });
}
