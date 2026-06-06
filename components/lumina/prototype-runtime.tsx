"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type UTCTimestamp,
} from "lightweight-charts";
import { useSWRConfig } from "swr";
import { EarnTransactionStatus } from "@/components/EarnTransactionStatus";
import { prototypeMarkup } from "./prototype-markup";
import { prototypeScript } from "./prototype-script";
import { shortenAddress } from "@/lib/auth/store";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";
import { useBackendConfigSync } from "@/lib/backend/use-backend-config";
import { useChainBalanceSync } from "@/lib/chain/use-chain-balance-sync";
import { legalContent, type LegalPageKind } from "@/lib/legal-content";
import { executeSwap, friendlySwapError, type ExecuteSwapParams } from "@/lib/swap/execute-swap";
import { sendToken, friendlySendError, type SendParams, type SendResult } from "@/lib/transfer/sendToken";
import { TOKENS } from "@/lib/tokens";

type PrototypeRuntimeProps = {
  initialView: string;
};

declare global {
  interface Window {
    doLogout?: () => void;
    go?: (name: string) => void;
    loginBack?: () => void;
    openAnnouncements?: () => void;
    openLangModal?: () => void;
    setTabByName?: (name: string) => void;
    __luminaUserAddress?: string;
    __luminaUsername?: string;
    __luminaConfirmEarnAction?: (input: EarnConfirmInput) => Promise<boolean>;
    __luminaSendMorphoTransactions?: (
      transactions: MiniKitCalldataTransaction[],
      permit2?: MiniKitPermit2[],
      action?: EarnPendingAction,
    ) => Promise<unknown>;
    __luminaSetMorphoBusy?: (isBusy: boolean) => void;
    __luminaRefreshMorphoPositions?: () => Promise<void>;
    __luminaSendToken?: (params: SendParams) => Promise<SendResult>;
    __luminaFriendlySendError?: (error?: string) => string;
    __luminaExecuteSwap?: (params: ExecuteSwapParams) => Promise<{
      userOpHash: string;
      expectedOut: string;
      minOut: string;
    }>;
    __luminaFriendlySwapError?: (error?: unknown) => string;
    __luminaRefreshWalletData?: () => void;
    __luminaRefreshActivity?: () => void;
    __luminaAddLocalActivity?: (item: {
      type?: string;
      title?: string;
      subtitle?: string;
      amount?: string;
      status?: string;
      hash?: string;
      createdAt?: string;
    }) => void;
    __luminaRefreshImportedTokens?: () => void;
    __luminaApplyBalancePrivacy?: () => void;
    __luminaWalletBaseTotalUsd?: number;
    __luminaEarnTotalUsd?: number;
    __luminaComputeEarnTotalUsd?: () => number;
    __luminaRecomputeTotalWithEarn?: () => void;
    __luminaRenderLightweightChart?: (container: HTMLElement, candles: MarketChartCandle[], range?: string) => boolean;
    __luminaOpenLegal?: (kind: LegalPageKind) => void;
    __luminaCloseLegal?: () => void;
    __luminaOpenReceive?: () => void;
    __luminaTxToastTimer?: ReturnType<typeof setTimeout>;
    __luminaMorphoRefreshTimer?: ReturnType<typeof setInterval>;
    __luminaSwapDebugObserver?: MutationObserver;
    eruda?: { init: () => void };
    __luminaErudaInstalled?: boolean;
  }
}

type EarnConfirmInput = {
  action: "deposit" | "withdraw";
  amount: string;
  product: string;
};

type EarnPendingAction = "deposit" | "withdraw";

type MiniKitCalldataTransaction = {
  to: string;
  data: `0x${string}`;
  value?: string;
};

type MiniKitPermit2 = {
  permitted: {
    token: string;
    amount: string | unknown;
  };
  spender: string;
  nonce: string | unknown;
  deadline: string | unknown;
};

type MiniKitSendTransactionEnvelope = {
  executedWith?: string;
  data?: {
    status?: string;
    userOpHash?: string;
    error_code?: string;
    message?: string;
  };
};

type MarketChartCandle = {
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type LightweightChartHandle = {
  remove: () => void;
  resizeObserver?: ResizeObserver;
};

const lightweightCharts = new WeakMap<HTMLElement, LightweightChartHandle>();

const tabByView: Record<string, string> = {
  home: "Home",
  detail: "Home",
  allassets: "Home",
  receive: "Home",
  send: "Home",
  swap: "Swap",
  activity: "Activity",
  earn: "Earn",
  "earn-detail": "Earn",
  me: "Me",
  backup: "Me",
  pin: "Me",
  level: "Me",
  apps: "Me",
  help: "Me",
  about: "Me",
};

/**
 * Mounts the v22 prototype inside React while preserving the original Mini App visuals and interactions.
 */
export function PrototypeRuntime({ initialView }: PrototypeRuntimeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [prototypeReady, setPrototypeReady] = useState(false);
  const [dataSyncReady, setDataSyncReady] = useState(false);
  const [earnUserOpHash, setEarnUserOpHash] = useState("");
  const [swapUserOpHash, setSwapUserOpHash] = useState("");
  const [earnPendingAction, setEarnPendingAction] = useState<EarnPendingAction>("deposit");
  const { address, error, login, logout, status, username } = useWalletAuth();
  const { mutate } = useSWRConfig();
  useBackendConfigSync(true);
  useChainBalanceSync(status === "authenticated" && prototypeReady && dataSyncReady, address);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "authenticated") return;

    installMobileConsole();
    setPrototypeReady(false);
    host.innerHTML = prototypeMarkup;
    const scriptEl = document.createElement("script");
    scriptEl.text = prototypeScript;
    host.appendChild(scriptEl);
    resetPrototypePortfolio();
    installLegalSheet(host);
    exposeTokenTransfer(address, mutate);
    exposeEarnWalletConfirm();
    exposeMorphoTransactions();

    requestAnimationFrame(() => {
      updatePrototypeAddress(host, address, username);
      if (initialView === "detail") {
        (window as unknown as { openDetail?: (index: number) => void }).openDetail?.(0);
      } else if (initialView === "earn-detail") {
        (window as unknown as { openEarn?: (index: number) => void }).openEarn?.(0);
      } else {
        const targetView = document.getElementById(`view-${initialView}`) ? initialView : "home";
        window.go?.(targetView);
      }
      window.setTabByName?.(tabByView[initialView] ?? "Home");
      appendLegalLinks(host);
      wireRealReceiveLinks(host);
      enhancePrototypeDetail();
      enhancePrototypeEarn();
      enhancePrototypeTokens();
      enhancePrototypeBuiltinTokenLogos();
      enhancePrototypeHome();
      enhancePrototypeMarket();
      installLightweightChartRenderer();
      enhancePrototypeSwapQuote();
      enhancePrototypeSend();
      enhancePrototypeActivity();
      enhancePrototypeMe();
      enhancePrototypeSystemConfig();
      enhancePrototypeAnalytics();
      if (initialView === "allassets") {
        (window as unknown as { openAllAssets?: () => void }).openAllAssets?.();
      }
      setPrototypeReady(true);
    });

    window.loginBack = () => {
      void login();
    };
    window.doLogout = () => {
      void logout();
    };

    return () => {
      setPrototypeReady(false);
      host.innerHTML = "";
    };
  }, [address, initialView, login, logout, mutate, status, username]);

  useEffect(() => {
    if (status !== "authenticated" || !prototypeReady) {
      setDataSyncReady(false);
      return;
    }
    const timer = window.setTimeout(() => setDataSyncReady(true), 450);
    return () => window.clearTimeout(timer);
  }, [prototypeReady, status]);

  useEffect(() => {
    if (hostRef.current) updatePrototypeAddress(hostRef.current, address);
  }, [address, status]);

  useEffect(() => {
    const handleEarnUserOp = (event: Event) => {
      const detail = (event as CustomEvent<{ userOpHash?: string; action?: EarnPendingAction }>).detail;
      if (detail?.action) setEarnPendingAction(detail.action);
      if (detail?.userOpHash) setEarnUserOpHash(detail.userOpHash);
    };
    const handleSwapUserOp = (event: Event) => {
      const detail = (event as CustomEvent<{ userOpHash?: string }>).detail;
      if (detail?.userOpHash) setSwapUserOpHash(detail.userOpHash);
    };
    window.addEventListener("lumina:earn-userop", handleEarnUserOp);
    window.addEventListener("lumina:swap-userop", handleSwapUserOp);
    return () => {
      window.removeEventListener("lumina:earn-userop", handleEarnUserOp);
      window.removeEventListener("lumina:swap-userop", handleSwapUserOp);
    };
  }, []);

  const handleEarnReceiptSuccess = useCallback(() => {
    window.__luminaSetMorphoBusy?.(false);
    window.__luminaRefreshWalletData?.();
    void window.__luminaRefreshMorphoPositions?.();
    if (address) void mutate(`/api/morpho/position/${address}`);
    setEarnUserOpHash("");
    toastFromPrototype(earnPendingAction === "withdraw" ? prototypeText("withdrawSuccess") : prototypeText("depositSuccess"));
  }, [address, earnPendingAction, mutate]);

  const handleEarnReceiptError = useCallback((receiptError?: Error) => {
    window.__luminaSetMorphoBusy?.(false);
    setEarnUserOpHash("");
    const message = receiptError?.message ?? "";
    toastFromPrototype(isCancellationMessage(message) ? prototypeText("transactionCancelled") : localizedTransactionFailure("earn"));
  }, []);

  const handleSwapReceiptSuccess = useCallback(() => {
    setSwapUserOpHash("");
    window.setTimeout(() => window.__luminaRefreshWalletData?.(), 6500);
    toastFromPrototype(prototypeText("swapSuccess"));
    window.dispatchEvent(new CustomEvent("lumina:swap-confirmed"));
  }, []);

  const handleSwapReceiptError = useCallback((receiptError?: Error) => {
    setSwapUserOpHash("");
    const message = receiptError?.message ?? prototypeText("transactionFailed");
    toastFromPrototype(isCancellationMessage(message) ? prototypeText("transactionCancelled") : localizedTransactionFailure("swap"));
    window.dispatchEvent(new CustomEvent("lumina:swap-failed", { detail: { message: receiptError?.message } }));
  }, []);

  if (status === "not-installed") {
    return <WorldAppPrompt />;
  }

  if (status === "checking" || status === "authenticating") {
    return <AuthLoading />;
  }

  if (status === "error") {
    return <AuthError message={error ?? "Wallet authentication failed."} onRetry={login} />;
  }

  return (
    <>
      <div ref={hostRef} />
      {earnUserOpHash ? (
        <EarnTransactionStatus
          userOpHash={earnUserOpHash}
          onSuccess={handleEarnReceiptSuccess}
          onError={handleEarnReceiptError}
        />
      ) : null}
    </>
  );
}

function installMobileConsole() {
  if (typeof window === "undefined" || window.__luminaErudaInstalled) return;
  const debugAllowed = process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true";
  if (!debugAllowed) return;
  window.__luminaErudaInstalled = true;

  const existing = document.getElementById("lumina-eruda-script") as HTMLScriptElement | null;
  if (existing) return;

  const script = document.createElement("script");
  script.id = "lumina-eruda-script";
  script.src = "https://cdn.jsdelivr.net/npm/eruda@3/eruda.min.js";
  script.async = true;
  script.onload = () => {
    try {
      window.eruda?.init();
      console.log("=== ERUDA READY ===");
    } catch (error) {
      console.log("Failed to initialize Eruda", error);
    }
  };
  document.head.appendChild(script);
}

function installLightweightChartRenderer() {
  if (typeof window === "undefined") return;

  window.__luminaRenderLightweightChart = (container, candles, range = "1D") => {
    const data = normalizeMarketCandles(candles);
    if (!container || data.length < 2) return false;

    try {
      const existing = lightweightCharts.get(container);
      existing?.resizeObserver?.disconnect();
      existing?.remove();
      lightweightCharts.delete(container);
      container.replaceChildren();

      const width = Math.max(280, container.clientWidth || 360);
      const height = Math.max(210, container.clientHeight || 230);
      const chart = createChart(container, {
        width,
        height,
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: "rgba(3, 5, 5, 0)" },
          textColor: "#8f969f",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,0.025)" },
          horzLines: { color: "rgba(255,255,255,0.055)" },
        },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: "rgba(74,222,128,0.22)", labelBackgroundColor: "#151b18" },
          horzLine: { color: "rgba(74,222,128,0.18)", labelBackgroundColor: "#151b18" },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: { top: 0.08, bottom: 0.26 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: range === "1H" || range === "1D",
          secondsVisible: false,
          rightOffset: 2,
          barSpacing: range === "1H" ? 11 : range === "1D" ? 9 : 7,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        localization: {
          priceFormatter: formatChartAxisPrice,
        },
        handleScroll: false,
        handleScale: false,
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#14d89a",
        downColor: "#ff4d64",
        borderUpColor: "#14d89a",
        borderDownColor: "#ff4d64",
        wickUpColor: "#72ffd0",
        wickDownColor: "#ff8795",
        priceLineVisible: true,
        lastValueVisible: true,
      });
      candleSeries.setData(data.map(({ volume: _volume, ...candle }) => candle));

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      volumeSeries.setData(
        data.map((candle) => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? "rgba(20,216,154,0.38)" : "rgba(255,77,100,0.38)",
        })),
      );
      chart.priceScale("").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      chart.timeScale().fitContent();

      const resizeObserver = new ResizeObserver(() => {
        const nextWidth = Math.max(280, container.clientWidth || width);
        const nextHeight = Math.max(210, container.clientHeight || height);
        chart.applyOptions({ width: nextWidth, height: nextHeight });
        chart.timeScale().fitContent();
      });
      resizeObserver.observe(container);
      lightweightCharts.set(container, {
        remove: () => chart.remove(),
        resizeObserver,
      });
      return true;
    } catch (error) {
      console.error("Failed to render Lightweight Chart", error);
      return false;
    }
  };
}

function normalizeMarketCandles(candles: MarketChartCandle[]) {
  const byTime = new Map<number, { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number }>();
  for (const candle of candles) {
    const rawTimestamp = Number(candle.timestamp ?? 0);
    const time = Math.floor(rawTimestamp > 9_999_999_999 ? rawTimestamp / 1000 : rawTimestamp);
    const open = Number(candle.open ?? 0);
    const high = Number(candle.high ?? 0);
    const low = Number(candle.low ?? 0);
    const close = Number(candle.close ?? 0);
    const volume = Math.max(0, Number(candle.volume ?? 0));
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    byTime.set(time, {
      time: time as UTCTimestamp,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume,
    });
  }
  return [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

function formatChartAxisPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 1 : 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

      function toastFromPrototype(message: string) {
        const toast = (window as unknown as { toast?: (text: string) => void }).toast;
        if (toast) toast(message);
      }

function prototypeText(key: "depositSuccess" | "withdrawSuccess" | "depositFailed" | "withdrawFailed" | "swapSuccess" | "swapFailed" | "transactionFailed" | "transactionCancelled") {
  const lang = (window as unknown as { currentLang?: string }).currentLang || "en";
  const copy = {
    depositSuccess: { en: "Deposit successful", "zh-CN": "存入成功", "zh-TW": "存入成功" },
    withdrawSuccess: { en: "Withdrawal successful", "zh-CN": "提现成功", "zh-TW": "提領成功" },
    depositFailed: { en: "Deposit failed", "zh-CN": "存入失败", "zh-TW": "存入失敗" },
    withdrawFailed: { en: "Withdrawal failed", "zh-CN": "提现失败", "zh-TW": "提領失敗" },
    swapSuccess: { en: "Swap successful", "zh-CN": "兑换成功", "zh-TW": "兌換成功" },
    swapFailed: { en: "Swap failed", "zh-CN": "交易失败", "zh-TW": "交易失敗" },
    transactionFailed: { en: "Transaction failed", "zh-CN": "交易失败", "zh-TW": "交易失敗" },
    transactionCancelled: { en: "Transaction cancelled", "zh-CN": "交易已取消", "zh-TW": "交易已取消" },
  } as const;
  return (copy[key] as Record<string, string>)[lang] ?? copy[key].en;
}

function localizedTransactionFailure(kind: "earn" | "swap") {
  const labels = transactionStatusLabels(kind);
  return `${labels.errorPrefix}. ${labels.timeout}`;
}

function transactionStatusLabels(kind: "earn" | "swap", forcedLang?: string) {
  const lang = forcedLang || (window as unknown as { currentLang?: string }).currentLang || "en";
  const copy = {
    swap: {
      success: { en: "Swap successful", "zh-CN": "兑换成功", "zh-TW": "兌換成功" },
      errorPrefix: { en: "Swap failed", "zh-CN": "交易失败", "zh-TW": "交易失敗" },
      loading: {
        en: "Waiting for on-chain confirmation...",
        "zh-CN": "等待区块链确认...",
        "zh-TW": "等待區塊鏈確認...",
      },
      submitted: { en: "Swap transaction submitted", "zh-CN": "兑换交易已提交", "zh-TW": "兌換交易已提交" },
      timeout: {
        en: "Check Activity for details.",
        "zh-CN": "请到活动页查看详情。",
        "zh-TW": "請到活動頁查看詳情。",
      },
    },
    earn: {
      success: { en: "Transaction successful", "zh-CN": "交易成功", "zh-TW": "交易成功" },
      errorPrefix: { en: "Transaction failed", "zh-CN": "交易失败", "zh-TW": "交易失敗" },
      loading: {
        en: "Waiting for on-chain confirmation...",
        "zh-CN": "等待区块链确认...",
        "zh-TW": "等待區塊鏈確認...",
      },
      submitted: { en: "Transaction submitted", "zh-CN": "交易已提交", "zh-TW": "交易已提交" },
      timeout: {
        en: "Check Activity for details.",
        "zh-CN": "请到活动页查看详情。",
        "zh-TW": "請到活動頁查看詳情。",
      },
    },
  }[kind];

  const pick = (key: keyof typeof copy) => copy[key][lang as keyof (typeof copy)[typeof key]] ?? copy[key].en;
  return {
    success: pick("success"),
    errorPrefix: pick("errorPrefix"),
    loading: pick("loading"),
    submitted: pick("submitted"),
    timeout: pick("timeout"),
  };
}

function isCancellationMessage(message: string) {
  return /cancel|reject|rejected|user_rejected|取消/i.test(message);
}

function exposeEarnWalletConfirm() {
  window.__luminaConfirmEarnAction = async ({ action, amount, product }) => {
    const message = `Lumina Earn ${action}: ${amount} into ${product}`;
    if (new URL(window.location.href).searchParams.get("mockWorld") === "1") {
      return window.confirm(message);
    }

    const miniKit = MiniKit as unknown as {
      signMessage?: (input: { message: string }) => Promise<unknown>;
    };
    if (!miniKit.signMessage) {
      return window.confirm(message);
    }

    try {
      const result = await miniKit.signMessage({ message });
      return !JSON.stringify(result).toLowerCase().includes("error");
    } catch {
      return false;
    }
  };
}

function exposeMorphoTransactions() {
  window.__luminaSendMorphoTransactions = async (transactions, permit2, action: EarnPendingAction = "deposit") => {
    void permit2;
    if (new URL(window.location.href).searchParams.get("mockWorld") === "1") {
      const userOpHash = `0xmock${Date.now().toString(16)}`;
      window.dispatchEvent(new CustomEvent("lumina:earn-userop", { detail: { userOpHash, action } }));
      return { data: { status: "success", userOpHash } };
    }

    const miniKit = MiniKit as unknown as {
      sendTransaction?: (input: {
        chainId: number;
        transactions?: MiniKitCalldataTransaction[];
      }) => Promise<unknown>;
    };
    if (!miniKit.sendTransaction) throw new Error("MiniKit sendTransaction is unavailable.");

    console.log("[EARN A1] Before MiniKit.sendTransaction");
    console.log("[EARN A1] typeof MiniKit.sendTransaction:", typeof MiniKit.sendTransaction);
    console.log("[EARN] About to call MiniKit.sendTransaction");
    console.log(
      "[EARN] payload:",
      JSON.stringify(
        {
          chainId: 480,
          transactions,
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );
    const startTime = Date.now();
    let result: MiniKitSendTransactionEnvelope;
    try {
      result = (await miniKit.sendTransaction({
        chainId: 480,
        transactions,
      })) as MiniKitSendTransactionEnvelope;
      console.log("[EARN A2] returned after", Date.now() - startTime, "ms");
      console.log("[EARN A2] result full:", JSON.stringify(result, null, 2));
      console.log("[EARN A2] result.data:", result?.data);
      console.log("[EARN A2] result.data.userOpHash:", result?.data?.userOpHash);
      console.log("[EARN] result:", JSON.stringify(result));
    } catch (error) {
      const err = error as { name?: unknown; message?: unknown };
      console.log("[EARN A3] threw after", Date.now() - startTime, "ms");
      console.log("[EARN A3] name:", err?.name);
      console.log("[EARN A3] message:", err?.message);
      console.log("[EARN A3] full:", JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
      throw error;
    } finally {
      console.log("[EARN A4] finally");
    }

    const payload = result?.data;
    if (payload?.status && payload.status !== "success") {
      throw new Error(payload.error_code || payload.message || "Transaction was not submitted.");
    }
    if (payload?.error_code) throw new Error(payload.error_code);
    const userOpHash = payload?.userOpHash;
    if (!userOpHash) {
      throw new Error(`No userOpHash returned: ${JSON.stringify(result)}`);
    }
    void fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "earn",
        address: window.__luminaUserAddress || null,
        hash: userOpHash,
        amount: action,
        status: "completed",
        metadata: { action },
      }),
    }).catch((error) => console.warn("[ACTIVITY] Failed to record earn", error));
    window.__luminaAddLocalActivity?.({
      type: "in",
      title: "Earn",
      subtitle: "Vault",
      amount: action,
      status: "Completed",
      hash: userOpHash,
    });
    window.dispatchEvent(new CustomEvent("lumina:earn-userop", { detail: { userOpHash, action } }));
    return result;
  };
}

function exposeTokenTransfer(
  address: string | null,
  mutate: ReturnType<typeof useSWRConfig>["mutate"],
) {
  window.__luminaFriendlySendError = friendlySendError;
  window.__luminaSendToken = async (params) => sendToken(params);
  window.__luminaFriendlySwapError = friendlySwapError;
  window.__luminaExecuteSwap = async (params) => executeSwap(params);
  window.__luminaRefreshWalletData = () => {
    if (address) void mutate(`/api/balances?address=${address}`);
    void mutate("/api/prices/market");
    void mutate("/api/prices/onchain");
    window.__luminaRefreshImportedTokens?.();
    window.__luminaRefreshActivity?.();
  };
}

/**
 * Clears prototype demo balances before live chain data arrives so stale placeholder money never flashes.
 */
function resetPrototypePortfolio() {
  const source = `
    assets = [
      { sym: "WLD", full: "Worldcoin", amt: "0 WLD", usdNum: 0, cls: "wld", logo: "", address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" },
      { sym: "USDC", full: "USD Coin", amt: "0 USDC", usdNum: 0, cls: "usdc", logo: "", address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" },
      { sym: "USDT", full: "Tether USD", amt: "0 USDT", usdNum: 0, cls: "usdt", logo: "$", address: "0x102d758f688a4c1c5a80b116bd945d4455460282" },
      { sym: "ETH", full: "Ether", amt: "0 ETH", usdNum: 0, cls: "eth", logo: "E", address: "0x4200000000000000000000000000000000000006" },
      { sym: "BTC", full: "Bitcoin", amt: "0 BTC", usdNum: 0, cls: "btc", logo: "B", marketOnly: true, address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3" }
    ];
    balances = { WLD: "0", USDC: "0", USDT: "0", ETH: "0", BTC: "0" };
    availMap = { WLD: "0 WLD", USDC: "0 USDC", USDT: "0 USDT", ETH: "0 ETH", BTC: "0 BTC" };
    totalUsdNum = 0;
    change24hUsdNum = 0;
    if (document.querySelector(".balance-change")) {
      document.querySelector(".balance-change").childNodes[0].textContent = "+0.00% ";
      document.querySelector(".balance-change").classList.remove("down");
    }
    if (typeof renderMoney === "function") renderMoney();
    var subEl = document.getElementById("balSub");
    if (subEl && typeof formatMoney === "function") subEl.textContent = "+" + formatMoney(0) + " (24h)";
  `;
  runInPrototypeScope(source, "Failed to reset prototype portfolio");
}

/**
 * Fullscreen prompt shown when the Mini App is opened outside World App.
 */
function WorldAppPrompt() {
  return (
    <main className="mini-auth-screen">
      <div className="mini-auth-logo">L</div>
      <h1>Please open this app inside World App</h1>
      <p>Lumina uses World MiniKit walletAuth to identify your World App wallet.</p>
    </main>
  );
}

/**
 * Fullscreen loading state while walletAuth is running.
 */
function AuthLoading() {
  return (
    <main className="mini-auth-screen mini-auth-loading">
      <div className="mini-auth-grid" aria-hidden="true" />
      <div className="mini-auth-logo-stage">
        <div className="mini-auth-orb" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="mini-auth-logo mini-auth-logo-live">L</div>
      </div>
      <div className="mini-auth-copy">
        <h1>Connecting Lumina</h1>
        <p>Confirm wallet authentication in World App.</p>
        <div className="mini-auth-progress" aria-hidden="true">
          <div className="mini-auth-progress-fill" />
        </div>
      </div>
      <div className="mini-auth-steps" aria-hidden="true">
        <span><i />World App session</span>
        <span><i />Wallet signature</span>
        <span><i />World Chain sync</span>
      </div>
    </main>
  );
}

/**
 * Fullscreen retry state for walletAuth failures.
 */
function AuthError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="mini-auth-screen">
      <div className="mini-auth-logo">L</div>
      <h1>Login failed</h1>
      <p>{message}</p>
      <button onClick={onRetry}>Try again</button>
    </main>
  );
}

function updatePrototypeAddress(host: HTMLDivElement, address: string | null, username?: string | null) {
  window.__luminaUserAddress = address ?? "";
  window.__luminaUsername = username ?? "";
  const label = shortenAddress(address);
  const displayName = username || label;
  const chipLabel = host.querySelector(".addr-chip span:nth-child(2)");
  if (chipLabel) chipLabel.textContent = label;
  const meName = host.querySelector(".me-name");
  if (meName) {
    meName.innerHTML =
      displayName +
      ' <span class="v"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.4 1.7 2.9-.3 1.2 2.7 2.7 1.2-.3 2.9L23 12l-1.7 2.4.3 2.9-2.7 1.2-1.2 2.7-2.9-.3L12 23l-2.4-1.7-2.9.3-1.2-2.7-2.7-1.2.3-2.9L1 12l1.7-2.4-.3-2.9 2.7-1.2L6.3 2.7l2.9.3z"/><path d="M10.5 15.2l-2.7-2.7 1.4-1.4 1.3 1.3 4-4 1.4 1.4z" fill="#000"/></svg></span>';
  }
  const meAddr = host.querySelector(".me-addr");
  if (meAddr) meAddr.textContent = label;
}

/**
 * Adds public legal document links to the prototype About view without rewriting the source HTML string.
 */
function appendLegalLinks(host: HTMLDivElement) {
  const aboutContent = host.querySelector("#aboutContent");
  if (!aboutContent || aboutContent.querySelector(".legal-link-card")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "article legal-link-card";
  wrapper.innerHTML = [
    "<h2>Legal</h2>",
    "<p>Review Lumina's public legal documents for World Mini App review and user transparency.</p>",
    '<button class="legal-link-row" type="button" data-legal-kind="privacy">Privacy Policy <span aria-hidden="true">›</span></button>',
    '<button class="legal-link-row" type="button" data-legal-kind="terms">Terms of Service <span aria-hidden="true">›</span></button>',
  ].join("");
  aboutContent.appendChild(wrapper);
  wrapper.querySelectorAll<HTMLButtonElement>("[data-legal-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      window.__luminaOpenLegal?.(button.dataset.legalKind as LegalPageKind);
    });
  });
}

function escapeLegalText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function legalDocumentHtml(kind: LegalPageKind) {
  const doc = legalContent[kind].en;
  const sections = doc.sections
    .map(
      (section) =>
        `<section class="lumina-legal-section"><h3>${escapeLegalText(section.title)}</h3>${section.body
          .map((paragraph) => `<p>${escapeLegalText(paragraph)}</p>`)
          .join("")}</section>`,
    )
    .join("");

  return [
    `<div class="lumina-legal-kicker">${kind === "privacy" ? "How Lumina handles your data" : "Rules for using Lumina"}</div>`,
    `<h2>${escapeLegalText(doc.title)}</h2>`,
    `<p class="lumina-legal-subtitle">${escapeLegalText(doc.subtitle)}</p>`,
    `<div class="lumina-legal-date">Effective date: ${escapeLegalText(doc.effectiveDate)}</div>`,
    sections,
    `<div class="lumina-legal-updated">Last updated: ${escapeLegalText(doc.lastUpdated)}</div>`,
  ].join("");
}

function installLegalSheet(host: HTMLDivElement) {
  if (document.getElementById("luminaLegalSheet")) return;

  const sheet = document.createElement("div");
  sheet.id = "luminaLegalSheet";
  sheet.className = "lumina-legal-sheet";
  sheet.innerHTML = [
    '<div class="lumina-legal-panel" role="dialog" aria-modal="true" aria-label="Lumina legal document">',
    '<div class="lumina-legal-panel-top"><button class="lumina-legal-close" type="button" aria-label="Back"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>Back</button><div class="lumina-legal-logo">L</div></div>',
    '<div class="lumina-legal-content"></div>',
    "</div>",
  ].join("");
  host.appendChild(sheet);

  const content = sheet.querySelector<HTMLElement>(".lumina-legal-content");
  const close = () => {
    sheet.classList.remove("open");
    document.body.classList.remove("lumina-legal-open");
  };

  window.__luminaCloseLegal = close;
  window.__luminaOpenLegal = (kind) => {
    if (!content) return;
    content.innerHTML = legalDocumentHtml(kind === "terms" ? "terms" : "privacy");
    sheet.classList.add("open");
    document.body.classList.add("lumina-legal-open");
  };

  sheet.querySelector<HTMLButtonElement>(".lumina-legal-close")?.addEventListener("click", close);
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) close();
  });
}

function stableReceiveQr(address: string) {
  let seed = 0;
  for (let i = 0; i < address.length; i += 1) seed = (seed * 31 + address.charCodeAt(i)) >>> 0;
  const size = 29;
  const cell = 8;
  const blocks: string[] = [];
  const finder = (x: number, y: number) => {
    blocks.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell * 7}" height="${cell * 7}" fill="#000"/>`);
    blocks.push(`<rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${cell * 5}" height="${cell * 5}" fill="#fff"/>`);
    blocks.push(`<rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${cell * 3}" height="${cell * 3}" fill="#000"/>`);
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder =
        (x < 8 && y < 8) ||
        (x >= size - 8 && y < 8) ||
        (x < 8 && y >= size - 8);
      if (inFinder) continue;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      if (((seed >>> 29) ^ x ^ y) % 3 === 0) {
        blocks.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="#000"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 ${size * cell} ${size * cell}" aria-hidden="true">${blocks.join("")}</svg>`;
}

function renderPrototypeReceive(address?: string | null) {
  const actual = address || window.__luminaUserAddress || "";
  const qr = document.getElementById("qrBox");
  if (qr && actual) {
    const cachedKey = `lumina:qr:${actual.toLowerCase()}`;
    let svg = "";
    try { svg = localStorage.getItem(cachedKey) || ""; } catch(e) {}
    if (!svg) {
      svg = stableReceiveQr(actual);
      try { localStorage.setItem(cachedKey, svg); } catch(e) {}
    }
    qr.innerHTML = svg;
  }
  const addr = document.querySelector<HTMLElement>(".recv-addr");
  if (addr && actual) addr.textContent = actual;
  const note = document.querySelector<HTMLElement>(".recv-note");
  if (note) note.innerHTML = "Send only World Chain assets to this address.<br />Assets sent from other networks may be lost.";
  const copy = document.querySelector<HTMLButtonElement>(".copy-btn");
  if (copy) copy.textContent = "Copy address";
}

/**
 * Keeps receive inside the already-authenticated prototype so it opens instantly.
 */
function wireRealReceiveLinks(host: HTMLDivElement) {
  renderPrototypeReceive(window.__luminaUserAddress);
  window.__luminaOpenReceive = () => {
    renderPrototypeReceive(window.__luminaUserAddress);
    window.go?.("receive");
    window.setTabByName?.("Home");
  };
  host
    .querySelectorAll<HTMLElement>("[onclick*=\"go('receive')\"], [onclick*='go(\"receive\")']")
    .forEach((el) => {
      el.onclick = (event) => {
        event.preventDefault();
        window.__luminaOpenReceive?.();
      };
    });
}

/**
 * Loads token logos from backend config first, then trusted remote token-list assets.
 */
function enhancePrototypeBuiltinTokenLogos() {
  const source = `
    (function(){
      var trustLogoAddresses = {
        WLD: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
        USDC: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
        USDT: "0x102d758f688a4c1c5a80b116bd945d4455460282",
        ETH: "0x4200000000000000000000000000000000000006",
        WETH: "0x4200000000000000000000000000000000000006",
        WBTC: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3",
        EURC: "0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B",
        ORO: "0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63",
        ORB: "0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db",
        LIFE: "0xE4D62e62013EaF065Fa3F0316384F88559C80889",
        WGEM: "0xAC794B2a7F81e5778f3733AF00901d4c6Ee2A740",
        HUB: "0xd469fDA5d9522A093760902e9bE51e0c5D822D26",
        USOL: "0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55"
      };
      var logoUrlsBySymbol = {};
      function htmlEscape(value){
        return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      }
      function initial(symbol){
        return String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
      }
      function fallbackInitial(symbol, fallback){
        var sym = String(symbol || "").toUpperCase();
        var name = "";
        try { name = String((tokenFull && tokenFull[sym]) || ""); } catch(e) {}
        var source = String(name || fallback || sym || "?").trim();
        var word = source.split(/\\s+/)[0] || source;
        return '<span class="token-logo-fallback">' + htmlEscape(initial(word)) + '</span>';
      }
      function isLogoUrl(url){
        return /^https?:\\/\\//i.test(String(url || ""));
      }
      function readLogoConfig(){
        logoUrlsBySymbol = {};
        function ingest(list){
          if (!Array.isArray(list)) return;
          list.forEach(function(token){
            var sym = String(token && token.symbol || "").toUpperCase();
            var url = token && token.logoUrl;
            if (sym && isLogoUrl(url)) logoUrlsBySymbol[sym] = String(url);
          });
        }
        try { ingest(JSON.parse(localStorage.getItem("ww_top_tokens") || "[]")); } catch(e) {}
        try { ingest(JSON.parse(localStorage.getItem("ww_tokens") || "[]")); } catch(e) {}
      }
      function logoImg(symbol, url, fallbackUrl){
        var sym = String(symbol || "").toUpperCase();
        var fallback = isLogoUrl(fallbackUrl) ? String(fallbackUrl) : "";
        return "<img class=\\"lumina-token-img\\" src=\\"" + htmlEscape(url) + "\\" alt=\\"" + htmlEscape(sym) + " logo\\" loading=\\"eager\\" decoding=\\"async\\" fetchpriority=\\"high\\" data-fallback=\\"" + htmlEscape(fallback) + "\\" data-initial=\\"" + htmlEscape(fallbackInitial(sym, '')) + "\\" onerror=\\"if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.outerHTML=this.dataset.initial||'';}\\"/>";
      }
      function trustedLogoUrl(symbol){
        var sym = String(symbol || "").toUpperCase();
        var address = trustLogoAddresses[sym];
        if (!address) return "";
        return "https://assets-cdn.trustwallet.com/blockchains/worldchain/assets/" + address + "/logo.png";
      }
      function ethTrustLogoUrl(symbol){
        var sym = String(symbol || "").toUpperCase();
        var address = trustLogoAddresses[sym];
        if (!address) return "";
        return "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/" + address + "/logo.png";
      }
      readLogoConfig();
      window.__luminaSetTokenLogoUrl = function(symbol, url){
        var sym = String(symbol || "").toUpperCase();
        if (sym && isLogoUrl(url)) logoUrlsBySymbol[sym] = String(url);
      };
      window.__luminaTokenLogoHtml = function(symbol, fallback){
        var sym = String(symbol || "").toUpperCase();
        var configured = logoUrlsBySymbol[sym];
        if (configured) return logoImg(sym, configured, "");
        return fallbackInitial(sym, fallback);
      };
      window.__luminaRefreshTokenLogos = function(){
        readLogoConfig();
        tokenLogo.WLD = window.__luminaTokenLogoHtml("WLD", "");
        tokenLogo.USDC = window.__luminaTokenLogoHtml("USDC", "");
        tokenLogo.USDT = window.__luminaTokenLogoHtml("USDT", "");
        tokenLogo.ETH = window.__luminaTokenLogoHtml("ETH", "");
        tokenLogo.BTC = window.__luminaTokenLogoHtml("BTC", "");
        tokenLogo.WETH = window.__luminaTokenLogoHtml("WETH", tokenLogo.ETH || "");
        tokenLogo.WBTC = window.__luminaTokenLogoHtml("WBTC", "");
        tokenLogo.EURC = window.__luminaTokenLogoHtml("EURC", "");
        tokenLogo.ORO = window.__luminaTokenLogoHtml("ORO", "O");
        tokenLogo.ORB = window.__luminaTokenLogoHtml("ORB", "O");
        tokenLogo.LIFE = window.__luminaTokenLogoHtml("LIFE", "L");
        tokenLogo.WGEM = window.__luminaTokenLogoHtml("WGEM", "W");
        tokenLogo.HUB = window.__luminaTokenLogoHtml("HUB", "H");
        tokenLogo.USOL = window.__luminaTokenLogoHtml("USOL", "S");
        if (typeof renderAssets === "function") renderAssets();
        if (typeof renderTokenList === "function") {
          var search = document.getElementById("tkSearch");
          if (search) renderTokenList(search.value || "");
        }
      };
      tokenFull.USDT = tokenFull.USDT || "Tether USD";
      window.__luminaRefreshTokenLogos();
      dotColor.WLD = "#fff";
      dotColor.USDC = "var(--blue)";
      dotColor.USDT = "#26a17b";
      dotColor.ETH = "#1c2536";
      dotColor.WETH = "#1c2536";
      dotColor.WBTC = "#f7931a";
      dotColor.EURC = "#2775ca";
      dotColor.ORO = "linear-gradient(135deg,#203020,#314633)";
      dotColor.ORB = "linear-gradient(135deg,#203020,#314633)";
      dotColor.USOL = "linear-gradient(135deg,#1d2d28,#2f5f4d)";
      prices.USDT = prices.USDT || 1;
      balances.USDT = balances.USDT || "0";
      availMap.USDT = availMap.USDT || "0 USDT";
      if (typeof selectSendToken === "function") {
        selectSendToken = function(sym){
          sendCurrentToken = sym;
          var ic = document.getElementById("sendTokIc");
          var symEl = document.getElementById("sendTokSym");
          var fullEl = document.getElementById("sendTokFull");
          if(!ic) return;
          ic.innerHTML = window.__luminaTokenLogoHtml(sym, tokenLogo[sym]);
          ic.className = "coin " + String(sym || "").toLowerCase();
          ic.style.background = dotColor[sym] || "var(--surface-2)";
          ic.style.color = (sym === "WLD") ? "#000" : "#fff";
          symEl.textContent = sym;
          fullEl.textContent = tokenFull[sym] || sym;
          var avail = availMap[sym];
          if(!avail){
            var b = (typeof balances !== "undefined" && balances[sym]) ? balances[sym] : "0";
            avail = b + " " + sym;
          }
          var at = document.getElementById("availTxt");
          if(at) at.textContent = t("available") + ": " + avail;
        };
      }
      if (typeof renderTokenList === "function") {
        function pickerVerifyBadge(sym){
          var market = window.__luminaMarketBySymbol && window.__luminaMarketBySymbol[sym];
          var meta = customTokens && customTokens[sym];
          var status = String((market && market.status) || (meta && meta.status) || "").toLowerCase();
          if (status === "verified") return '<span class="custom-badge status-dot verified" title="Verified" aria-label="Verified"></span>';
          if (status === "rejected" || status === "high" || status === "danger") return '<span class="custom-badge status-dot danger" title="High risk" aria-label="High risk"></span>';
          if (status === "pending" || status === "community" || status === "unverified") return '<span class="custom-badge status-dot warn" title="Unverified" aria-label="Unverified"></span>';
          if ((market && market.verified === true) || (!status && !customTokens[sym])) return '<span class="custom-badge status-dot verified" title="Verified" aria-label="Verified"></span>';
          return '<span class="custom-badge status-dot warn" title="Unverified" aria-label="Unverified"></span>';
        }
        renderTokenList = function(filter){
          filter = (filter || "").toLowerCase();
          var rows = Object.keys(prices).filter(function(sym){
            if (!filter) return true;
            return sym.toLowerCase().indexOf(filter) >= 0 || (tokenFull[sym]||"").toLowerCase().indexOf(filter) >= 0;
          }).map(function(sym){
            var badge = pickerVerifyBadge(sym);
            var color = sym === "WLD" ? "#000" : "#fff";
            return '<div class="tk-row" data-token-symbol="' + sym + '" onclick="pickToken(\\'' + sym + '\\')"><div class="ic coin ' + String(sym).toLowerCase() + '" style="background:' + (dotColor[sym] || "var(--surface-2)") + ';color:' + color + '">' + window.__luminaTokenLogoHtml(sym, tokenLogo[sym]) + '</div><div class="mid"><div class="s">' + sym + badge + '</div><div class="f">' + (tokenFull[sym] || sym) + '</div></div><div class="bal">' + (balances[sym] || "0") + '</div></div>';
          }).join('');
          document.getElementById("tokenModalList").innerHTML = rows || '<div class="import-load">No matching tokens. Paste a contract address to run safety checks.</div>';
        };
      }
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance built-in token logos");
}

function enhancePrototypeEarn() {
  const source = `
    (function(){
      var activeEarnIndex = 0;
      var morphoVaults = [];
      var morphoPositions = [];
      var morphoLoading = true;
      var morphoError = "";
      var morphoStarted = false;

      function riskClass(level){
        return level === "medium" ? "mid" : (level || "low");
      }
      function riskText(level){
        var key = riskClass(level);
        if (typeof riskKey !== "undefined" && riskKey[key]) return t(riskKey[key]);
        return key.charAt(0).toUpperCase() + key.slice(1);
      }
      function fmtPct(value){
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return (n * 100).toFixed(2) + "%";
      }
      function fmtCompactUsd(value){
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
      }
      function fmtAmount(value, max){
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: max || 6 });
      }
      function systemConfig(){
        try { return JSON.parse(localStorage.getItem("ww_system_config") || "{}"); } catch(e) { return {}; }
      }
      function positionFor(vault){
        return morphoPositions.find(function(p){
          return String(p.vaultAddress).toLowerCase() === String(vault.address).toLowerCase();
        }) || null;
      }
      function vaultIcon(vault){
        if (vault && vault.imageUrl) return '<img src="' + escapeHtml(vault.imageUrl) + '" alt="">';
        var sym = vault && vault.asset ? vault.asset.symbol : "?";
        var fallback = sym ? sym.charAt(0).toUpperCase() : "?";
        if (window.__luminaTokenLogoHtml) return window.__luminaTokenLogoHtml(sym, fallback);
        return fallback;
      }
      function vaultDesc(vault){
        var lang = window.currentLang || "en";
        return (vault.description && (vault.description[lang] || vault.description.en)) || "";
      }
      function updateEarnHero(){
        var zh = (window.currentLang || "en") === "zh-CN";
        var totalEl = document.getElementById("earnTotal");
        if (totalEl) {
          var active = morphoPositions.filter(function(p){ return Number(p.assetsFormatted || 0) > 0; }).length;
          totalEl.textContent = active ? String(active) : "0";
        }
        var sub = document.querySelector(".earn-hero .sub");
        if (sub) sub.textContent = morphoError || (zh ? "Re7 理财金库" : "Re7 yield vaults");
        var claim = document.querySelector(".earn-hero .claim");
        if (claim) {
          claim.disabled = morphoLoading;
          claim.textContent = morphoLoading ? (zh ? "加载中" : "Loading") : (zh ? "刷新" : "Refresh");
          claim.onclick = function(){ loadMorphoData(true); };
        }
      }
      function nonZeroPosition(pos){
        return !!pos && String(pos.assets || pos.shares || "0") !== "0";
      }
      function renderHomeEarningPositions(){
        var assetList = document.getElementById("assetList");
        if (!assetList) return;
        var existing = document.getElementById("homeEarningSection");
        var positions = morphoPositions.filter(nonZeroPosition);
        if (!positions.length) {
          if (existing) existing.remove();
          return;
        }
        if (!existing) {
          var section = document.createElement("div");
          section.id = "homeEarningSection";
          section.innerHTML =
            '<div class="section-head"><h2>Earning</h2><span class="link" onclick="go(\\'earn\\'); setTabByName(\\'Earn\\')">View</span></div>' +
            '<div class="assets" id="homeEarningList"></div>';
          assetList.insertAdjacentElement("afterend", section);
          existing = section;
        }
        var box = document.getElementById("homeEarningList");
        if (!box) return;
        box.innerHTML = positions.map(function(pos){
          var vault = morphoVaults.find(function(v){
            return String(v.address).toLowerCase() === String(pos.vaultAddress).toLowerCase();
          }) || pos;
          var sym = pos.asset && pos.asset.symbol ? pos.asset.symbol : (vault.asset && vault.asset.symbol) || "";
          var amount = fmtAmount(pos.assetsFormatted, 6);
          var price = typeof prices !== "undefined" ? Number(prices[sym] || 0) : 0;
          var usd = price ? " ≈ " + formatMoney(Number(pos.assetsFormatted || 0) * price) : "";
          var apy = vault.liveData ? " · " + fmtPct(vault.liveData.netApy) + " APY" : "";
          var idx = morphoVaults.findIndex(function(v){
            return String(v.address).toLowerCase() === String(pos.vaultAddress).toLowerCase();
          });
          return '<div class="asset" onclick="openEarn(' + Math.max(idx, 0) + ')">' +
            '<div class="coin morpho-vault-ic">' + vaultIcon(vault) + '</div>' +
            '<div class="name"><div class="sym">' + amount + " " + sym + '</div><div class="full">in ' + (vault.displayName || pos.displayName || "Earn Vault") + usd + apy + '</div></div>' +
            '<div class="vals"><div class="amt">Earn</div><div class="usd">' + (usd ? usd.replace(" ≈ ", "") : "—") + '</div></div>' +
          '</div>';
        }).join('');
      }

      renderProducts = function(){
        var box = document.getElementById("prodList");
        if (!box) return;
        if (morphoLoading && !morphoVaults.length) {
          box.innerHTML = [0,1,2,3].map(function(){
            return '<div class="prod morpho-skeleton"><div class="top"><div class="ic"></div><div class="nm"><div class="t"></div><div class="d"></div></div><div class="apy"><div class="v"></div><div class="l"></div></div></div><div class="meta"><div class="m"></div><div class="m"></div><div class="m"></div></div></div>';
          }).join('');
          updateEarnHero();
          return;
        }
        if (morphoError && !morphoVaults.length) {
          box.innerHTML = '<div class="import-load">Unable to load Morpho vaults. Pull to refresh later.</div>';
          updateEarnHero();
          return;
        }
        box.innerHTML = morphoVaults.map(function(vault, i){
          var pos = positionFor(vault);
          var deposited = pos ? fmtAmount(pos.assetsFormatted, 6) + " " + vault.asset.symbol : "—";
          var apy = vault.liveData ? fmtPct(vault.liveData.netApy) : "—";
          return '<div class="prod" onclick="openEarn(' + i + ')">' +
            '<div class="top">' +
              '<div class="ic morpho-vault-ic">' + vaultIcon(vault) + '</div>' +
              '<div class="nm"><div class="t">' + vault.displayName + '</div><div class="d">' + vaultDesc(vault) + '</div></div>' +
              '<div class="apy"><div class="v">' + apy + '</div><div class="l">APY <button class="apy-info-btn" onclick="event.stopPropagation(); showMorphoApyInfo()">i</button></div></div>' +
            '</div>' +
            '<div class="meta">' +
              '<div class="m"><div class="k">' + t("risk") + '</div><div class="val"><span class="risk ' + riskClass(vault.riskLevel) + '">' + riskText(vault.riskLevel) + '</span></div></div>' +
              '<div class="m"><div class="k">My deposit</div><div class="val">' + deposited + '</div></div>' +
              '<div class="m"><div class="k">TVL</div><div class="val">' + (vault.liveData ? fmtCompactUsd(vault.liveData.totalAssetsUsd) : "—") + '</div></div>' +
            '</div></div>';
        }).join('');
        updateEarnHero();
        renderHomeEarningPositions();
      };

      window.showMorphoApyInfo = function(){
        toast("APY includes Morpho rewards and updates daily");
      };

      function morphoCopy(key){
        var lang = window.currentLang || "en";
        var copy = {
          waitingConfirm: { en:"Waiting for on-chain confirmation...", "zh-CN":"等待区块链确认...", "zh-TW":"等待區塊鏈確認...", fr:"En attente de confirmation on-chain...", de:"Warten auf On-chain-Bestätigung...", es:"Esperando confirmación on-chain...", ja:"オンチェーン確認待ち..." },
          depositFailed: { en:"Deposit failed", "zh-CN":"存入失败", "zh-TW":"存入失敗", fr:"Échec du dépôt", de:"Einzahlung fehlgeschlagen", es:"Depósito fallido", ja:"預入に失敗しました" },
          withdrawFailed: { en:"Withdrawal failed", "zh-CN":"提现失败", "zh-TW":"提領失敗", fr:"Échec du retrait", de:"Auszahlung fehlgeschlagen", es:"Retiro fallido", ja:"引出に失敗しました" },
          cancelled: { en:"Cancelled in World App", "zh-CN":"已在 World App 取消", "zh-TW":"已在 World App 取消", fr:"Annulé dans World App", de:"In World App abgebrochen", es:"Cancelado en World App", ja:"World App でキャンセル済み" }
        };
        return (copy[key] && (copy[key][lang] || copy[key].en)) || key;
      }

      function setMorphoBusy(isBusy){
        ["morphoDepositBtn"].forEach(function(id){
          var btn = document.getElementById(id);
          if (!btn) return;
          btn.disabled = !!isBusy;
          btn.textContent = isBusy ? "Submitting..." : "Deposit";
        });
      }
      window.__luminaSetMorphoBusy = setMorphoBusy;

      function confirmMorphoDeposit(message){
        return new Promise(function(resolve){
          var old = document.getElementById("morphoConfirmMask");
          if (old) old.remove();
          var mask = document.createElement("div");
          mask.className = "modal-mask open morpho-confirm-modal";
          mask.id = "morphoConfirmMask";
          mask.innerHTML =
            '<div class="modal"><div class="modal-grip"></div><h3>Confirm deposit</h3>' +
            '<p class="morpho-confirm-body">' + message + '</p>' +
            '<div class="earn-action-row"><button class="btn-ghost" id="morphoConfirmCancel">Cancel</button><button class="btn-primary" id="morphoConfirmOk">Confirm deposit</button></div></div>';
          document.body.appendChild(mask);
          function done(value){
            mask.remove();
            resolve(value);
          }
          mask.onclick = function(event){ if (event.target === mask) done(false); };
          document.getElementById("morphoConfirmCancel").onclick = function(){ done(false); };
          document.getElementById("morphoConfirmOk").onclick = function(){ done(true); };
        });
      }

      function renderEarnDetail(vault){
        var token = vault.asset.symbol;
        var pos = positionFor(vault);
        var deposited = pos ? fmtAmount(pos.assetsFormatted, 6) + " " + token : "—";
        var copy = {
          deposited: "Deposited ",
          amount: "Amount",
          wallet: "Wallet balance",
          yearly: "Estimated yearly yield",
          daily: "Estimated daily yield",
          fee: "Fee",
          provider: "Provider",
          curator: "Re7 Labs (Vault curator)",
          deposit: "Deposit",
          withdraw: "Withdraw",
          pausedTitle: "Deposits paused",
          pausedBody: "Emergency pause is active. Existing positions can still withdraw.",
          aboutTitle: "ⓘ About this product",
          aboutBody: "Powered by Morpho Protocol (morpho.org), curated by Re7 Labs. Lumina is a third-party wallet interface and does not custody your assets. Your funds are deposited into a Morpho Vault smart contract earning yield from lending markets. Smart contracts have been audited by Spearbit and OpenZeppelin, but all DeFi protocols carry technical risk (smart contract bugs, oracle failures, etc). APY varies in real-time and is not guaranteed. You can withdraw anytime, subject to vault liquidity."
        };
        document.getElementById("edMine").textContent = copy.deposited + deposited;
        var card = document.getElementById("earnActionCard");
        if (!card) {
          card = document.createElement("div");
          card.id = "earnActionCard";
          card.className = "earn-action-card";
          var desc = document.getElementById("edDesc");
          desc.insertAdjacentElement("afterend", card);
        }
        var cfg = systemConfig();
        var paused = !!vault.depositsPaused || cfg.morphoDepositEnabled === false;
        var wallet = pos ? fmtAmount(pos.walletBalanceFormatted, 6) + " " + token : "—";
        console.log("[EARN] Detail vault:", vault);
        console.log("[EARN] Detail position:", pos);
        console.log("[EARN] My deposit assets:", pos ? pos.assets : "0");
        console.log("[EARN] My deposit human:", pos ? pos.assetsFormatted : "0");
        console.log("[EARN] Withdraw disabled:", !pos || Number(pos.shares || 0) <= 0);
        var annual = "—";
        var daily = "—";
        var amount = "";
        card.innerHTML =
          '<label>' + copy.amount + '</label>' +
          '<div class="earn-amount-row"><input id="earnAmountInput" inputmode="decimal" placeholder="0.00" /><span>' + token + '</span></div>' +
          '<div class="morpho-estimates">' +
            '<div><span>' + copy.wallet + '</span><strong>' + wallet + '</strong></div>' +
            '<div><span>' + copy.yearly + '</span><strong id="morphoAnnual">' + annual + '</strong></div>' +
            '<div><span>' + copy.daily + '</span><strong id="morphoDaily">' + daily + '</strong></div>' +
            '<div><span>' + copy.fee + '</span><strong>0</strong></div>' +
            '<div><span>' + copy.provider + '</span><strong>Morpho</strong></div>' +
          '</div>' +
          '<div class="morpho-provider-note">' + copy.curator + '</div>' +
          '<div class="earn-action-row">' +
            '<button class="btn-primary" id="morphoDepositBtn" ' + (paused ? "disabled" : "") + ' onclick="depositMorpho()">' + copy.deposit + '</button>' +
            '<button class="btn-ghost" id="morphoWithdrawBtn" ' + (!pos || Number(pos.shares || 0) <= 0 ? "disabled" : "") + ' onclick="openMorphoWithdrawModal()">' + copy.withdraw + '</button>' +
          '</div>' +
          (paused ? '<div class="earn-dev-note"><strong>' + copy.pausedTitle + '</strong><span>' + (cfg.morphoDepositEnabled === false ? "Deposits are temporarily paused by Lumina operations." : copy.pausedBody) + '</span></div>' : "") +
          '<div class="morpho-compliance">' +
            '<strong>' + copy.aboutTitle + '</strong>' +
            '<p>' + copy.aboutBody + '</p>' +
          '</div>';
        var bottomBtn = document.querySelector("#view-earn-detail > .send-submit");
        if (bottomBtn) {
          bottomBtn.remove();
        }
        var input = document.getElementById("earnAmountInput");
        var annualEl = document.getElementById("morphoAnnual");
        var dailyEl = document.getElementById("morphoDaily");
        function updateEstimate(){
          amount = input ? input.value : "";
          var n = Number(String(amount).replace(/,/g, ""));
          var apy = Number(vault.liveData && vault.liveData.netApy);
          if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(apy)) {
            if (annualEl) annualEl.textContent = "—";
            if (dailyEl) dailyEl.textContent = "—";
            return;
          }
          if (annualEl) annualEl.textContent = fmtAmount(n * apy, 6) + " " + token;
          if (dailyEl) dailyEl.textContent = fmtAmount(n * apy / 365, 8) + " " + token;
        }
        if (input) input.oninput = updateEstimate;
        updateEstimate();
      }

      if (!window.__luminaEarnLangPatch && typeof chooseLang === "function") {
        window.__luminaEarnLangPatch = true;
        var originalChooseLang = chooseLang;
        chooseLang = function(code){
          originalChooseLang(code);
          var detailActive = document.getElementById("view-earn-detail");
          if (detailActive && detailActive.classList.contains("active") && morphoVaults[activeEarnIndex]) {
            renderEarnDetail(morphoVaults[activeEarnIndex]);
          }
        };
      }

      openEarn = function(i){
        activeEarnIndex = i;
        var p = morphoVaults[i];
        if (!p) return;
        document.getElementById("edTitle").textContent = p.displayName;
        var ic = document.getElementById("edIc");
        ic.innerHTML = vaultIcon(p);
        ic.className = "ed-ic morpho-vault-ic";
        document.getElementById("edApy").textContent = p.liveData ? fmtPct(p.liveData.netApy) : "—";
        document.getElementById("edRisk").innerHTML = '<span class="risk ' + riskClass(p.riskLevel) + '">' + riskText(p.riskLevel) + '</span>';
        document.getElementById("edLock").textContent = "Anytime, subject to vault liquidity";
        document.getElementById("edTvl").textContent = p.liveData ? fmtCompactUsd(p.liveData.totalAssetsUsd) : "—";
        document.getElementById("edMin").textContent = "0.000001 " + p.asset.symbol;
        document.getElementById("edDesc").textContent = vaultDesc(p);
        renderEarnDetail(p);
        go("earn-detail"); setTabByName("Earn");
      };

      window.depositMorpho = async function(){
        var vault = morphoVaults[activeEarnIndex];
        var input = document.getElementById("earnAmountInput");
        var amount = input ? String(input.value || "").trim() : "";
        var n = Number(amount.replace(/,/g, ""));
        var pos = vault ? positionFor(vault) : null;
        if (!vault || !Number.isFinite(n) || n <= 0) return toast("Enter an amount");
        if (vault.depositsPaused) return toast("Deposits are temporarily paused. Withdrawals remain available.");
        if (pos && Number(pos.walletBalanceFormatted || 0) < n) return toast("Insufficient " + vault.asset.symbol + " balance");
        var apy = vault.liveData ? fmtPct(vault.liveData.netApy) : "—";
        var confirmed = await confirmMorphoDeposit("You are depositing " + amount + " " + vault.asset.symbol + " into " + vault.displayName + " Vault. Current APY " + apy + ".");
        if (!confirmed) return;
        var awaitingReceipt = false;
        try {
          setMorphoBusy(true);
          console.log("[EARN] Selected vault:", vault);
          console.log("[EARN] Asset address:", vault.asset && vault.asset.address);
          console.log("[EARN] Asset decimals:", vault.asset && vault.asset.decimals);
          console.log("[EARN] Vault address:", vault.address);
          console.log("[EARN] Amount human:", amount);
          var res = await fetch("/api/morpho/tx", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "deposit", vaultAddress: vault.address, amount: amount, userAddress: window.__luminaUserAddress || "" })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || "Unable to build transaction");
          console.log("[EARN] Amount wei:", data.debug && data.debug.amountWei);
          console.log("[EARN] built tx:", JSON.stringify(data));
          var result = await window.__luminaSendMorphoTransactions(data.transactions, data.permit2, "deposit");
          var payload = result && result.data;
          var hash = payload && payload.userOpHash;
          if (!hash) throw new Error("No userOpHash: " + JSON.stringify(result));
          awaitingReceipt = true;
          toast(morphoCopy("waitingConfirm") + " " + String(hash).slice(0, 18));
        } catch(e) {
          console.error("[EARN] error:", e);
          var msg = e && e.message ? e.message : "Deposit failed";
          if (/user_rejected/i.test(msg)) msg = morphoCopy("cancelled");
          toast(morphoCopy("depositFailed") + ": " + msg);
        } finally {
          if (!awaitingReceipt) setMorphoBusy(false);
        }
      };

      window.luminaEarnAction = async function(action){
        if (action === "withdraw") return window.openMorphoWithdrawModal();
        return window.depositMorpho();
      };

      window.openMorphoWithdrawModal = function(){
        var vault = morphoVaults[activeEarnIndex];
        var pos = vault ? positionFor(vault) : null;
        if (!vault || !pos || Number(pos.shares || 0) <= 0) return;
        closeModal();
        var mask = document.createElement("div");
        mask.className = "modal-mask open morpho-withdraw-modal";
        mask.id = "morphoWithdrawMask";
        var available = fmtAmount(pos.maxWithdrawFormatted, 6);
        var deposited = fmtAmount(pos.assetsFormatted, 6);
        mask.innerHTML =
          '<div class="modal">' +
            '<div class="grab"></div>' +
            '<div class="withdraw-sheet-head">' +
              '<div><p>Withdraw</p><h3>' + vault.displayName + '</h3></div>' +
              '<button type="button" class="withdraw-close" onclick="closeMorphoWithdrawModal()">×</button>' +
            '</div>' +
            '<div class="withdraw-summary">' +
              '<div><span>Deposited</span><strong>' + deposited + " " + vault.asset.symbol + '</strong></div>' +
              '<div><span>Available</span><strong>' + available + " " + vault.asset.symbol + '</strong></div>' +
            '</div>' +
            '<label class="withdraw-label">Amount</label>' +
            '<div class="earn-amount-row withdraw-amount-row"><input id="morphoWithdrawAmount" inputmode="decimal" placeholder="0.00" /><span>' + vault.asset.symbol + '</span><button type="button" onclick="fillMorphoWithdrawMax()">MAX</button></div>' +
            '<div class="withdraw-help">Funds return to your World Chain wallet after confirmation.</div>' +
            '<div class="earn-action-row withdraw-action-row"><button class="btn-primary" onclick="submitMorphoWithdraw(false)">Withdraw amount</button><button class="btn-ghost" onclick="submitMorphoWithdraw(true)">Withdraw all</button></div>' +
            '<button class="sheet-cancel withdraw-cancel" onclick="closeMorphoWithdrawModal()">Cancel</button>' +
          '</div>';
        document.body.appendChild(mask);
      };

      window.fillMorphoWithdrawMax = function(){
        var vault = morphoVaults[activeEarnIndex];
        var pos = vault ? positionFor(vault) : null;
        var input = document.getElementById("morphoWithdrawAmount");
        if (input && pos) input.value = String(pos.maxWithdrawFormatted || "0");
      };

      window.closeMorphoWithdrawModal = function(){
        var mask = document.getElementById("morphoWithdrawMask");
        if (mask) mask.remove();
      };

      window.submitMorphoWithdraw = async function(all){
        var vault = morphoVaults[activeEarnIndex];
        var pos = vault ? positionFor(vault) : null;
        var input = document.getElementById("morphoWithdrawAmount");
        if (!vault || !pos) return;
        var body = { type: all ? "redeem" : "withdraw", vaultAddress: vault.address, userAddress: window.__luminaUserAddress || "" };
        if (all) {
          body.shares = pos.shares;
        } else {
          var amount = input ? String(input.value || "").trim() : "";
          var n = Number(amount.replace(/,/g, ""));
          if (!Number.isFinite(n) || n <= 0) return toast("Enter an amount");
          if (n > Number(pos.maxWithdrawFormatted || 0)) return toast("Vault liquidity is low. Try a smaller amount later.");
          body.amount = amount;
        }
        try {
          var res = await fetch("/api/morpho/tx", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || "Unable to build transaction");
          var result = await window.__luminaSendMorphoTransactions(data.transactions, undefined, "withdraw");
          var payload = result && result.data;
          var hash = payload && payload.userOpHash;
          if (!hash) throw new Error("No userOpHash: " + JSON.stringify(result));
          closeMorphoWithdrawModal();
          toast(morphoCopy("waitingConfirm") + " " + String(hash).slice(0, 18));
        } catch(e) {
          var msg = e && e.message ? e.message : "Withdraw failed";
          if (/liquid|withdraw/i.test(msg)) msg = "Vault liquidity is low. Try a smaller amount later.";
          toast(morphoCopy("withdrawFailed") + ": " + msg);
        }
      };

      function closeModal(){
        if (typeof window.closeMorphoWithdrawModal === "function") window.closeMorphoWithdrawModal();
      }

      async function loadMorphoVaults(){
        var res = await fetch("/api/morpho/vaults", { cache: "no-store" });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load vaults");
        morphoVaults = Array.isArray(data) ? data : [];
      }
      function updateHomeEarnTotal(){
        var compute = typeof window.__luminaComputeEarnTotalUsd === "function" ? window.__luminaComputeEarnTotalUsd : null;
        if (compute) {
          window.__luminaEarnTotalUsd = compute();
        } else {
          window.__luminaEarnTotalUsd = (morphoPositions || []).filter(nonZeroPosition).reduce(function(sum, pos){
            var sym = pos.asset && pos.asset.symbol ? String(pos.asset.symbol).toUpperCase() : "";
            var vault = morphoVaults.find(function(v){
              return String(v.address).toLowerCase() === String(pos.vaultAddress).toLowerCase();
            });
            if (!sym && vault && vault.asset) sym = String(vault.asset.symbol || "").toUpperCase();
            var price = sym === "USDC" || sym === "USDT" || sym === "EURC" ? 1 : Number(prices && prices[sym] || 0);
            var amount = Number(pos.assetsFormatted || 0);
            return sum + (Number.isFinite(amount) && price > 0 ? amount * price : 0);
          }, 0);
        }
        if (typeof window.__luminaRecomputeTotalWithEarn === "function") window.__luminaRecomputeTotalWithEarn();
      }
      async function loadMorphoPositions(){
        var address = window.__luminaUserAddress || "";
        if (!address) {
          morphoPositions = [];
          window.__luminaEarnTotalUsd = 0;
          if (typeof window.__luminaRecomputeTotalWithEarn === "function") window.__luminaRecomputeTotalWithEarn();
          return;
        }
        var res = await fetch("/api/morpho/position/" + address, { cache: "no-store" });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load positions");
        morphoPositions = Array.isArray(data.positions) ? data.positions : [];
        updateHomeEarnTotal();
        console.log("[EARN] Positions address:", address);
        console.log("[EARN] Positions response:", data);
      }
      window.__luminaRefreshMorphoPositions = async function(){
        await loadMorphoPositions();
        renderProducts();
        renderHomeEarningPositions();
        if (document.getElementById("view-earn-detail") && document.getElementById("view-earn-detail").classList.contains("active")) {
          openEarn(activeEarnIndex);
        }
      };
      async function loadMorphoData(force){
        morphoStarted = true;
        morphoLoading = true;
        morphoError = "";
        renderProducts();
        try {
          await loadMorphoVaults();
          try { await loadMorphoPositions(); } catch(e) {}
        } catch(e) {
          morphoError = "Unable to load live vault data";
        } finally {
          morphoLoading = false;
          renderProducts();
          renderHomeEarningPositions();
          if (document.getElementById("view-earn-detail") && document.getElementById("view-earn-detail").classList.contains("active")) {
            openEarn(activeEarnIndex);
          }
          if (force) toast(morphoError || "Updated");
        }
      }
      function pollMorphoPositions(){
        var tries = 0;
        var timer = setInterval(async function(){
          tries += 1;
          try {
            await window.__luminaRefreshMorphoPositions();
          } catch(e) {}
          if (tries >= 6) clearInterval(timer);
        }, 5000);
      }
      if (!window.__luminaMorphoRefreshTimer) {
        window.__luminaMorphoRefreshTimer = setInterval(function(){
          if (!window.__luminaUserAddress) return;
          if (!morphoStarted) return;
          window.__luminaRefreshMorphoPositions().catch(function(e){
            console.log("[EARN] Periodic position refresh failed:", e);
          });
        }, 20000);
      }

      openClaimModal = function(){
        loadMorphoData(true);
      };

      if (!window.__luminaEarnGoWrapped && typeof go === "function") {
        window.__luminaEarnGoWrapped = true;
        var previousEarnGo = go;
        go = function(name){
          previousEarnGo(name);
          if ((name === "earn" || name === "earn-detail") && !morphoStarted) {
            setTimeout(function(){ loadMorphoData(false); }, 60);
          }
        };
      }
      var earnView = document.getElementById("view-earn");
      var earnDetailView = document.getElementById("view-earn-detail");
      if ((earnView && earnView.classList.contains("active")) || (earnDetailView && earnDetailView.classList.contains("active"))) {
        loadMorphoData(false);
      } else {
        setTimeout(function(){ loadMorphoData(false); }, 800);
      }
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance Earn prototype");
}

function enhancePrototypeSystemConfig() {
  const source = `
    (function(){
      function readConfig(){
        try { return JSON.parse(localStorage.getItem("ww_system_config") || "{}"); } catch(e) { return {}; }
      }
      window.__luminaApplySystemConfig = function(){
        var existing = document.getElementById("luminaMaintenanceOverlay");
        var cfg = readConfig();
        if (cfg.faviconUrl) {
          var fav = document.querySelector("link[rel='icon']") || document.createElement("link");
          fav.setAttribute("rel", "icon");
          fav.setAttribute("href", cfg.faviconUrl);
          if (!fav.parentNode) document.head.appendChild(fav);
        }
        if (cfg.adminLogoUrl) {
          document.querySelectorAll(".brand .logo, .lumina-legal-logo, .mini-auth-logo, .maintenance-logo").forEach(function(el){
            el.innerHTML = '<img src="' + String(cfg.adminLogoUrl).replace(/"/g, "&quot;") + '" alt="Lumina" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block;" />';
          });
        }
        if (typeof window.__luminaRenderMe === "function") window.__luminaRenderMe();
        if (!cfg.maintenance) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;
        var overlay = document.createElement("div");
        overlay.id = "luminaMaintenanceOverlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:#030503;display:flex;align-items:center;justify-content:center;padding:28px;color:#fff;text-align:center;";
        var mark = cfg.adminLogoUrl
          ? '<img src="' + String(cfg.adminLogoUrl).replace(/"/g, "&quot;") + '" alt="Lumina" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />'
          : "L";
        overlay.innerHTML = '<div style="max-width:320px;"><div class="maintenance-logo" style="width:74px;height:74px;margin:0 auto 22px;border-radius:50%;border:2px solid #6ee787;display:flex;align-items:center;justify-content:center;color:#6ee787;font-size:34px;font-weight:900;box-shadow:0 0 40px rgba(74,222,128,.22);overflow:hidden;">' + mark + '</div><h1 style="font-size:30px;line-height:1.05;margin:0 0 12px;font-weight:950;">Lumina is under maintenance</h1><p style="margin:0;color:#9ca39c;font-size:15px;line-height:1.55;">We are updating the service. Please check back shortly.</p></div>';
        document.body.appendChild(overlay);
      };
      window.__luminaApplySystemConfig();
    })();
  `;
  runInPrototypeScope(source, "Failed to apply system config");
}

function enhancePrototypeAnalytics() {
  const source = `
    (function(){
      if (window.__luminaAnalyticsStarted) return;
      window.__luminaAnalyticsStarted = true;
      function send(event){
        try {
          fetch("/api/analytics", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: event, path: location.pathname }),
            keepalive: true
          }).catch(function(){});
        } catch(e) {}
      }
      send("open");
      var originalGo = typeof go === "function" ? go : null;
      if (originalGo) {
        go = function(name){
          originalGo(name);
          send("visit");
        };
      }
    })();
  `;
  runInPrototypeScope(source, "Failed to install analytics");
}

/**
 * Replaces prototype token import mocks with live ERC-20 metadata and a risk-aware all-assets view.
 */
function enhancePrototypeTokens() {
  const source = `
    (function(){
      var importStoreKey = "lumina_imported_tokens_v1";
      var hiddenStoreKey = "lumina_hidden_risk_tokens_v1";
      var recentSwapStoreKey = "lumina_recent_swap_assets_v1";

      function readJson(key, fallback){
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch(e) { return fallback; }
      }
      function writeJson(key, value){
        try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
      }
      function tokenInitial(symbol){
        symbol = String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase();
        return symbol || "?";
      }
      function riskLabel(score){
        if (score === "high") return "High risk";
        if (score === "mid") return "Risk";
        return "Verified";
      }
      function riskClass(score){
        return score === "high" ? "high" : (score === "mid" ? "mid" : "low");
      }
      function formatImportedAmount(value){
        var n = Number.parseFloat(String(value || "0"));
        if (!Number.isFinite(n) || n === 0) return "0";
        var digits = Math.abs(n) < 0.00001 ? 12 : Math.abs(n) < 1 ? 8 : 6;
        var display = n.toLocaleString("en-US", { useGrouping:false, maximumFractionDigits: digits });
        return display === "0" ? String(value).replace(/,/g, "").replace(/(\\.\\d*?[1-9])0+$/, "$1").replace(/\\.0+$/, "") : display;
      }
      function importedList(){
        var list = readJson(importStoreKey, []);
        if (!Array.isArray(list)) return [];
        var whitelist = whitelistedAddresses();
        return list.filter(function(token){
          var address = String(token && token.address || "").toLowerCase();
          return !address || !whitelist.has(address);
        });
      }
      function isCleanSwapSymbol(symbol){
        symbol = String(symbol || "").toUpperCase();
        return !!symbol && symbol !== "23" && /[A-Z]/.test(symbol);
      }
      function sortedSwapSymbols(symbols){
        var pinned = ["WLD","USDC","USDT","WETH","WBTC","EURC"];
        var seen = new Set();
        return (symbols || []).filter(function(sym){
          sym = String(sym || "").toUpperCase();
          if (!isCleanSwapSymbol(sym) || seen.has(sym)) return false;
          seen.add(sym);
          return true;
        }).sort(function(a, b){
          var ia = pinned.indexOf(a);
          var ib = pinned.indexOf(b);
          if (ia >= 0 || ib >= 0) return (ia >= 0 ? ia : 999) - (ib >= 0 ? ib : 999);
          var ba = Number(String(balances && balances[a] || "0").replace(/,/g, "")) || 0;
          var bb = Number(String(balances && balances[b] || "0").replace(/,/g, "")) || 0;
          if (ba !== bb) return bb - ba;
          return String(tokenFull[a] || a).localeCompare(String(tokenFull[b] || b));
        });
      }
      function whitelistedAddresses(){
        var out = new Set();
        ["ww_tokens", "ww_swap_tokens", "ww_top_tokens"].forEach(function(key){
          var list = readJson(key, []);
          if (!Array.isArray(list)) return;
          list.forEach(function(token){
            var address = String(token && (token.contractAddr || token.address) || "").toLowerCase();
            if (/^0x[a-f0-9]{40}$/.test(address)) out.add(address);
          });
        });
        return out;
      }
      function backendTokensBySymbol(){
        var out = {};
        [readJson("ww_tokens", []), readJson("ww_swap_tokens", []), readJson("ww_top_tokens", [])].forEach(function(list){
          if (!Array.isArray(list)) return;
          list.forEach(function(token){
            var symbol = String(token && token.symbol || "").toUpperCase();
            if (symbol && !out[symbol]) out[symbol] = token;
          });
        });
        return out;
      }
      function swapWhitelistTokens(){
        var source = [];
        var backendBySymbol = backendTokensBySymbol();
        var builtin = [
          { symbol:"WLD", name:"Worldcoin", contractAddr:"0x2cFc85d8E48F8EAB294be644d9E25C3030863003", decimals:18, logoUrl:null },
          { symbol:"USDC", name:"USD Coin", contractAddr:"0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", decimals:6, logoUrl:null },
          { symbol:"USDT", name:"Tether USD", contractAddr:"0x102d758f688a4c1c5a80b116bd945d4455460282", decimals:6, logoUrl:null },
          { symbol:"WETH", name:"WETH", contractAddr:"0x4200000000000000000000000000000000000006", decimals:18, logoUrl:null },
          { symbol:"WBTC", name:"Wrapped Bitcoin", contractAddr:"0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3", decimals:8, logoUrl:null },
          { symbol:"EURC", name:"EURC", contractAddr:"0xE75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0", decimals:6, logoUrl:null },
          { symbol:"ORO", name:"ORO", contractAddr:"0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63", decimals:18, logoUrl:null },
          { symbol:"ORB", name:"Orb", contractAddr:"0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db", decimals:18, logoUrl:null },
          { symbol:"LIFE", name:"LIFE", contractAddr:"0xE4D62e62013EaF065Fa3F0316384F88559C80889", decimals:18, logoUrl:null },
          { symbol:"WGEM", name:"World GEM", contractAddr:"0xAC794B2a7F81e5778f3733AF00901d4c6Ee2A740", decimals:18, logoUrl:null },
          { symbol:"HUB", name:"Human Unique Bridge", contractAddr:"0xd469fDA5d9522A093760902e9bE51e0c5D822D26", decimals:18, logoUrl:null },
          { symbol:"USOL", name:"Wrapped Solana (Universal)", contractAddr:"0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55", decimals:18, logoUrl:null }
        ];
        [readJson("ww_swap_tokens", []), readJson("ww_tokens", []), readJson("ww_top_tokens", []), builtin].forEach(function(list){
          if (Array.isArray(list)) source.push.apply(source, list);
        });
        var seen = new Set();
        return source.filter(function(token){
          var symbol = String(token && token.symbol || "").toUpperCase();
          if (!isCleanSwapSymbol(symbol)) return false;
          var configured = backendBySymbol[symbol];
          if (configured) {
            token = Object.assign({}, token, configured);
            if (configured.status && configured.status !== "verified") return false;
          }
          if (token.status && token.status !== "verified") return false;
          if (token.canSwap === false) return false;
          var address = String(token.contractAddr || token.address || "").toLowerCase();
          var key = /^0x[a-f0-9]{40}$/.test(address) ? address : "native:" + symbol;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      function registerBackendToken(token){
        var symbol = String(token.symbol || "").toUpperCase();
        if (!symbol || symbol === "23") return "";
        window.__luminaBackendTokenBySymbol = window.__luminaBackendTokenBySymbol || {};
        window.__luminaBackendTokenBySymbol[symbol] = token;
        window.__luminaMarketBySymbol = window.__luminaMarketBySymbol || {};
        var existingMarket = window.__luminaMarketBySymbol[symbol] || {};
        var status = String(token.status || existingMarket.status || "pending").toLowerCase();
        window.__luminaMarketBySymbol[symbol] = Object.assign({}, existingMarket, {
          symbol: symbol,
          name: token.name || existingMarket.name || symbol,
          address: token.contractAddr || token.address || existingMarket.address || null,
          poolAddress: token.poolAddress || existingMarket.poolAddress || "",
          decimals: token.decimals || existingMarket.decimals || 18,
          logoUrl: token.logoUrl || existingMarket.logoUrl || null,
          status: status,
          verified: status === "verified"
        });
        if (customTokens && customTokens[symbol]) customTokens[symbol].status = status;
        tokenFull[symbol] = token.name || tokenFull[symbol] || symbol;
        if (token.logoUrl && window.__luminaSetTokenLogoUrl) window.__luminaSetTokenLogoUrl(symbol, token.logoUrl);
        tokenLogo[symbol] = window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(symbol, tokenLogo[symbol] || symbol) : (tokenLogo[symbol] || tokenInitial(symbol));
        if (!dotColor[symbol]) dotColor[symbol] = "linear-gradient(135deg,#1b231e,#26362b)";
        if (prices[symbol] === undefined) prices[symbol] = 0;
        if (balances[symbol] === undefined) balances[symbol] = "0";
        if (availMap[symbol] === undefined) availMap[symbol] = "0 " + symbol;
        return symbol;
      }
      function syncAssetTokenStatuses(){
        var backend = backendTokensBySymbol();
        if (!Array.isArray(assets)) return;
        assets.forEach(function(asset){
          var sym = String(asset && asset.sym || "").toUpperCase();
          var token = backend[sym];
          if (!token) return;
          asset.status = token.status || "pending";
          asset.address = asset.address || token.contractAddr || token.address || null;
          asset.contractAddr = asset.contractAddr || token.contractAddr || token.address || null;
          if (token.poolAddress && !asset.poolAddress) asset.poolAddress = token.poolAddress;
        });
      }
      function tokenAddress(token){
        return String(token && (token.contractAddr || token.address) || "").toLowerCase();
      }
      function formattedBalanceFor(sym){
        var raw = balances && balances[sym] != null ? String(balances[sym]) : "0";
        return raw || "0";
      }
      function amountNumberFor(sym){
        var n = Number(formattedBalanceFor(sym).replace(/,/g, ""));
        return Number.isFinite(n) ? n : 0;
      }
      function priceFor(sym, token){
        var p = prices && prices[sym] != null ? Number(prices[sym]) : 0;
        if (!(p > 0) && token && Number(token.priceUsd) > 0) p = Number(token.priceUsd);
        return Number.isFinite(p) && p > 0 ? p : 0;
      }
      function recentSwapTokens(){
        var list = readJson(recentSwapStoreKey, []);
        return Array.isArray(list) ? list : [];
      }
      function saveRecentSwapToken(token){
        var symbol = String(token && token.symbol || "").toUpperCase();
        if (!symbol) return;
        var list = recentSwapTokens().filter(function(item){
          return String(item && item.symbol || "").toUpperCase() !== symbol;
        });
        list.unshift(Object.assign({}, token, { symbol: symbol }));
        writeJson(recentSwapStoreKey, list.slice(0, 24));
      }
      window.__luminaRememberSwapAsset = saveRecentSwapToken;
      function upsertSwapHomeAssets(){
        if (!Array.isArray(assets)) assets = [];
        var tokenBySymbol = {};
        swapWhitelistTokens().forEach(function(token){
          var sym = String(token && token.symbol || "").toUpperCase();
          if (sym && !tokenBySymbol[sym]) tokenBySymbol[sym] = token;
        });
        var existingSymbols = new Set();
        var existingAddresses = new Set();
        assets.forEach(function(asset){
          var sym = String(asset && asset.sym || "").toUpperCase();
          if (sym) existingSymbols.add(sym);
          var token = sym ? tokenBySymbol[sym] : null;
          if (token) asset.status = token.status || "pending";
          if (token && !asset.address && !asset.contractAddr) {
            asset.address = token.contractAddr || token.address || null;
          }
          if (token && token.poolAddress && !asset.poolAddress) asset.poolAddress = token.poolAddress;
          var addr = String(asset && (asset.address || asset.contractAddr) || "").toLowerCase();
          if (/^0x[a-f0-9]{40}$/.test(addr)) existingAddresses.add(addr);
          if (sym && balances && balances[sym] != null) {
            var amount = formattedBalanceFor(sym);
            asset.amt = amount + " " + sym;
            var p = priceFor(sym);
            if (p > 0) asset.usdNum = amountNumberFor(sym) * p;
          }
        });
        var additions = Object.keys(tokenBySymbol).map(function(symbol){ return tokenBySymbol[symbol]; }).map(function(token){
          var sym = registerBackendToken(token);
          if (!sym) return null;
          var addr = tokenAddress(token);
          if (existingSymbols.has(sym) || (addr && existingAddresses.has(addr))) return null;
          existingSymbols.add(sym);
          if (addr) existingAddresses.add(addr);
          var amount = formattedBalanceFor(sym);
          var price = priceFor(sym, token);
          return {
            sym: sym,
            full: tokenFull[sym] || token.name || sym,
            amt: amount + " " + sym,
            usdNum: price > 0 ? amountNumberFor(sym) * price : 0,
            cls: "custom",
            logo: tokenLogo[sym] || tokenInitial(sym),
            address: token.contractAddr || token.address || null,
            poolAddress: token.poolAddress || null,
            status: token.status || "pending",
            homeSwapAsset: true
          };
        }).filter(Boolean);
        if (!additions.length) return;
        var insertAt = assets.findIndex(function(asset){ return String(asset && asset.sym || "").toUpperCase() === "ORB"; });
        if (insertAt < 0) insertAt = assets.findIndex(function(asset){ return String(asset && asset.sym || "").toUpperCase() === "ETH"; }) - 1;
        if (insertAt < 0) insertAt = assets.length - 1;
        assets.splice(insertAt + 1, 0, ...additions);
      }
      function upsertBalanceHomeAssets(){
        if (!Array.isArray(assets) || !balances) return;
        var backend = backendTokensBySymbol();
        var existingSymbols = new Set((assets || []).map(function(asset){ return String(asset && asset.sym || "").toUpperCase(); }));
        Object.keys(balances).forEach(function(symbol){
          var sym = String(symbol || "").toUpperCase();
          if (!sym || sym === "23" || existingSymbols.has(sym)) return;
          var amount = Number(String(balances[sym] || "0").replace(/,/g, ""));
          if (!Number.isFinite(amount) || amount <= 0) return;
          var price = priceFor(sym);
          if (!tokenFull[sym]) tokenFull[sym] = sym;
          if (!tokenLogo[sym]) tokenLogo[sym] = tokenInitial(sym);
          if (!dotColor[sym]) dotColor[sym] = "linear-gradient(135deg,#1b231e,#26362b)";
          assets.push({
            sym: sym,
            full: tokenFull[sym] || sym,
            amt: formattedBalanceFor(sym) + " " + sym,
            usdNum: price > 0 ? amount * price : 0,
            cls: "custom",
            logo: tokenLogo[sym] || tokenInitial(sym),
            address: null,
            status: backend[sym] ? (backend[sym].status || "pending") : undefined,
            recentSwapAsset: true,
            homeSwapAsset: true
          });
          existingSymbols.add(sym);
        });
      }
      function hiddenSet(){
        var list = readJson(hiddenStoreKey, []);
        return new Set(Array.isArray(list) ? list.map(function(x){ return String(x).toLowerCase(); }) : []);
      }
      function saveImported(token){
        if (whitelistedAddresses().has(String(token.address || "").toLowerCase())) return;
        var list = importedList().filter(function(item){
          return String(item.address).toLowerCase() !== String(token.address).toLowerCase();
        });
        list.unshift(token);
        writeJson(importStoreKey, list);
      }
      function updateImported(token){
        var list = importedList().map(function(item){
          return String(item.address).toLowerCase() === String(token.address).toLowerCase() ? Object.assign({}, item, token) : item;
        });
        writeJson(importStoreKey, list);
      }
      function registerImportedToken(token){
        if (whitelistedAddresses().has(String(token.address || "").toLowerCase())) return token.symbol;
        var key = Object.keys(customTokens || {}).find(function(sym){
          return customTokens[sym] && String(customTokens[sym].address).toLowerCase() === String(token.address).toLowerCase();
        }) || token.symbol;
        if (!customTokens[key] && prices[key] && token.address) key = token.symbol + "_" + token.address.slice(-4).toUpperCase();
        var score = token.risk && token.risk.score ? token.risk.score : "mid";
        prices[key] = 0;
        tokenFull[key] = token.name || token.symbol;
        tokenLogo[key] = tokenInitial(token.symbol);
        dotColor[key] = "linear-gradient(135deg,#202820,#324036)";
        balances[key] = formatImportedAmount(token.formatted);
        availMap[key] = balances[key] + " " + key;
        customTokens[key] = {
          address: token.address,
          decimals: token.decimals,
          formatted: balances[key],
          name: token.name,
          risk: score,
          sourceSymbol: token.symbol,
          verified: !!token.verified
        };
        return key;
      }
      function restoreImportedTokens(){
        importedList().forEach(function(token){ registerImportedToken(token); });
      }
      function restoreRecentSwapTokens(){
        recentSwapTokens().forEach(function(token){
          var sym = registerBackendToken(token);
          if (!sym || (assets || []).some(function(asset){ return String(asset && asset.sym || "").toUpperCase() === sym; })) return;
          var amount = balances[sym] || token.amount || "0";
          assets.push({
            sym: sym,
            full: tokenFull[sym] || token.name || sym,
            amt: amount + " " + sym,
            usdNum: Number(token.usdNum || 0),
            cls: "custom",
            logo: tokenLogo[sym] || tokenInitial(sym),
            address: token.contractAddr || token.address || null,
            poolAddress: token.poolAddress || null,
            status: token.status || "pending",
            recentSwapAsset: true,
            homeSwapAsset: true
          });
        });
      }
      async function refreshImportedBalances(){
        var owner = window.__luminaUserAddress || "";
        var list = importedList();
        if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner) || !list.length) return;
        await Promise.all(list.map(async function(token){
          try {
            var res = await fetch("/api/token-info?address=" + encodeURIComponent(token.address) + "&owner=" + encodeURIComponent(owner), { cache: "no-store" });
            var fresh = await res.json();
            if (!res.ok) return;
            updateImported(fresh);
            registerImportedToken(fresh);
          } catch(e) {}
        }));
        if (typeof renderAssets === "function") renderAssets();
        if (typeof renderAllAssets === "function") renderAllAssets();
      }
      window.__luminaRefreshImportedTokens = function(){
        refreshImportedBalances();
      };
      function renderScanRows(risk){
        var checks = risk && Array.isArray(risk.checks) ? risk.checks : [];
        return checks.map(function(c){
          var level = c.level === "danger" ? "danger" : (c.level === "warn" ? "warn" : "pass");
          return '<div class="scan-row ' + level + '"><span class="dot3"></span><span class="k">' + c.key + '</span><span class="v">' + c.value + '</span></div>';
        }).join("");
      }
      renderTokenList = function(filter){
        filter = String(filter || "").toLowerCase();
        var rows = sortedSwapSymbols(swapWhitelistTokens().map(function(token){ return registerBackendToken(token); }).filter(Boolean));
        rows = rows.filter(function(sym){
          if (!filter) return true;
          return sym.toLowerCase().indexOf(filter) >= 0 || String(tokenFull[sym] || "").toLowerCase().indexOf(filter) >= 0;
        });
        document.getElementById("tokenModalList").innerHTML = rows.map(function(sym){
          var color = sym === "WLD" ? "#000" : "#fff";
          return '<div class="tk-row" data-token-symbol="' + sym + '" onclick="pickToken(\\'' + sym + '\\')"><div class="ic" style="background:' + (dotColor[sym] || "var(--surface-2)") + ';color:' + color + '">' + (window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(sym, tokenLogo[sym]) : tokenLogo[sym]) + '</div><div class="mid"><div class="s">' + sym + '<span class="custom-badge">白名单</span></div><div class="f">' + (tokenFull[sym] || sym) + '</div></div><div class="bal">' + (balances[sym] || "0") + '</div></div>';
        }).join("") || '<div class="import-load">没有匹配的白名单代币</div>';
      };
      openTokenModal = function(target){
        swapState.target = target;
        document.getElementById("tkSearch").value = "";
        document.getElementById("importPreview").innerHTML = "";
        renderTokenList("");
        document.getElementById("tokenModal").classList.add("open");
      };

      showImportPreview = async function(addr){
        var owner = window.__luminaUserAddress || "";
        var preview = document.getElementById("importPreview");
        preview.innerHTML = '<div class="import-load">Running token safety checks...</div>';
        try {
          var safetyRes = await fetch("/api/swap/token-check?address=" + encodeURIComponent(addr), { cache: "no-store" });
          var safety = await safetyRes.json();
          if (!safetyRes.ok && safety.status !== "rejected") throw new Error(safety.error || "Invalid token contract");
          if (safety.status === "rejected") {
            preview.innerHTML =
              '<div class="import-card rejected">' +
                '<div class="hd"><div class="ic token-initial">!</div><div class="mid"><div class="s">Rejected</div><div class="f">' + (safety.metadata ? safety.metadata.symbol : "Invalid token contract") + '</div></div></div>' +
                '<div class="addr">' + addr + '</div>' +
                '<div class="risk-score high"><span class="big">Blocked</span><span class="txt">' + ((safety.reasons || [safety.error || "safety_check_failed"]).join(", ")) + '</span></div>' +
              '</div>';
            return;
          }
          var info = null;
          try {
            var infoRes = await fetch("/api/token-info?address=" + encodeURIComponent(addr) + "&owner=" + encodeURIComponent(owner), { cache: "no-store" });
            info = await infoRes.json();
          } catch(e) {}
          var token = Object.assign({}, info || {}, safety.metadata || {});
          token.risk = { score: safety.status === "community" ? "mid" : "low", checks: [
            { key: "Metadata", value: "Valid", level: "pass" },
            { key: "Liquidity", value: "$" + Math.round((safety.liquidity && safety.liquidity.tvlUsd) || 0).toLocaleString() + " TVL", level: ((safety.liquidity && safety.liquidity.tvlUsd) || 0) < 5000 ? "warn" : "pass" },
            { key: "Honeypot", value: safety.safety && safety.safety.passedHoneypot ? "Basic sellback passed" : "Failed", level: safety.safety && safety.safety.passedHoneypot ? "pass" : "danger" }
          ] };
          token.safety = safety;
          token.formatted = token.formatted || "0";
          token.verified = safety.status === "verified";
          var score = safety.status === "community" ? "mid" : "low";
          var needAck = safety.status === "community";
          var btnAttr = needAck ? ' disabled id="impBtn"' : ' id="impBtn"';
          var ackHtml = needAck
            ? '<div class="ack" id="impAck" onclick="toggleImpAck()"><span class="box"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#042" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span><span>Community token. I understand this token is not audited by Lumina and will test with a small amount first.</span></div>'
            : "";
          preview.innerHTML =
            '<div class="import-card">' +
              '<div class="hd">' +
                '<div class="ic token-initial">' + tokenInitial(token.symbol) + '</div>' +
                '<div class="mid"><div class="s">' + token.symbol + '</div><div class="f">' + token.name + ' · Balance ' + formatImportedAmount(token.formatted) + '</div></div>' +
              '</div>' +
              '<div class="addr">' + token.address + '</div>' +
              '<div class="scan-rows">' + renderScanRows(token.risk) + '</div>' +
              '<div class="risk-score ' + riskClass(score) + '"><span class="big">' + (safety.status === "community" ? "Community" : riskLabel(score)) + '</span><span class="txt">Automated checks cache for 5 minutes. Community tokens require risk acknowledgement before swap.</span></div>' +
              ackHtml +
              '<button class="btn"' + btnAttr + ' onclick="doImportFromInfo()">' + (needAck ? "Import community token" : "Select") + ' ' + token.symbol + '</button>' +
            '</div>';
          window.__luminaImportCandidate = token;
        } catch(e) {
          preview.innerHTML = '<div class="import-err">' + (e && e.message ? e.message : "Unable to read token") + '</div>';
        }
      };

      doImportFromInfo = function(){
        var token = window.__luminaImportCandidate;
        if (!token) return;
        saveImported(token);
        var key = registerImportedToken(token);
        if ((token.risk && token.risk.score) === "high") {
          var hidden = Array.from(hiddenSet());
          hidden.push(String(token.address).toLowerCase());
          writeJson(hiddenStoreKey, Array.from(new Set(hidden)));
        }
        document.getElementById("tkSearch").value = "";
        document.getElementById("importPreview").innerHTML = "";
        toast("Imported " + token.symbol);
        pickToken(key);
        if (typeof closeTokenModal === "function") closeTokenModal();
        if (typeof renderAssets === "function") renderAssets();
        if (typeof renderAllAssets === "function") renderAllAssets();
        if (swapState && (swapState.target === "sell" || swapState.target === "buy")) {
          go("swap");
          setTabByName("Swap");
        } else {
          go("home");
          setTabByName("Home");
        }
      };

      doImport = function(sym, addr, score){
        showImportPreview(addr);
      };

      function assetIconHtml(symbol, className, logo) {
        var icon = window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(symbol, logo || "") : "";
        return '<div class="coin ' + (className || "custom") + '">' + icon + '</div>';
      }
      function importedAssetRow(token, hidden) {
        var key = Object.keys(customTokens).find(function(sym){
          return customTokens[sym] && String(customTokens[sym].address).toLowerCase() === String(token.address).toLowerCase();
        }) || token.symbol;
        var score = token.risk && token.risk.score ? token.risk.score : "mid";
        var badge = '<span class="asset-risk ' + riskClass(score) + '">' + riskLabel(score) + '</span>';
        return '<div class="asset all-asset-row risk-token" onclick="openImportedRisk(\\'' + token.address + '\\')">' +
          '<div class="coin custom">' + tokenInitial(token.symbol) + '</div>' +
          '<div class="name"><div class="sym">' + token.symbol + ' ' + badge + '</div><div class="full">' + token.name + '</div></div>' +
          '<div class="asset-contract">' + String(token.address).slice(0, 6) + "..." + String(token.address).slice(-4) + '</div>' +
          '<div class="vals"><div class="amt">' + (balances[key] || formatImportedAmount(token.formatted)) + ' ' + token.symbol + '</div><div class="usd">' + (hidden ? "Hidden on Home" : "Imported") + '</div></div>' +
        '</div>';
      }

      function ensureAllAssetsView(){
        if (document.getElementById("view-allassets")) return;
        var view = document.createElement("div");
        view.className = "view";
        view.id = "view-allassets";
        view.innerHTML =
          '<div class="subhead"><button class="back-btn" onclick="go(\\'home\\'); setTabByName(\\'Home\\')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button><h1>All assets</h1></div>' +
          '<div class="all-assets-note">Verified assets appear on Home. Imported high-risk tokens are hidden there and listed here for review.</div>' +
          '<div class="assets all-assets-list" id="allAssetList"></div>';
        document.querySelector(".phone").appendChild(view);
      }
      function renderAllAssets(){
        ensureAllAssetsView();
        var hidden = hiddenSet();
        var keepZero = new Set(["WLD","USDC","WBTC","USDT","WETH","EURC"]);
        function allAssetAmountNumber(asset){
          var raw = String(asset && asset.amt || "0").split(" ")[0].replace(/,/g, "");
          var n = Number(raw);
          return Number.isFinite(n) ? n : 0;
        }
        function showAllAssetRow(asset){
          var sym = String(asset && asset.sym || "").toUpperCase();
          return keepZero.has(sym) || allAssetAmountNumber(asset) > 0;
        }
        function displayAllAssetAmount(asset){
          var amount = allAssetAmountNumber(asset);
          var sym = String(asset && asset.sym || "").toUpperCase();
          if (!(amount > 0)) return "0 " + sym;
          if (amount < 0.01) return "<0.01 " + sym;
          return amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + sym;
        }
        var verifiedRows = (assets || []).filter(function(a){
          return a && showAllAssetRow(a) && String(a.sym || "").toUpperCase() !== "BTC";
        }).map(function(a){
          var i = assets.indexOf(a);
          var status = String(a.status || "").toLowerCase();
          var cls = status === "rejected" || status === "high" || status === "danger" ? "high" : (status === "pending" || status === "community" || status === "unverified" ? "mid" : "low");
          var label = cls === "high" ? "High risk" : (cls === "mid" ? "Unverified" : "Verified");
          return '<div class="asset all-asset-row" onclick="openDetail(' + i + ')">' +
            assetIconHtml(a.sym, a.cls, a.logo) +
            '<div class="name"><div class="sym">' + a.sym + ' <span class="asset-risk ' + cls + '">' + label + '</span></div><div class="full">' + a.full + '</div></div>' +
            '<div></div><div class="vals"><div class="amt">' + displayAllAssetAmount(a) + '</div><div class="usd">' + formatMoney(a.usdNum || 0) + '</div></div></div>';
        });
        var importedRows = importedList().filter(function(token){
          var amount = Number(String((balances && balances[token.symbol]) || token.formatted || "0").replace(/,/g, ""));
          return Number.isFinite(amount) && amount > 0;
        }).map(function(token){
          return importedAssetRow(token, hidden.has(String(token.address).toLowerCase()));
        });
        document.getElementById("allAssetList").innerHTML = verifiedRows.concat(importedRows).join("") || '<div class="article-empty">No assets detected yet</div>';
      }
      window.openAllAssets = function(){
        renderAllAssets();
        go("allassets");
        setTabByName("Home");
      };
      window.openImportedRisk = function(address){
        var token = importedList().find(function(item){ return String(item.address).toLowerCase() === String(address).toLowerCase(); });
        if (!token) return;
        toast((token.risk && token.risk.score === "high") ? "High risk token" : "Imported token");
      };

      var viewAll = document.querySelector(".section-head .link[data-i18n='viewAll']");
      if (viewAll) viewAll.onclick = function(event){ event.preventDefault(); window.openAllAssets(); };

      function syncBackendSwapTokens(){
        fetch("/api/tokens?ts=" + Date.now(), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : []; })
          .then(function(list){
            if (!Array.isArray(list)) return;
            var active = list.filter(function(token){
              return token && token.status !== "disabled";
            });
            var swappable = active.filter(function(token){ return token.canSwap !== false; });
            writeJson("ww_tokens", active);
            writeJson("ww_swap_tokens", swappable);
            active.forEach(registerBackendToken);
            upsertSwapHomeAssets();
            syncAssetTokenStatuses();
            if (typeof renderAssets === "function") renderAssets();
            if (typeof renderAllAssets === "function") renderAllAssets();
            if (window.__luminaRefreshTokenLogos) window.__luminaRefreshTokenLogos();
          })
          .catch(function(){});
      }

      if (typeof renderAssets === "function" && !window.__luminaSwapHomeAssetsWrapped) {
        window.__luminaSwapHomeAssetsWrapped = true;
        var previousRenderAssets = renderAssets;
        renderAssets = function(){
          upsertSwapHomeAssets();
          upsertBalanceHomeAssets();
          syncAssetTokenStatuses();
          previousRenderAssets();
        };
      }
      upsertSwapHomeAssets();
      syncBackendSwapTokens();
      restoreImportedTokens();
      restoreRecentSwapTokens();
      upsertBalanceHomeAssets();
      syncAssetTokenStatuses();
      refreshImportedBalances();
      if (!window.__luminaImportedRefreshTimer) {
        window.__luminaImportedRefreshTimer = setInterval(refreshImportedBalances, 10000);
        document.addEventListener("visibilitychange", refreshImportedBalances);
        window.addEventListener("focus", refreshImportedBalances);
      }
      ensureAllAssetsView();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance token import");
}

/**
 * Restyles the Home view to match the latest wallet UI while preserving live balance data.
 */
function enhancePrototypeHome() {
  const source = `
    (function(){
      function homeIcon(name) {
        if (name === "world") return '<svg width="31" height="31" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="16" cy="16" r="11"/><path d="M7 16h18"/><path d="M16 5a17 17 0 010 22M16 5a17 17 0 000 22"/></svg>';
        if (name === "verified") return '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.4 1.7 2.9-.3 1.2 2.7 2.7 1.2-.3 2.9L23 12l-1.7 2.4.3 2.9-2.7 1.2-1.2 2.7-2.9-.3L12 23l-2.4-1.7-2.9.3-1.2-2.7-2.7-1.2.3-2.9L1 12l1.7-2.4-.3-2.9 2.7-1.2L6.3 2.7l2.9.3z"/><path d="M10.4 15.4l-2.5-2.5 1.4-1.4 1.1 1.1 4.2-4.2 1.4 1.4z" fill="#052512"/></svg>';
        if (name === "bell") return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
        if (name === "search") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
        return "";
      }
      function homeDebugRows(){
        return (assets || []).filter(function(asset){ return showOnHome(asset); }).map(function(asset){
          var sym = String(asset && asset.sym || "").toUpperCase();
          var row = document.querySelector('#view-home #assetList .home-v2-asset[data-home-symbol="' + sym + '"]');
          var rect = row ? row.getBoundingClientRect() : null;
          return {
            sym: sym,
            amount: asset && asset.amt,
            usdNum: asset && asset.usdNum,
            hasRow: !!row,
            rowText: row ? row.textContent : "",
            rect: rect ? { x:Math.round(rect.x), y:Math.round(rect.y), w:Math.round(rect.width), h:Math.round(rect.height) } : null
          };
        });
      }
      function setHomeDebug(stage, detail){
        return;
      }
      window.__luminaSetHomeDebug = null;
      function readHomeDebug(){
        return null;
      }
      function openHomeDebug(){
        var old = document.getElementById("homeDebugModal");
        if (old) old.remove();
      }
      function ensureHomeDebugButton(){
        var old = document.getElementById("homeDebugBtn");
        if (old) old.remove();
      }
      function annEscape(value){
        return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch){ return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]; });
      }
      function annPickText(item, key){
        var lang = typeof currentLang !== "undefined" ? currentLang : "en";
        var map = item && item[key + "I18n"];
        if (map && typeof map === "object") return map[lang] || map.en || map["zh-CN"] || Object.values(map)[0] || "";
        return item && item[key] ? item[key] : "";
      }
      function annTagText(tag){
        var lang = typeof currentLang !== "undefined" ? currentLang : "en";
        var names = {
          notice:{ en:"Notice", "zh-CN":"通知", "zh-TW":"通知", fr:"Avis", de:"Hinweis", es:"Aviso", ja:"通知" },
          warning:{ en:"Warning", "zh-CN":"提醒", "zh-TW":"提醒", fr:"Alerte", de:"Warnung", es:"Aviso", ja:"警告" },
          urgent:{ en:"Urgent", "zh-CN":"重要", "zh-TW":"重要", fr:"Urgent", de:"Dringend", es:"Urgente", ja:"重要" }
        };
        var item = names[tag] || names.notice;
        return item[lang] || item.en;
      }
      function annList(){
        try { return JSON.parse(localStorage.getItem("ww_announcements") || "[]"); } catch(e) { return []; }
      }
      function annIcon(name){
        if (name === "back") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6"/></svg>';
        if (name === "share") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>';
        if (name === "check") return '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.6 2.6L16.5 9"/></svg>';
        if (name === "calendar") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
        if (name === "user") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
        if (name === "tag") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13l-7 7L4 11V4h7l9 9z"/><path d="M7.5 7.5h.01"/></svg>';
        if (name === "world") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></svg>';
        if (name === "box") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M3.5 8.5L12 13l8.5-4.5M12 13v8"/></svg>';
        if (name === "clock") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
        if (name === "thumb") return '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 11v10H4a2 2 0 01-2-2v-6a2 2 0 012-2h3z"/><path d="M7 11l4-8a3 3 0 013 3v3h5a2 2 0 012 2l-1 7a3 3 0 01-3 3H7"/></svg>';
        if (name === "thumbDown") return '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 13V3h3a2 2 0 012 2v6a2 2 0 01-2 2h-3z"/><path d="M17 13l-4 8a3 3 0 01-3-3v-3H5a2 2 0 01-2-2l1-7a3 3 0 013-3h10"/></svg>';
        return "";
      }
      function annSummary(body){
        var text = String(body || "").replace(/\\s+/g, " ").trim();
        return text.length > 92 ? text.slice(0, 92).replace(/[,.，。;；:]?\\s*$/, "") + "." : text;
      }
      function annParagraphs(body){
        var lines = String(body || "").split(/\\n+/).map(function(line){ return line.trim(); }).filter(Boolean);
        if (!lines.length) return "";
        return lines.map(function(line){ return '<p>' + annEscape(line) + '</p>'; }).join("");
      }
      function closeLuminaAnnouncement(){
        var old = document.getElementById("luminaAnnouncementModal");
        if (old) { old.classList.remove("open"); setTimeout(function(){ old.remove(); }, 180); }
      }
      function openAnnouncementDetail(item){
        var old = document.getElementById("luminaAnnouncementModal");
        if (!old) return;
        var tag = String(item && item.tag || "notice");
        var title = annPickText(item, "title");
        var body = annPickText(item, "body");
        var time = String(item && item.time || "");
        var publisher = String(item && (item.author || item.createdBy || item.publisher) || "lumina-admin");
        var pinned = !!(item && item.pinned);
        old.innerHTML =
          '<div class="modal lumina-ann-sheet lumina-ann-detail-sheet">' +
            '<section class="lumina-ann-article-card">' +
              '<button type="button" class="lumina-ann-back lumina-ann-floating-back" id="luminaAnnBack" aria-label="Back">' + annIcon("back") + '</button>' +
              '<div class="lumina-ann-article-head">' +
                (pinned ? '<span class="lumina-ann-pin">Pinned</span>' : '<span class="lumina-ann-pin ghost">' + annEscape(annTagText(tag)) + '</span>') +
                '<h3>' + annEscape(title) + '</h3>' +
                '<div class="lumina-ann-meta"><span>' + annIcon("calendar") + annEscape(time) + '</span><span>' + annIcon("user") + annEscape(publisher) + '</span><span>' + annIcon("tag") + annEscape(annTagText(tag)) + '</span></div>' +
              '</div>' +
              '<div class="lumina-ann-body">' + annParagraphs(body) + '</div>' +
              '<div class="lumina-ann-help-row" data-ann-id="' + annEscape(item && item.id || title) + '"><button type="button" data-ann-vote="useful">' + annIcon("thumb") + '<span>Useful</span><b>0</b></button><button type="button" data-ann-vote="notUseful">' + annIcon("thumbDown") + '<span>Not Useful</span><b>0</b></button></div>' +
            '</section>' +
          '</div>';
        var back = document.getElementById("luminaAnnBack");
        if (back) back.onclick = function(event){ event.stopPropagation(); closeLuminaAnnouncement(); };
        var help = old.querySelector(".lumina-ann-help-row");
        if (help) {
          var voteKey = "lumina_ann_votes_v1";
          var annId = help.getAttribute("data-ann-id") || title;
          function readVotes(){ try { return JSON.parse(localStorage.getItem(voteKey) || "{}"); } catch(e) { return {}; } }
          function writeVotes(value){ try { localStorage.setItem(voteKey, JSON.stringify(value)); } catch(e) {} }
          function renderVotes(){
            var votes = readVotes();
            var itemVotes = votes[annId] || { useful:0, notUseful:0, selected:"" };
            help.querySelectorAll("button").forEach(function(btn){
              var type = btn.getAttribute("data-ann-vote") || "";
              btn.classList.toggle("selected", itemVotes.selected === type);
              btn.disabled = !!itemVotes.selected && itemVotes.selected !== type;
              var count = btn.querySelector("b");
              if (count) count.textContent = String(Number(itemVotes[type] || 0));
            });
          }
          help.querySelectorAll("button").forEach(function(btn){
            btn.onclick = function(event){
              event.stopPropagation();
              var type = btn.getAttribute("data-ann-vote") || "";
              var votes = readVotes();
              var itemVotes = votes[annId] || { useful:0, notUseful:0, selected:"" };
              if (itemVotes.selected) return;
              itemVotes[type] = Number(itemVotes[type] || 0) + 1;
              itemVotes.selected = type;
              votes[annId] = itemVotes;
              writeVotes(votes);
              renderVotes();
            };
          });
          renderVotes();
        }
      }
      window.openAnnouncements = function(){
        var list = annList().slice().sort(function(a, b){ return Number(b.id || 0) - Number(a.id || 0); });
        var maxId = list.reduce(function(m, item){ return Math.max(m, Number(item && item.id || 0)); }, 0);
        try { localStorage.setItem("ww_ann_last_read", String(maxId)); } catch(e) {}
        if (typeof updateBellDot === "function") updateBellDot();
        closeLuminaAnnouncement();
        var modal = document.createElement("div");
        modal.className = "modal-mask open lumina-ann-mask";
        modal.id = "luminaAnnouncementModal";
        var rows = list.length ? list.map(function(item, index){
          var tag = String(item && item.tag || "notice");
          return '<button type="button" class="ann-item lumina-ann-row" data-ann-index="' + index + '">' +
            '<span class="ann-top"><span class="ann-tag ' + annEscape(tag) + '">' + annEscape(annTagText(tag)) + '</span><span class="ann-time">' + annEscape(item && item.time || "") + '</span></span>' +
            '<strong class="ann-title">' + annEscape(annPickText(item, "title")) + '</strong>' +
            '<span class="ann-body">' + annEscape(annPickText(item, "body")) + '</span>' +
          '</button>';
        }).join("") : '<div class="ann-empty">' + annEscape(typeof t === "function" ? t("noAnnouncements") : "No announcements") + '</div>';
        modal.innerHTML =
          '<div class="modal lumina-ann-sheet">' +
            '<button type="button" class="lumina-ann-close" id="luminaAnnClose" aria-label="Close">×</button>' +
            '<h3 class="lumina-ann-title">' + annEscape(typeof t === "function" ? t("announcements") : "Announcements") + '</h3>' +
            '<div class="lumina-ann-list">' + rows + '</div>' +
          '</div>';
        document.body.appendChild(modal);
        modal.onclick = function(event){ if (event.target === modal) closeLuminaAnnouncement(); };
        var close = document.getElementById("luminaAnnClose");
        if (close) close.onclick = function(event){ event.stopPropagation(); closeLuminaAnnouncement(); };
        modal.querySelectorAll(".lumina-ann-row").forEach(function(row){
          row.addEventListener("click", function(event){
            event.stopPropagation();
            openAnnouncementDetail(list[Number(row.getAttribute("data-ann-index"))]);
          });
        });
      };
      function fixSignedMoney(){
        window.__luminaApplyBalancePrivacy = function(){
          var isHidden = typeof hidden !== "undefined" && !!hidden;
          var balEl = document.getElementById("balAmt");
          var changeEl = document.querySelector(".balance-change");
          if (balEl && isHidden) balEl.textContent = "••••••";
          if (changeEl) {
            changeEl.style.visibility = isHidden ? "hidden" : "";
            changeEl.setAttribute("aria-hidden", isHidden ? "true" : "false");
          }
        };
        if (!window.__luminaHomePrivacyFix) {
          window.__luminaHomePrivacyFix = true;
          var eye = document.getElementById("eyeBtn");
          if (eye) {
            eye.onclick = function(){
              hidden = !hidden;
              var balEl = document.getElementById("balAmt");
              if (balEl) balEl.textContent = hidden ? "••••••" : formatMoney(totalUsdNum);
              window.__luminaApplyBalancePrivacy();
            };
          }
        }
        if (!window.__luminaHomeMoneyFix && typeof formatMoney === "function") {
          window.__luminaHomeMoneyFix = true;
          var rawFormatMoney = formatMoney;
          formatMoney = function(usd){
            var n = Number(usd);
            if (!Number.isFinite(n)) return rawFormatMoney(usd);
            var c = typeof curObj === "function" ? curObj() : { symbol:"$", code:"USD", rate:1 };
            var converted = Math.abs(n) * Number(c.rate || 1);
            var noDec = (c.code === "JPY" || c.code === "KRW" || c.code === "NGN" || c.code === "TWD");
            var minimum = noDec ? 1 : 0.01;
            if (Math.abs(n) > 0 && converted > 0 && converted < minimum) {
              return (n < 0 ? "-" : "") + "<" + c.symbol + minimum.toLocaleString(undefined, {
                minimumFractionDigits: noDec ? 0 : 2,
                maximumFractionDigits: noDec ? 0 : 2
              });
            }
            return n < 0 ? "-" + rawFormatMoney(Math.abs(n)) : rawFormatMoney(n);
          };
        }
        if (!window.__luminaHomeRenderMoneyFix && typeof renderMoney === "function") {
          window.__luminaHomeRenderMoneyFix = true;
          var rawRenderMoney = renderMoney;
          renderMoney = function(){
            rawRenderMoney();
            var subEl = document.getElementById("balSub");
            if (subEl && typeof change24hUsdNum !== "undefined") {
              var sign = Number(change24hUsdNum) >= 0 ? "+" : "";
              subEl.textContent = sign + formatMoney(change24hUsdNum) + " (24h)";
            }
            window.__luminaApplyBalancePrivacy();
          };
        }
      }
      function ensureHomeShell() {
        fixSignedMoney();
        var home = document.getElementById("view-home");
        if (!home || home.dataset.luminaHomeV2 === "1") return;
        home.dataset.luminaHomeV2 = "1";
        var balanceCard = home.querySelector(".balance-card");
        var globe = balanceCard && balanceCard.querySelector(".globe");
        if (globe && !globe.querySelector(".globe-shield")) {
          globe.innerHTML =
            '<span class="globe-ripple r1"></span><span class="globe-ripple r2"></span><span class="globe-ripple r3"></span><span class="globe-ripple r4"></span>' +
            '<span class="globe-shield"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l7 3v5.4c0 4.7-2.8 8.8-7 10.6-4.2-1.8-7-5.9-7-10.6V5.5l7-3z"/><path d="M8.7 12.1l2.1 2.1 4.8-5"/></svg></span>';
        }
        var chainTag = balanceCard && balanceCard.querySelector(".chain-tag");
        var balanceChange = balanceCard && balanceCard.querySelector(".balance-change");
        if (chainTag && balanceChange) balanceChange.insertAdjacentElement("afterend", chainTag);

        var top = document.createElement("div");
        top.className = "home-v2-top";
        top.innerHTML =
          '<div class="home-chain-wrap"><button class="home-chain-pill" type="button" onclick="toggleHomeChainMenu()"><span>' + homeIcon("world") + '</span><strong>World Chain</strong><i>⌄</i></button><div class="home-chain-menu" id="homeChainMenu"><button type="button"><b>World Chain</b><small>Active network</small></button></div></div>' +
          '<div class="home-top-actions"><button type="button" class="home-round verified">' + homeIcon("verified") + '</button><button type="button" class="home-round bell" onclick="openAnnouncements()">' + homeIcon("bell") + '<em style="display:none"></em></button></div>';
        home.insertBefore(top, home.firstChild);

        var section = home.querySelector(".section-head");
        if (section && !section.querySelector(".home-add-circle")) {
          var link = section.querySelector(".link");
          if (link) {
            link.classList.add("home-view-all");
            link.textContent = "View All";
          }
          var controls = document.createElement("div");
          controls.className = "home-section-actions";
          var plus = document.createElement("button");
          plus.className = "home-add-circle";
          plus.type = "button";
          plus.innerHTML = '<span>+</span>';
          plus.onclick = function(){ openTokenModal("buy"); };
          if (link) controls.appendChild(link);
          controls.appendChild(plus);
          section.appendChild(controls);
          var search = document.createElement("div");
          search.className = "home-token-search";
          search.innerHTML = '<span>' + homeIcon("search") + '</span><input id="homeTokenSearch" placeholder="Search token" oninput="renderAssets()" />';
          section.insertAdjacentElement("afterend", search);
        }
      }
      function tokenInitialHome(symbol){
        return String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
      }
      var fixedHomeTokens = new Set(["WLD","USDC","WBTC","USDT","WETH","EURC"]);
      function fixedHomeTokenMeta(sym){
        var defaults = {
          WLD: { full: tokenFull.WLD || "Worldcoin", decimals: 18, cls: "wld", logo: tokenLogo.WLD || "", address: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" },
          USDC: { full: tokenFull.USDC || "USD Coin", decimals: 6, cls: "usdc", logo: tokenLogo.USDC || "", address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" },
          USDT: { full: tokenFull.USDT || "Tether USD", decimals: 6, cls: "usdt", logo: tokenLogo.USDT || "T", address: "0x102d758f688a4c1c5a80b116bd945d4455460282" },
          WETH: { full: tokenFull.WETH || "WETH", decimals: 18, cls: "custom", logo: tokenLogo.WETH || "W", address: "0x4200000000000000000000000000000000000006" },
          EURC: { full: tokenFull.EURC || "EURC", decimals: 6, cls: "custom", logo: tokenLogo.EURC || "E", address: "0xE75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0" },
          WBTC: { full: tokenFull.WBTC || "Wrapped Bitcoin", decimals: 8, cls: "custom", logo: tokenLogo.WBTC || "B", address: "0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3" }
        };
        var meta = defaults[sym] || null;
        var whitelist = typeof swapWhitelistTokens === "function" ? swapWhitelistTokens() : [];
        var configured = Array.isArray(whitelist) ? whitelist.find(function(token){ return String(token && token.symbol || "").toUpperCase() === sym; }) : null;
        if (!meta && configured) {
          meta = { full: configured.name || sym, decimals: configured.decimals || 18, cls: "custom", logo: tokenLogo[sym] || tokenInitialHome(sym), address: configured.contractAddr || configured.address || null };
        }
        if (meta && configured) {
          meta.full = configured.name || meta.full;
          meta.logo = tokenLogo[sym] || configured.logoUrl || meta.logo;
          meta.address = configured.contractAddr || configured.address || meta.address;
          meta.poolAddress = configured.poolAddress || meta.poolAddress || null;
        }
        return meta;
      }
      function hasVisibleHomeBalance(asset){
        var raw = String(asset && asset.amt || "0").split(" ")[0].replace(/,/g, "");
        var n = Number(raw);
        return Number.isFinite(n) && n > 0;
      }
      function showOnHome(asset){
        var sym = String(asset && asset.sym || "").toUpperCase();
        if (fixedHomeTokens.has(sym)) return true;
        return !!(asset && hasVisibleHomeBalance(asset));
      }
      window.openHomeAsset = function(sym){
        sym = String(sym || "").toUpperCase();
        setHomeDebug("openHomeAsset:start", { sym:sym });
        var idx = (assets || []).findIndex(function(a){ return String(a && a.sym || "").toUpperCase() === sym; });
        if (idx < 0 && fixedHomeTokens.has(sym)) {
          var meta = fixedHomeTokenMeta(sym);
          if (!meta) return;
          if (!Array.isArray(assets)) assets = [];
          idx = assets.length;
          assets.push({
            sym: sym,
            full: meta.full || sym,
            amt: (balances[sym] || "0") + " " + sym,
            usdNum: (Number(String(balances[sym] || "0").replace(/,/g, "")) || 0) * (Number(prices[sym] || 0) || (sym === "USDC" || sym === "EURC" ? 1 : 0)),
            cls: meta.cls || "custom",
            logo: meta.logo || tokenInitialHome(sym),
            address: meta.address || null,
            poolAddress: meta.poolAddress || null
          });
        }
        if (idx >= 0) {
          setHomeDebug("openHomeAsset:openDetail", { sym:sym, index:idx, asset:assets && assets[idx] });
          openDetail(idx);
        } else {
          setHomeDebug("openHomeAsset:notFound", { sym:sym });
        }
      };
      window.__luminaOpenHomeRow = function(event, row){
        if (event && event.__luminaHomeHandled) return;
        if (event) event.__luminaHomeHandled = true;
        var symbol = row && row.getAttribute ? (row.getAttribute("data-home-symbol") || "") : "";
        var index = row && row.getAttribute ? Number(row.getAttribute("data-home-index")) : NaN;
        if (!symbol && row && row.querySelector) {
          var symEl = row.querySelector(".sym");
          symbol = symEl ? String(symEl.textContent || "").trim().toUpperCase() : "";
        }
        if (symbol) {
          setHomeDebug("row:activate", { symbol:symbol, index:index, imported:row.getAttribute("data-home-imported"), target:event && event.target && event.target.className });
          if (row.getAttribute("data-home-imported") === "1") openImportedTokenHome(symbol);
          else openHomeAsset(symbol);
          return;
        }
        if (Number.isInteger(index) && assets && assets[index]) {
          setHomeDebug("row:activate-index", { index:index, asset:assets[index] });
          openDetail(index);
        }
      };
      function isCleanHomeTap(event){
        var start = window.__luminaHomeTapStart || null;
        if (!start || !event) return true;
        var touch = event.changedTouches && event.changedTouches[0];
        var x = touch ? touch.clientX : event.clientX;
        var y = touch ? touch.clientY : event.clientY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
        var dx = Math.abs(x - start.x);
        var dy = Math.abs(y - start.y);
        return dx <= 10 && dy <= 10;
      }
      window.toggleHomeChainMenu = function(){
        var menu = document.getElementById("homeChainMenu");
        if (menu) menu.classList.toggle("open");
      };
      window.openImportedTokenHome = function(sym){
        var meta = customTokens && customTokens[sym] ? customTokens[sym] : null;
        if (!meta) return;
        var formatted = balances[sym] || meta.formatted || "0";
        var idx = (assets || []).findIndex(function(a){ return a.custom && a.sym === sym; });
        if (idx < 0) {
          idx = assets.length;
          assets.push({
            sym: sym,
            full: tokenFull[sym] || meta.name || sym,
            amt: formatted + " " + sym,
            usdNum: 0,
            cls: "custom",
            logo: tokenLogo[sym] || tokenInitialHome(sym),
            custom: true
          });
        } else {
          assets[idx].amt = formatted + " " + sym;
        }
        openDetail(idx);
      };
      function importedHomeRows(filter){
        var rows = [];
        try {
          Object.keys(customTokens || {}).forEach(function(sym){
            var meta = customTokens[sym] || {};
            var full = tokenFull[sym] || meta.name || sym;
            if (filter && (sym + " " + full).toLowerCase().indexOf(filter) < 0) return;
            rows.push({ sym: sym, full: full, amt: (balances[sym] || meta.formatted || "0") + " " + sym, usdNum: 0, cls: "custom", logo: tokenLogo[sym] || tokenInitialHome(sym), custom: true });
          });
        } catch(e) {}
        return rows;
      }
      function priceForHome(symbol){
        var sym = String(symbol || "").toUpperCase();
        try {
          if (prices && Number(prices[sym]) > 0) return Number(prices[sym]);
          if (sym === "WETH") return Number(prices && prices.ETH) || 0;
          if (sym === "WBTC" || sym === "BTC") return Number(prices && prices.BTC) || 0;
          if (sym === "USDC" || sym === "USDT" || sym === "EURC") return 1;
          if (customTokens && customTokens[sym] && Number(customTokens[sym].priceUsd) > 0) return Number(customTokens[sym].priceUsd);
          var map = window.__luminaMarketBySymbol || {};
          if (map[sym] && Number(map[sym].priceUsd) > 0) return Number(map[sym].priceUsd);
          var markets = window.__luminaMarketPrices || [];
          var market = markets.find(function(item){ return String(item.symbol || "").toUpperCase() === sym; });
          return market ? Number(market.priceUsd || market.usd || 0) : 0;
        } catch(e) { return 0; }
      }
      function assetAmountNumber(asset){
        var raw = String(asset && asset.amt || "0").split(" ")[0].replace(/,/g, "");
        var n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      }
      function formatHomeAssetAmount(asset){
        var amount = assetAmountNumber(asset);
        var symbol = String(asset && asset.sym || "").toUpperCase();
        if (!Number.isFinite(amount) || amount <= 0) return "0 " + symbol;
        if (amount < 0.01) return "<0.01 " + symbol;
        return amount.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + symbol;
      }
      function assetUsdValue(asset){
        if (asset && Number(asset.portfolioUsdNum) > 0) return Number(asset.portfolioUsdNum);
        var amount = assetAmountNumber(asset);
        var price = priceForHome(asset && asset.sym);
        if (amount > 0 && price > 0) return amount * price;
        return Number(asset && asset.usdNum || 0);
      }
      window.__luminaRecomputeTotalWithEarn = function(){
        var base = Number(window.__luminaWalletBaseTotalUsd || 0);
        var earn = Number(window.__luminaEarnTotalUsd || 0);
        totalUsdNum = base + (Number.isFinite(earn) ? earn : 0);
        var balEl = document.getElementById("balAmt");
        if (balEl && !(typeof hidden !== "undefined" && hidden)) balEl.textContent = formatMoney(totalUsdNum);
        if (typeof window.__luminaApplyBalancePrivacy === "function") window.__luminaApplyBalancePrivacy();
      };
      function refreshHomeTotalFromAssets(homeAssets){
        var rows = Array.isArray(homeAssets) ? homeAssets : (assets || []).filter(showOnHome);
        var total = rows.reduce(function(sum, asset){ return sum + assetUsdValue(asset); }, 0);
        var change = rows.reduce(function(sum, asset){
          var value = assetUsdValue(asset);
          var sym = String(asset && asset.sym || "").toUpperCase();
          var pct = 0;
          try { pct = Number(tokenChanges24h && tokenChanges24h[sym]); } catch(e) { pct = 0; }
          return sum + (Number.isFinite(pct) ? value * pct / 100 : 0);
        }, 0);
        var earnTotal = Number(window.__luminaEarnTotalUsd || 0);
        window.__luminaWalletBaseTotalUsd = total;
        totalUsdNum = total + (Number.isFinite(earnTotal) ? earnTotal : 0);
        change24hUsdNum = change;
        var balEl = document.getElementById("balAmt");
        if (balEl && !(typeof hidden !== "undefined" && hidden)) balEl.textContent = formatMoney(totalUsdNum);
        var subEl = document.getElementById("balSub");
        if (subEl) {
          var sign = Number(change24hUsdNum) >= 0 ? "+" : "";
          subEl.textContent = sign + formatMoney(change24hUsdNum) + " (24h)";
        }
        if (typeof window.__luminaApplyBalancePrivacy === "function") window.__luminaApplyBalancePrivacy();
      }
      window.__luminaRefreshHomeTotalFromAssets = refreshHomeTotalFromAssets;
      function rowHtml(asset, index, imported){
        var symbol = String(asset.sym || "").toUpperCase();
        var logoSource = asset.logo || (tokenLogo && tokenLogo[symbol]) || tokenInitialHome(asset.sym);
        var logoHtml = window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(asset.sym, logoSource) : logoSource;
        var usdValue = assetUsdValue(asset);
        if (asset && usdValue > 0) asset.usdNum = usdValue;
        return '<div class="asset home-v2-asset" data-home-symbol="' + symbol + '" data-home-index="' + index + '" data-home-imported="' + (imported ? "1" : "0") + '">' +
          '<div class="coin ' + (asset.cls || "custom") + '">' + logoHtml + '</div>' +
          '<div class="name"><div class="sym">' + asset.sym + '</div><div class="full">' + asset.full + '</div></div>' +
          '<div class="vals"><div class="amt">' + formatHomeAssetAmount(asset) + '</div><div class="usd">' + (usdValue > 0 && typeof formatMoney === "function" ? formatMoney(usdValue) : "—") + '</div></div>' +
          '<span class="home-asset-chev">›</span>' +
        '</div>';
      }
      renderAssets = function(){
        ensureHomeShell();
        var list = document.getElementById("assetList");
        if (!list) return;
        var filter = "";
        var search = document.getElementById("homeTokenSearch");
        if (search) filter = String(search.value || "").toLowerCase().trim();
        var verified = (assets || []).filter(function(a){
          return showOnHome(a) && (!filter || (a.sym + " " + a.full).toLowerCase().indexOf(filter) >= 0);
        });
        var html = verified.map(function(a){ return rowHtml(a, (assets || []).indexOf(a), false); }).join("");
        refreshHomeTotalFromAssets();
        html += '<button class="home-add-token-row" type="button" onclick="openTokenModal(\\'buy\\')"><span>＋</span> Add Token</button>';
        list.innerHTML = html || '<div class="article-empty">No assets detected yet</div>';
        list.ontouchstart = function(event){
          var touch = event.touches && event.touches[0];
          if (!touch) return;
          window.__luminaHomeTapMoved = false;
          window.__luminaHomeTapStart = { x: touch.clientX, y: touch.clientY };
          var row = event.target && event.target.closest ? event.target.closest(".home-v2-asset") : null;
          if (row && list.contains(row)) setHomeDebug("touchstart", { symbol:row.getAttribute("data-home-symbol"), x:touch.clientX, y:touch.clientY });
        };
        list.ontouchmove = function(event){
          if (!isCleanHomeTap(event)) {
            window.__luminaHomeTapMoved = true;
            var row = event.target && event.target.closest ? event.target.closest(".home-v2-asset") : null;
            if (row && list.contains(row)) setHomeDebug("touchmove:block-click", { symbol:row.getAttribute("data-home-symbol") });
          }
        };
        list.onclick = function(event){
          var row = event.target && event.target.closest ? event.target.closest(".home-v2-asset") : null;
          if (!row || !list.contains(row)) return;
          if (window.__luminaHomeTapMoved || !isCleanHomeTap(event)) {
            setHomeDebug("click:blocked-by-move", { symbol:row.getAttribute("data-home-symbol"), tapMoved:!!window.__luminaHomeTapMoved });
            window.__luminaHomeTapMoved = false;
            return;
          }
          window.__luminaHomeTapMoved = false;
          setHomeDebug("click:open-row", { symbol:row.getAttribute("data-home-symbol"), target:event && event.target && event.target.className });
          window.__luminaOpenHomeRow(event, row);
        };
      };
      ensureHomeShell();
      ensureHomeDebugButton();
      renderAssets();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance home prototype");
}

/**
 * Replaces fake gainers and placeholder token changes with World Chain pool market data.
 */
function enhancePrototypeMarket() {
  const source = `
    (function(){
      window.__luminaMarketBySymbol = window.__luminaMarketBySymbol || {};
      function iconFor(symbol, fallback){
        if (window.__luminaTokenLogoHtml) return window.__luminaTokenLogoHtml(symbol, fallback);
        return "";
      }
      function coinHtml(asset){
        return '<div class="coin ' + (asset.cls || "custom") + '">' + iconFor(asset.sym, asset.logo) + '</div>';
      }
      function moneyCompact(value){
        var n = Number(value || 0);
        if (!Number.isFinite(n) || n <= 0) return "—";
        if (n >= 1000000) return "$" + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
        if (n >= 1000) return "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
        return "$" + n.toFixed(0);
      }
      function formatMarketPrice(value){
        var n = Number(value || 0);
        if (!n) return "No price";
        if (n < 0.0001) return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 });
        if (n < 0.01) return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
        if (n < 1) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 4 });
        return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 4 });
      }
      function verifyStatus(item){
        var sym = String(item && item.symbol || "").toUpperCase();
        var configured = window.__luminaBackendTokenBySymbol && window.__luminaBackendTokenBySymbol[sym];
        var market = window.__luminaMarketBySymbol && window.__luminaMarketBySymbol[sym];
        var status = String((configured && configured.status) || (market && market.status) || (item && item.status) || "").toLowerCase();
        if (status === "verified") return "verified";
        if (status === "rejected" || status === "high" || status === "danger") return "rejected";
        if (status === "pending" || status === "community" || status === "unverified") return "pending";
        if ((market && market.verified === true) || (item && item.verified === true)) return "verified";
        return "pending";
      }
      function verifyBadge(item){
        var status = verifyStatus(item);
        if (status === "verified") return '<span class="token-verify-badge ok" title="Verified" aria-label="Verified"></span>';
        if (status === "rejected") return '<span class="token-verify-badge danger" title="High risk" aria-label="High risk"></span>';
        return '<span class="token-verify-badge warn" title="Unverified" aria-label="Unverified"></span>';
      }
      function setIcon(el, symbol, fallback){
        if (!el) return;
        el.innerHTML = iconFor(symbol, fallback);
      }
      function applyTokenLogos(){
        tokenLogo.WLD = iconFor("WLD", "");
        tokenLogo.USDC = iconFor("USDC", "");
        tokenLogo.USDT = iconFor("USDT", "");
        tokenLogo.ETH = iconFor("ETH", "");
        tokenLogo.BTC = iconFor("BTC", "");
        (assets || []).forEach(function(asset){
          if (!asset || !asset.sym) return;
          asset.logo = iconFor(asset.sym, (tokenLogo && tokenLogo[asset.sym]) || asset.logo);
        });
      }
      function registerMarketToken(market){
        var sym = market.symbol;
        var existingMarket = window.__luminaMarketBySymbol[sym];
        var explicitStatus = String(market.status || "").toLowerCase();
        var existingStatus = String(existingMarket && existingMarket.status || "").toLowerCase();
        var resolvedStatus = explicitStatus || existingStatus || (market.verified ? "verified" : "pending");
        var resolvedVerified = resolvedStatus === "verified";
        market = Object.assign({}, existingMarket || {}, market, { status: resolvedStatus, verified: resolvedVerified });
        if (market.logoUrl && window.__luminaSetTokenLogoUrl) window.__luminaSetTokenLogoUrl(sym, market.logoUrl);
        prices[sym] = market.priceUsd || 0;
        dotColor[sym] = sym === "WLD" ? "#fff" : "linear-gradient(135deg,#1b231e,#26362b)";
        tokenFull[sym] = market.name || sym;
        tokenLogo[sym] = iconFor(sym, tokenLogo[sym] || market.symbol);
        tokenChanges24h = tokenChanges24h || {};
        tokenChanges24h[sym] = market.change24h;
        window.__luminaMarketBySymbol[sym] = market;
        if (market.address && customTokens && !["WLD","USDC","USDT","ETH","WETH","BTC","WBTC","EURC"].includes(String(sym).toUpperCase())) {
          customTokens[sym] = {
            symbol: sym,
            name: market.name || sym,
            address: market.address,
            decimals: Number.isFinite(Number(market.decimals)) ? Number(market.decimals) : 18,
            logoUrl: market.logoUrl || null,
            priceUsd: Number(market.priceUsd || 0),
            status: resolvedStatus,
            trust: resolvedVerified ? "audited" : "community"
          };
        }
        if (balances[sym] === undefined) balances[sym] = "0";
        (assets || []).forEach(function(asset){
          if (String(asset.sym || "").toUpperCase() !== String(sym).toUpperCase()) return;
          var amount = Number(String(asset.amt || "0").split(" ")[0].replace(/,/g, ""));
          if (Number.isFinite(amount) && amount > 0 && Number(market.priceUsd) > 0) asset.usdNum = amount * Number(market.priceUsd);
        });
        return market;
      }
      function openMarketDetail(symbol){
        var market = window.__luminaMarketBySymbol[symbol];
        if (!market) return;
        registerMarketToken(market);
        var idx = (assets || []).findIndex(function(asset){ return asset.sym === symbol && asset.marketOnly; });
        if (idx < 0) {
          idx = assets.length;
          assets.push({
            sym: symbol,
            full: market.name || symbol,
            amt: (balances[symbol] || "0") + " " + symbol,
            usdNum: 0,
            cls: symbol === "WLD" ? "wld" : "custom",
            logo: iconFor(symbol, symbol),
            marketOnly: true,
            marketAddress: market.address,
            status: market.status || (market.verified ? "verified" : "pending"),
            marketChange24h: market.change24h
          });
        } else {
          assets[idx].status = market.status || (market.verified ? "verified" : "pending");
        }
        openDetail(idx);
      }
      window.openMarketDetail = openMarketDetail;
      window.__luminaRegisterMarketToken = registerMarketToken;
      var marketTab = "gainers";
      function marketLang(){
        return (window.currentLang || "en") === "zh-CN" ? "zh-CN" : "en";
      }
      function marketCopy(key){
        var zh = marketLang() === "zh-CN";
        var copy = {
          gainers: zh ? "24h 涨幅" : "24h Gainers",
          losers: zh ? "24h 跌幅" : "24h Losers",
          newest: zh ? "新币" : "New Tokens",
          tabGainers: zh ? "涨幅" : "Gainers",
          tabLosers: zh ? "跌幅" : "Losers",
          tabNewest: zh ? "新币" : "New",
          emptyPrefix: zh ? "暂无" : "No ",
          emptySuffix: zh ? "数据" : " data yet",
          loading: zh ? "正在读取行情..." : "Loading market data...",
          meta: "24h · on-chain",
          note: zh
            ? "以下为链上 24h 行情排行,仅为市场数据,非投资建议。新币和高波动代币风险更高。"
            : "On-chain 24h market rankings. Market data only, not investment advice. New and volatile tokens carry higher risk."
        };
        return copy[key] || key;
      }
      function marketTabTitle(){
        if (marketTab === "losers") return marketCopy("losers");
        if (marketTab === "new") return marketCopy("newest");
        return marketCopy("gainers");
      }
      function ensureMarketTabs(){
        if (document.getElementById("marketTabs")) return;
        var head = document.querySelector(".gainers-head");
        if (!head) return;
        var tabs = document.createElement("div");
        tabs.id = "marketTabs";
        tabs.className = "market-tabs";
        tabs.innerHTML =
          '<button type="button" data-tab="gainers" class="sel"><span></span><i aria-hidden="true"></i></button>' +
          '<button type="button" data-tab="losers"><span></span><i aria-hidden="true"></i></button>' +
          '<button type="button" data-tab="new"><span></span><i aria-hidden="true"></i></button>';
        head.insertAdjacentElement("afterend", tabs);
        tabs.addEventListener("click", function(event){
          var btn = event.target && event.target.closest ? event.target.closest("button[data-tab]") : null;
          if (!btn) return;
          marketTab = btn.getAttribute("data-tab") || "gainers";
          renderGainers();
        });
      }
      function updateMarketTabs(){
        ensureMarketTabs();
        document.querySelectorAll("#marketTabs button").forEach(function(btn){
          var tab = btn.getAttribute("data-tab");
          btn.classList.toggle("sel", tab === marketTab);
          var span = btn.querySelector("span");
          if (span) {
            span.textContent = tab === "losers" ? marketCopy("tabLosers") : (tab === "new" ? marketCopy("tabNewest") : marketCopy("tabGainers"));
          }
        });
        var title = document.querySelector(".gainers-head .l");
        if (title) title.textContent = marketTabTitle();
        var meta = document.querySelector(".gainers-head .r");
        if (meta) meta.textContent = marketCopy("meta");
        var note = document.querySelector(".gainers-note span:last-child");
        if (note) note.textContent = marketCopy("note");
      }
      function renderGainersFromMarkets(markets){
        var box = document.getElementById("gainersList");
        if (!box) return;
        updateMarketTabs();
        if (!markets.length) {
          box.innerHTML = '<div class="import-load">' + marketCopy("emptyPrefix") + marketTabTitle() + marketCopy("emptySuffix") + '</div>';
          return;
        }
        box.innerHTML = markets.map(function(g, i){
          g = registerMarketToken(g) || g;
          var rankCls = i < 3 ? "rank top" : "rank";
          var bg = g.symbol === "WLD" ? "#fff" : "linear-gradient(135deg,#1b231e,#26362b)";
          var color = g.symbol === "WLD" ? "#000" : "#fff";
          var pctClass = Number(g.change24h || 0) >= 0 ? "pct" : "pct down";
          var routeBadge = g.address ? "" : '<span class="market-route-badge">Market only</span>';
          var verify = verifyBadge(g);
          return '<div class="gainer" onclick="openMarketDetail(\\'' + g.symbol + '\\')">' +
            '<div class="' + rankCls + '">' + (i + 1) + '</div>' +
            '<div class="ic" style="background:' + bg + ';color:' + color + '">' + iconFor(g.symbol, g.symbol.slice(0, 3)) + '</div>' +
            '<div class="mid"><div class="s">' + g.symbol + verify + routeBadge + '</div><div class="p">' + formatMarketPrice(g.priceUsd) + '</div></div>' +
            '<div class="chg"><div class="' + pctClass + '">' + (Number(g.change24h || 0) >= 0 ? "+" : "") + Number(g.change24h || 0).toFixed(2) + '%</div><div class="vol">Vol ' + moneyCompact(g.volume24hUsd) + '</div></div>' +
          '</div>';
        }).join("");
      }
      function marketsFromCoinGecko(payload){
        if (!payload) return [];
        var coreVolumes = { WLD: 435327121, USDC: 7939337368, ETH: 383239, BTC: 45000000 };
        return ["WLD","USDC","ETH","BTC"].map(function(sym){
          var row = payload[sym];
          if (!row || typeof row !== "object") return null;
          return {
            symbol: sym,
            name: tokenFull[sym] || (sym === "BTC" ? "Bitcoin" : sym),
            priceUsd: row.usd,
            change24h: row.usd_24h_change,
            volume24hUsd: coreVolumes[sym] || 0,
            liquidityUsd: row.usd_market_cap,
            marketCapUsd: row.usd_market_cap,
            logoUrl: null
          };
        }).filter(function(item){ return item && item.priceUsd; });
      }
      function registerMarketsFromPriceMeta(payload){
        try { marketsFromCoinGecko(payload).forEach(registerMarketToken); } catch(e) {}
      }
      applyTokenLogos();
      if (typeof renderGainers === "function") {
        renderGainers = function(pricePayload){
          updateMarketTabs();
          var box = document.getElementById("gainersList");
          if (box) box.innerHTML = '<div class="import-load">' + marketCopy("loading") + '</div>';
          var pricesPayload = pricePayload || window.__luminaMarketPrices || null;
          fetch("/api/tokens/top?mode=" + encodeURIComponent(marketTab), { cache: "no-store" }).then(function(res){ return res.ok ? res.json() : []; }).catch(function(){ return []; })
            .then(function(result){
              registerMarketsFromPriceMeta(pricesPayload);
              var cg = marketsFromCoinGecko(pricesPayload);
              var poolMarkets = Array.isArray(result) ? result : [];
              var merged = marketTab === "gainers" ? cg.map(function(item){
                var pool = poolMarkets.find(function(candidate){ return candidate.symbol === item.symbol; });
                return pool ? Object.assign({}, item, pool, { priceUsd: item.priceUsd || pool.priceUsd, change24h: item.change24h != null ? item.change24h : pool.change24h }) : item;
              }).concat(poolMarkets.filter(function(item){
                return !cg.some(function(existing){ return existing.symbol === item.symbol; });
              })) : poolMarkets;
              renderGainersFromMarkets(merged);
            })
            .catch(function(){ renderGainersFromMarkets([]); });
        };
        setTimeout(function(){ renderGainers(window.__luminaMarketPrices); }, 1200);
      }
      var previousRenderAssets = typeof renderAssets === "function" ? renderAssets : null;
      if (previousRenderAssets && !window.__luminaMarketRenderAssets) {
        window.__luminaMarketRenderAssets = true;
        renderAssets = function(){
          applyTokenLogos();
          previousRenderAssets();
          document.querySelectorAll(".coin.wld").forEach(function(el){ setIcon(el, "WLD", ""); });
        };
      }
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance market data");
}

/**
 * Connects the Swap view to read-only Uniswap v3 quotes. It does not submit transactions.
 */
function enhancePrototypeSwapQuote() {
  const source = `
	    (function(){
	      var quoteTimer = null;
	      var quoteSeq = 0;
	      var latestSwapQuote = null;
	      var latestQuoteAt = 0;
	      var activeQuotePromise = null;
	      var quoteCountdownTimer = null;
	      var SWAP_QUOTE_TTL_SECONDS = 180;
	      var SWAP_QUOTE_REFRESH_SECONDS = 180;
	      var swapSubmitting = false;
	      var highImpactAcknowledged = false;
	      var swapExecutionEnabled = ${process.env.NEXT_PUBLIC_SWAP_ENABLED === "true" ? "true" : "false"};
	      var swapMaxUsd = ${JSON.stringify(Number(process.env.NEXT_PUBLIC_SWAP_MAX_USD || "100000") || 100000)};
	      var configuredNetworkFeeLabel = "";
      function swapLang(){
        return window.currentLang || "en";
      }
      function swapCopy(key){
        var lang = swapLang();
        var copy = {
          confirmSwap: { en:"Confirm swap", "zh-CN":"确认兑换", "zh-TW":"確認兌換", fr:"Confirmer l'échange", de:"Swap bestätigen", es:"Confirmar intercambio", ja:"スワップを確認" },
          cancel: { en:"Cancel", "zh-CN":"取消", "zh-TW":"取消", fr:"Annuler", de:"Abbrechen", es:"Cancelar", ja:"キャンセル" },
          youPay: { en:"You pay", "zh-CN":"您要支付", "zh-TW":"您要支付", fr:"Vous payez", de:"Sie zahlen", es:"Pagas", ja:"支払う" },
          youReceiveApprox: { en:"You receive about", "zh-CN":"您将收到约", "zh-TW":"您將收到約", fr:"Vous recevrez environ", de:"Sie erhalten etwa", es:"Recibirás aprox.", ja:"受取予定" },
          minReceive: { en:"Minimum received (slippage protection)", "zh-CN":"最少收到 (滑点保护)", "zh-TW":"最少收到 (滑點保護)", fr:"Minimum reçu (protection slippage)", de:"Mindestens erhalten (Slippage-Schutz)", es:"Mínimo recibido (protección)", ja:"最低受取額 (スリッページ保護)" },
          riskAck: { en:"I understand the risk and want to continue.", "zh-CN":"我已了解风险,自愿继续此笔兑换。", "zh-TW":"我已了解風險,自願繼續此筆兌換。", fr:"Je comprends le risque et souhaite continuer.", de:"Ich verstehe das Risiko und möchte fortfahren.", es:"Entiendo el riesgo y quiero continuar.", ja:"リスクを理解し、このスワップを続行します。" },
          riskAcked: { en:"Risk acknowledged, you can continue", "zh-CN":"已确认风险,可以继续兑换", "zh-TW":"已確認風險,可以繼續兌換", fr:"Risque accepté, vous pouvez continuer", de:"Risiko bestätigt, Sie können fortfahren", es:"Riesgo aceptado, puedes continuar", ja:"リスク確認済み、続行できます" },
          ackRiskFirst: { en:"Please acknowledge the risk first", "zh-CN":"请先确认高风险交易", "zh-TW":"請先確認高風險交易", fr:"Veuillez d'abord accepter le risque", de:"Bitte zuerst das Risiko bestätigen", es:"Primero acepta el riesgo", ja:"先にリスクを確認してください" },
          submitted: { en:"Swap submitted", "zh-CN":"兑换已提交", "zh-TW":"兌換已提交", fr:"Échange envoyé", de:"Swap gesendet", es:"Intercambio enviado", ja:"スワップを送信しました" },
          waiting: { en:"Waiting for on-chain confirmation. Expected receive about", "zh-CN":"等待区块链确认中。预计收到约", "zh-TW":"等待區塊鏈確認中。預計收到約", fr:"En attente de confirmation on-chain. Réception prévue environ", de:"Warten auf On-chain-Bestätigung. Erwartet etwa", es:"Esperando confirmación on-chain. Recibirás aprox.", ja:"オンチェーン確認待ち。受取予定" },
          viewActivity: { en:"View Activity", "zh-CN":"查看活动", "zh-TW":"查看活動", fr:"Voir l'activité", de:"Aktivität anzeigen", es:"Ver actividad", ja:"Activity を見る" },
          networkFee: { en:"Network fee", "zh-CN":"网络费", "zh-TW":"網絡費", fr:"Frais réseau", de:"Netzwerkgebühr", es:"Comisión de red", ja:"ネットワーク手数料" },
          platformFee: { en:"Platform fee", "zh-CN":"平台手续费", "zh-TW":"平台手續費", fr:"Frais plateforme", de:"Plattformgebühr", es:"Comisión de plataforma", ja:"プラットフォーム手数料" },
          free: { en:"Free", "zh-CN":"免费", "zh-TW":"免費", fr:"Gratuit", de:"Kostenlos", es:"Gratis", ja:"無料" },
          enterAmount: { en:"Enter an amount to get a quote", "zh-CN":"输入金额后获取报价", "zh-TW":"輸入金額後取得報價", fr:"Saisissez un montant pour obtenir un devis", de:"Betrag eingeben, um ein Angebot zu erhalten", es:"Ingresa un importe para cotizar", ja:"金額を入力して見積もり" },
          readingRoute: { en:"Reading DEX route...", "zh-CN":"正在读取兑换路由...", "zh-TW":"正在讀取兌換路由...", fr:"Lecture de la route DEX...", de:"DEX-Route wird gelesen...", es:"Leyendo ruta DEX...", ja:"DEX ルートを読み込み中..." },
          noRoute: { en:"No executable route for this pair. Top rankings are market discovery only.", "zh-CN":"当前交易对暂无可执行路由。涨幅榜仅用于行情发现。", "zh-TW":"當前交易對暫無可執行路由。漲幅榜僅用於行情發現。", fr:"Aucune route exécutable pour cette paire.", de:"Keine ausführbare Route für dieses Paar.", es:"No hay ruta ejecutable para este par.", ja:"このペアの実行可能ルートはありません。" },
          signing: { en:"Signing...", "zh-CN":"签名中...", "zh-TW":"簽名中...", fr:"Signature...", de:"Signieren...", es:"Firmando...", ja:"署名中..." },
          submitting: { en:"Submitting transaction...", "zh-CN":"提交交易...", "zh-TW":"提交交易...", fr:"Envoi de la transaction...", de:"Transaktion wird gesendet...", es:"Enviando transacción...", ja:"取引を送信中..." },
          waitingChain: { en:"Waiting for confirmation...", "zh-CN":"等待区块链确认...", "zh-TW":"等待區塊鏈確認...", fr:"En attente de confirmation...", de:"Warten auf Bestätigung...", es:"Esperando confirmación...", ja:"確認待ち..." }
          ,swapFailed: { en:"Swap failed", "zh-CN":"交易失败", "zh-TW":"交易失敗", fr:"Échec de l'échange", de:"Swap fehlgeschlagen", es:"Intercambio fallido", ja:"スワップ失敗" }
          ,cancelled: { en:"Transaction cancelled", "zh-CN":"交易已取消", "zh-TW":"交易已取消", fr:"Transaction annulée", de:"Transaktion abgebrochen", es:"Transacción cancelada", ja:"取引をキャンセルしました" }
          ,transactionFailed: { en:"Transaction failed", "zh-CN":"交易失败", "zh-TW":"交易失敗", fr:"Transaction échouée", de:"Transaktion fehlgeschlagen", es:"Transacción fallida", ja:"取引に失敗しました" }
          ,priceImpactUnknown: { en:"Pool quote", "zh-CN":"池子报价", "zh-TW":"池子報價", fr:"Prix du pool", de:"Pool-Preis", es:"Precio del pool", ja:"プール見積" }
          ,communityRiskTitle: { en:"High-risk token", "zh-CN":"高风险代币", "zh-TW":"高風險代幣", fr:"Jeton à risque élevé", de:"Hochrisiko-Token", es:"Token de alto riesgo", ja:"高リスクトークン" }
          ,communityRiskBody: { en:"This token has not been reviewed by Lumina. Price, liquidity and sellability may change sharply.", "zh-CN":"该代币未经 Lumina 审核,价格、流动性和可卖出性可能剧烈波动。", "zh-TW":"該代幣未經 Lumina 審核,價格、流動性和可賣出性可能劇烈波動。", fr:"Ce jeton n'a pas été vérifié par Lumina. Prix, liquidité et revente peuvent varier fortement.", de:"Dieser Token wurde nicht von Lumina geprüft. Preis, Liquidität und Verkaufbarkeit können stark schwanken.", es:"Lumina no ha revisado este token. Precio, liquidez y venta pueden cambiar mucho.", ja:"このトークンは Lumina の審査を受けていません。価格、流動性、売却可否が大きく変動する可能性があります。" }
          ,lowLiquidityRisk: { en:"Low liquidity route. The execution price may move noticeably.", "zh-CN":"低流动性路由,成交价格可能明显变化。", "zh-TW":"低流動性路由,成交價格可能明顯變化。", fr:"Route à faible liquidité. Le prix d'exécution peut bouger.", de:"Route mit geringer Liquidität. Der Ausführungspreis kann sich deutlich bewegen.", es:"Ruta con baja liquidez. El precio puede moverse.", ja:"低流動性ルートです。約定価格が大きく動く可能性があります。" }
          ,priceAnomalyRisk: { en:"Quote is far from reference markets. Confirm only if you accept this price.", "zh-CN":"报价与参考行情偏离较大,请确认你接受该价格。", "zh-TW":"報價與參考行情偏離較大,請確認你接受該價格。", fr:"Le devis s'écarte des marchés de référence.", de:"Das Angebot weicht stark von Referenzmärkten ab.", es:"La cotización se aleja de mercados de referencia.", ja:"見積もりが参照市場から大きく離れています。" }
          ,impactRisk: { en:"Price impact is above 5%. Confirm only if you accept this price.", "zh-CN":"价格影响超过 5%,请确认你接受这个价格。", "zh-TW":"價格影響超過 5%,請確認你接受這個價格。", fr:"L'impact prix dépasse 5%.", de:"Preiseinfluss über 5%.", es:"Impacto de precio superior al 5%.", ja:"価格影響が 5% を超えています。" }
          ,quoteUpdated: { en:"Quote refreshed", "zh-CN":"报价已刷新", "zh-TW":"報價已刷新", fr:"Devis actualisé", de:"Angebot aktualisiert", es:"Cotización actualizada", ja:"見積もりを更新しました" }
          ,confirmInWorldApp: { en:"Confirm in World App...", "zh-CN":"请在 World App 确认...", "zh-TW":"請在 World App 確認...", fr:"Confirmez dans World App...", de:"In World App bestätigen...", es:"Confirma en World App...", ja:"World App で確認..." }
          ,submittedHint: { en:"Your transaction is in the queue. Activity will update after World Chain confirms it.", "zh-CN":"交易已进入队列,World Chain 确认后活动记录会自动更新。", "zh-TW":"交易已進入佇列,World Chain 確認後活動記錄會自動更新。", fr:"La transaction est en file. Activity se mettra à jour après confirmation.", de:"Die Transaktion ist in der Warteschlange. Activity aktualisiert sich nach Bestätigung.", es:"La transacción está en cola. Activity se actualizará al confirmar.", ja:"取引はキューに入りました。確認後 Activity が更新されます。" }
          ,checkActivityDetails: { en:"Check Activity for details.", "zh-CN":"请到活动页查看详情。", "zh-TW":"請到活動頁查看詳情。", fr:"Consultez l'activité pour les détails.", de:"Details finden Sie in Aktivität.", es:"Consulta Activity para ver detalles.", ja:"詳細は Activity で確認してください。" }
          ,limit: { en:"Single swap limit", "zh-CN":"单笔限额", "zh-TW":"單筆限額", fr:"Limite par swap", de:"Limit pro Swap", es:"Límite por swap", ja:"1回あたりの上限" }
          ,reduceAmount: { en:"Please reduce the amount.", "zh-CN":"请降低金额。", "zh-TW":"請降低金額。", fr:"Veuillez réduire le montant.", de:"Bitte Betrag reduzieren.", es:"Reduce el importe.", ja:"金額を下げてください。" }
          ,insufficientBalance: { en:"Insufficient balance", "zh-CN":"余额不足", "zh-TW":"餘額不足", fr:"Solde insuffisant", de:"Unzureichendes Guthaben", es:"Saldo insuficiente", ja:"残高不足" }
          ,slippageTooLow: { en:"Slippage cannot be 0. Please select at least 0.1%.", "zh-CN":"滑点不能设为 0,请至少选择 0.1%。", "zh-TW":"滑點不能設為 0,請至少選擇 0.1%。", fr:"Le slippage ne peut pas être 0. Sélectionnez au moins 0,1%.", de:"Slippage darf nicht 0 sein. Bitte mindestens 0,1% wählen.", es:"El slippage no puede ser 0. Selecciona al menos 0.1%.", ja:"スリッページは 0 にできません。0.1%以上を選択してください。" }
          ,quoteFirst: { en:"Please get a quote first.", "zh-CN":"请先获取报价。", "zh-TW":"請先取得報價。", fr:"Veuillez d'abord obtenir un devis.", de:"Bitte zuerst ein Angebot abrufen.", es:"Obtén una cotización primero.", ja:"先に見積もりを取得してください。" }
          ,unsupportedToken: { en:"Token not supported", "zh-CN":"暂不支持此代币", "zh-TW":"暫不支援此代幣", fr:"Jeton non pris en charge", de:"Token nicht unterstützt", es:"Token no compatible", ja:"未対応のトークン" }
          ,worldAppBlocked: { en:"Blocked by World App", "zh-CN":"World App 已拦截", "zh-TW":"World App 已攔截", fr:"Bloqué par World App", de:"Von World App blockiert", es:"Bloqueado por World App", ja:"World App がブロック" }
          ,approvalFailed: { en:"Approval failed", "zh-CN":"授权失败", "zh-TW":"授權失敗", fr:"Autorisation échouée", de:"Freigabe fehlgeschlagen", es:"Falló la autorización", ja:"承認に失敗" }
          ,sellRestricted: { en:"Sell may be restricted", "zh-CN":"可能限制卖出", "zh-TW":"可能限制賣出", fr:"Vente peut être limitée", de:"Verkauf evtl. eingeschränkt", es:"Venta posiblemente limitada", ja:"売却制限の可能性" }
          ,refreshQuoteShort: { en:"Refresh quote", "zh-CN":"请刷新报价", "zh-TW":"請刷新報價", fr:"Actualisez le devis", de:"Angebot aktualisieren", es:"Actualiza cotización", ja:"見積もりを更新" }
          ,quoteExpiredShort: { en:"Quote expired", "zh-CN":"报价已过期", "zh-TW":"報價已過期", fr:"Devis expiré", de:"Angebot abgelaufen", es:"Cotización vencida", ja:"見積期限切れ" }
        };
        return (copy[key] && (copy[key][lang] || copy[key].en)) || (typeof t === "function" ? t(key) : key);
      }
      function readSwapSystemConfig(){
        try {
          var cfg = JSON.parse(localStorage.getItem("ww_system_config") || "{}");
          configuredNetworkFeeLabel = String(cfg.swapNetworkFeeLabel || "").trim();
        } catch(e) {
          configuredNetworkFeeLabel = "";
        }
      }
      function networkFeeText(fallbackUsd){
        var value = configuredNetworkFeeLabel;
        if (!value && Number.isFinite(Number(fallbackUsd))) value = "~$" + Number(fallbackUsd).toFixed(2);
        if (!value) value = "—";
        return /fee\\s*:/i.test(value) || /网络费[:：]|網絡費[:：]/.test(value) ? value : swapCopy("networkFee") + ": " + value;
      }
      function platformFeeText(quote){
        var fee = quote && quote.platformFee ? quote.platformFee : null;
        if (!fee) return swapCopy("free");
        var bps = Number(fee.bps);
        var pct = Number.isFinite(bps) ? (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2) + "%" : String(fee.percent || "");
        var amount = fee.amount ? shortAmount(fee.amount) + " " + swapState.buy : "";
        return amount ? pct + " (" + amount + ")" : pct;
      }
      window.__luminaApplySwapSystemConfig = function(){
        readSwapSystemConfig();
        var gas = feeEl();
        if (gas) gas.textContent = networkFeeText(latestSwapQuote && latestSwapQuote.gasEstimateUsd);
        setSwapButtonPending();
      };
      readSwapSystemConfig();
      function resetInitialSwapAmounts(){
        var sell = document.getElementById("sellAmt");
        var buy = document.getElementById("buyAmt");
        if (sell && !sell.dataset.luminaClearedDefault) {
          sell.dataset.luminaClearedDefault = "1";
          if (String(sell.value || "") === "100") sell.value = "";
          sell.setAttribute("placeholder", "0");
        }
        if (buy && !buy.dataset.luminaClearedDefault) {
          buy.dataset.luminaClearedDefault = "1";
          if (String(buy.value || "") === "543.20") buy.value = "";
          buy.setAttribute("placeholder", "0");
        }
      }
      function shortAmount(value){
        var raw = String(value == null ? "" : value).replace(/,/g, "").trim();
        var n = Number(raw);
        if (!Number.isFinite(n)) return "—";
        if (n === 0) return "0";
        var digits = Math.abs(n) < 0.00001 ? 12 : Math.abs(n) < 1 ? 8 : 6;
        var display = n.toLocaleString("en-US", { useGrouping:false, maximumFractionDigits: digits });
        return display === "0" ? raw.replace(/(\\.\\d*?[1-9])0+$/, "$1").replace(/\\.0+$/, "") : display;
      }
      function slippageBps(){
        var txt = (document.getElementById("slipTxt") && document.getElementById("slipTxt").textContent || "0.5%").replace("%", "");
        var n = Number(txt);
        return Number.isFinite(n) ? Math.round(n * 100) : 50;
      }
      function feeEl(){
        var rows = document.querySelectorAll(".swap-detail .ln");
        return rows[3] ? rows[3].querySelector("span:last-child") : null;
      }
      function ensureQuoteBox(){
        var oldCompare = document.getElementById("quoteCompareBox");
        if (oldCompare) oldCompare.remove();
        var warnBox = document.getElementById("quoteWarning");
        if (warnBox) return warnBox;
        var detail = document.querySelector(".swap-detail");
        if (!detail) return null;
        detail.insertAdjacentHTML("afterend", '<div class="quote-warning" id="quoteWarning"></div>');
        return document.getElementById("quoteWarning");
      }
      function escapeDebugHtml(value){
        return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch){
          return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch];
        });
      }
      function safeDebugValue(value, depth){
        if (depth > 5) return "[depth-limit]";
        if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        if (value instanceof Error) return readableSwapError(value);
        if (Array.isArray(value)) return value.slice(0, 24).map(function(item){ return safeDebugValue(item, depth + 1); });
        if (typeof value === "object") {
          var out = {};
          Object.keys(value).slice(0, 80).forEach(function(key){
            if (/private|secret|mnemonic|seed/i.test(key)) return;
            try { out[key] = safeDebugValue(value[key], depth + 1); } catch(e) { out[key] = "[unreadable]"; }
          });
          return out;
        }
        return String(value);
      }
      function swapDebugContext(extra){
        var sellSymbol = swapState && swapState.sell;
        var buySymbol = swapState && swapState.buy;
        var sellMeta = null;
        var buyMeta = null;
        try { sellMeta = sellSymbol ? tokenMeta(sellSymbol, latestSwapQuote && latestSwapQuote.tokens && latestSwapQuote.tokens.from) : null; } catch(e) {}
        try { buyMeta = buySymbol ? tokenMeta(buySymbol, latestSwapQuote && latestSwapQuote.tokens && latestSwapQuote.tokens.to) : null; } catch(e) {}
        return Object.assign({
          at: new Date().toISOString(),
          page: "swap",
          sell: sellSymbol,
          buy: buySymbol,
          amount: (document.getElementById("sellAmt") && document.getElementById("sellAmt").value) || "",
          receive: (document.getElementById("buyAmt") && document.getElementById("buyAmt").value) || "",
          balance: sellSymbol ? balanceNumber(sellSymbol) : 0,
          sellToken: sellMeta,
          buyToken: buyMeta,
          balances: {
            sell: sellSymbol ? balanceNumber(sellSymbol) : 0,
            buy: buySymbol ? balanceNumber(buySymbol) : 0
          },
          slippageBps: slippageBps(),
          userAddress: window.__luminaUserAddress || "",
          worldApp: !!window.MiniKit,
          executionEnabled: swapExecutionEnabled,
          quoteAgeSeconds: latestQuoteAt ? Math.floor((Date.now() - latestQuoteAt) / 1000) : null,
          quote: latestSwapQuote ? {
            source: latestSwapQuote.source,
            amountIn: latestSwapQuote.amountIn,
            amountOut: latestSwapQuote.amountOut,
            rate: latestSwapQuote.rate,
            fee: latestSwapQuote.fee,
            platformFee: latestSwapQuote.platformFee || null,
            feeConfig: latestSwapQuote.platformFee ? { bps: latestSwapQuote.platformFee.bps, recipient: latestSwapQuote.platformFee.recipient } : null,
            routeSymbols: latestSwapQuote.routeSymbols,
            priceImpactPercent: latestSwapQuote.priceImpactPercent,
            priceImpactLevel: latestSwapQuote.priceImpactLevel,
            priceImpactAvailable: latestSwapQuote.priceImpactAvailable,
            blocked: latestSwapQuote.blocked,
            blockReason: latestSwapQuote.blockReason
          } : null
        }, extra || {});
      }
      function setSwapDebug(stage, detail){
        return;
      }
      function readSwapDebug(){
        return null;
      }
      function openSwapDebug(){
        var existingModal = document.getElementById("swapDebugModal");
        if (existingModal) existingModal.remove();
        var old = document.getElementById("swapDebugModal");
        if (old) old.remove();
      }
      function ensureSwapDebugButton(){
        var existing = document.getElementById("swapDebugBtn");
        if (existing) existing.remove();
      }
      function formatMaxAmount(value){
        var n = Number(String(value == null ? "" : value).replace(/,/g, "").replace(/^</, ""));
        if (!Number.isFinite(n) || n <= 0) return "0";
        return shortAmount(n);
      }
      function fillSwapMax(){
        var sell = document.getElementById("sellAmt");
        if (!sell) return;
        sell.value = formatMaxAmount(balanceNumber(swapState.sell));
        sell.dispatchEvent(new Event("input", { bubbles: true }));
        setSwapDebug("input:max", { amount: sell.value, token: swapState.sell });
        scheduleQuote();
      }
      function ensureSwapMaxButton(){
        var sell = document.getElementById("sellAmt");
        if (!sell || document.getElementById("swapMaxBtn")) return;
        var parent = sell.parentElement;
        if (!parent) return;
        var wrap = document.createElement("div");
        wrap.className = "swap-amount-wrap";
        parent.insertBefore(wrap, sell);
        wrap.appendChild(sell);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.id = "swapMaxBtn";
        btn.className = "swap-max-btn";
        btn.textContent = "MAX";
        btn.onclick = fillSwapMax;
        wrap.appendChild(btn);
      }
	      function setSwapButtonState(label, disabled){
	        var btn = document.getElementById("swapBtn");
	        if (!btn) return;
	        btn.classList.remove("quote-only");
	        btn.disabled = !!disabled;
	        btn.setAttribute("aria-disabled", disabled ? "true" : "false");
	        var span = btn.querySelector("span");
	        if (span) span.textContent = label;
	      }
	      function setSwapButtonPending(){
	        if (!swapExecutionEnabled) {
	          setSwapButtonState("Swap disabled for Tenderly verification", true);
	          return;
	        }
	        var sell = document.getElementById("sellAmt");
	        var amount = sell ? Number(String(sell.value || "").replace(/,/g, "")) : 0;
	        var price = tokenMeta(swapState.sell, latestSwapQuote && latestSwapQuote.tokens && latestSwapQuote.tokens.from).priceUsd;
	        if (Number.isFinite(amount) && amount > 0 && Number.isFinite(Number(price)) && amount * Number(price) > swapMaxUsd) {
	          setSwapButtonState(swapCopy("limit") + " $" + swapMaxUsd, true);
	          return;
	        }
	        setSwapButtonState(swapCopy("confirmSwap"), false);
	      }
      function tokenInputForQuote(symbol){
        var meta = customTokens && customTokens[symbol] ? customTokens[symbol] : null;
        return meta && meta.address ? meta.address : symbol;
      }
      function tokenLogoForSwap(symbol){
        if (window.__luminaTokenLogoHtml) return window.__luminaTokenLogoHtml(symbol, tokenLogo && tokenLogo[symbol] ? tokenLogo[symbol] : symbol);
        return tokenLogo && tokenLogo[symbol] ? tokenLogo[symbol] : String(symbol || "?").slice(0, 1);
      }
      function setSwapPillLogo(id, symbol){
        var el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = tokenLogoForSwap(symbol);
        el.className = "dot2 coin " + String(symbol || "").toLowerCase();
        el.style.background = symbol === "WLD" ? "#fff" : (dotColor && dotColor[symbol] ? dotColor[symbol] : "linear-gradient(135deg,#1b231e,#26362b)");
        el.style.color = symbol === "WLD" ? "#000" : "#fff";
      }
	      function setQuoteState(message, impactClass, clearQuote){
	        ensureQuoteBox();
	        if (clearQuote !== false) {
	          latestSwapQuote = null;
	          latestQuoteAt = 0;
	        }
        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        var warn = document.getElementById("quoteWarning");
        if (buy && (clearQuote !== false || !latestSwapQuote)) buy.value = "—";
        if (rate) rate.textContent = message;
        if (impact) { impact.textContent = "—"; impact.className = impactClass || "impact-mid"; }
        if (gas) gas.textContent = networkFeeText();
        if (warn) { warn.classList.remove("show"); warn.textContent = ""; }
      }
      function formatRate(value){
        var n = Number(String(value == null ? "" : value).replace(/,/g, ""));
        if (!Number.isFinite(n) || n <= 0) return "—";
        var digits = n < 0.00001 ? 12 : n < 1 ? 8 : 6;
        return n.toLocaleString("en-US", { maximumFractionDigits: digits });
      }
      function referenceRow(label, ref, suffix){
        var available = ref && ref.available !== false && ref.rate;
        var mark = ref && ref.selected ? ' <span class="quote-current">✓ 当前</span>' : "";
        var right = available ? ("1 " + swapState.sell + " = " + formatRate(ref.rate) + " " + swapState.buy + mark) : "—";
        return '<div class="quote-ref-row"><span>' + label + '</span><strong>' + right + (suffix || "") + '</strong></div>';
      }
      function renderReferences(data){
        var oldCompare = document.getElementById("quoteCompareBox");
        if (oldCompare) oldCompare.remove();
      }
      function renderWarning(data){
        var warn = document.getElementById("quoteWarning");
        if (!warn) return;
        var text = "";
        if (data.blocked) text = data.blockReason || "Quote risk is too high. Swap is blocked.";
        warn.textContent = text;
        warn.classList.toggle("show", !!text);
      }
	      function applyQuote(data){
	        ensureQuoteBox();
	        latestSwapQuote = data;
	        latestQuoteAt = Date.now();
	        highImpactAcknowledged = false;
	        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        if (buy) buy.value = shortAmount(data.amountOut);
        if (rate && data.rate) {
          rate.textContent = "1 " + swapState.sell + " ≈ " + formatRate(data.rate) + " " + swapState.buy;
        }
        if (impact) {
          if (data.priceImpactAvailable === false || data.priceImpactPercent === null || data.priceImpactLevel === "unknown") {
            impact.textContent = swapCopy("priceImpactUnknown");
            impact.className = "impact-mid";
          } else {
            var p = Number(data.priceImpactPercent || 0);
            impact.textContent = p < 0.01 ? "<0.01%" : p.toFixed(2) + "%";
            impact.className = data.priceImpactLevel === "green" ? "impact-low" : (data.priceImpactLevel === "yellow" ? "impact-mid" : "impact-high");
          }
        }
        if (gas) gas.textContent = networkFeeText(data.gasEstimateUsd);
        renderReferences(data);
        renderWarning(data);
        setSwapButtonPending();
      }
      async function requestQuote(){
        setSwapButtonPending();
        var sell = document.getElementById("sellAmt");
        var amount = sell ? String(sell.value || "").trim() : "";
        if (!amount || Number(amount) <= 0) {
          setQuoteState(swapCopy("enterAmount"));
          return;
        }
        var seq = ++quoteSeq;
        setSwapDebug("quote:request", {
          fromToken: tokenInputForQuote(swapState.sell),
          toToken: tokenInputForQuote(swapState.buy),
          fromSymbol: swapState.sell,
          toSymbol: swapState.buy,
          fromAmount: amount
        });
        setQuoteState(swapCopy("readingRoute"), undefined, false);
        var promise = (async function(){
          var res = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fromToken: tokenInputForQuote(swapState.sell),
              toToken: tokenInputForQuote(swapState.buy),
              fromSymbol: swapState.sell,
              toSymbol: swapState.buy,
              fromAmount: amount,
              slippageBps: slippageBps()
            })
          });
          var data = await res.json();
          if (seq !== quoteSeq) return;
          if (!res.ok) throw new Error(data.error || "No quote");
          applyQuote(data);
          setSwapDebug("quote:success", data);
          return data;
        })();
        activeQuotePromise = promise;
        try {
          return await promise;
        } catch(e) {
          if (seq !== quoteSeq) return;
          var msg = e && e.message ? e.message : "Quote failed";
          if (/No Uniswap|No quote|not supported|Cannot resolve/i.test(msg)) msg = swapCopy("noRoute");
          setQuoteState(msg, "impact-high");
          setSwapDebug("quote:error", readableSwapError(e));
        } finally {
          if (activeQuotePromise === promise) activeQuotePromise = null;
        }
      }
	      function scheduleQuote(){
	        clearTimeout(quoteTimer);
	        quoteTimer = setTimeout(requestQuote, 300);
	      }
	      function tokenMeta(symbol, quoted){
	        var meta = quoted || (customTokens && customTokens[symbol] ? customTokens[symbol] : null);
	        var known = (typeof tokens !== "undefined" && tokens.find) ? tokens.find(function(t){ return t.sym === symbol || t.symbol === symbol; }) : null;
	        var price = null;
	        try {
	          price = prices && prices[symbol] ? Number(prices[symbol]) : null;
	          if ((!price || !Number.isFinite(price)) && window.__luminaMarketPrices) {
	            var market = window.__luminaMarketPrices.find(function(item){ return item.symbol === symbol; });
	            price = market ? Number(market.priceUsd || market.usd) : price;
	          }
	        } catch(e) {}
	        return {
	          symbol: symbol,
	          name: (meta && meta.name) || (known && (known.name || known.full)) || symbol,
	          address: meta && meta.address ? meta.address : tokenInputForQuote(symbol),
	          decimals: Number((meta && meta.decimals) || (known && known.decimals) || (symbol === "USDC" || symbol === "EURC" ? 6 : 18)),
	          priceUsd: Number.isFinite(price) ? price : undefined
	        };
	      }
	      function upsertRecentSwapHomeAsset(symbol, quoted, amountHint){
	        symbol = String(symbol || "").toUpperCase();
	        if (!symbol) return;
	        var meta = tokenMeta(symbol, quoted);
	        var marketMeta = window.__luminaMarketBySymbol && window.__luminaMarketBySymbol[symbol];
	        var tokenStatus = (marketMeta && marketMeta.status) || (quoted && quoted.status) || (customTokens && customTokens[symbol] && customTokens[symbol].status) || "pending";
	        var amount = Number(amountHint || 0);
	        var existing = (assets || []).find(function(asset){ return String(asset && asset.sym || "").toUpperCase() === symbol; });
	        tokenFull[symbol] = meta.name || tokenFull[symbol] || symbol;
	        tokenLogo[symbol] = window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(symbol, tokenLogo[symbol] || symbol.slice(0,1)) : (tokenLogo[symbol] || symbol.slice(0,1));
	        if (!dotColor[symbol]) dotColor[symbol] = "linear-gradient(135deg,#1b231e,#26362b)";
	        if (amount > 0 && (!balances[symbol] || Number(String(balances[symbol]).replace(/,/g, "")) <= 0)) {
	          balances[symbol] = shortAmount(amount);
	          availMap[symbol] = balances[symbol] + " " + symbol;
	        }
	        var amountText = amount > 0 ? shortAmount(amount) : (balances[symbol] || "0");
	        if (window.__luminaRememberSwapAsset) {
	          window.__luminaRememberSwapAsset({
	            symbol: symbol,
	            name: meta.name || symbol,
	            contractAddr: meta.address || null,
	            address: meta.address || null,
	            decimals: meta.decimals || 18,
	            amount: amountText,
	            usdNum: 0,
	            status: tokenStatus,
	            canSwap: true
	          });
	        }
	        var displayAmount = balances[symbol] || amountText;
	        var price = Number(meta.priceUsd || prices[symbol] || 0);
	        var usdNum = amount > 0 && price > 0 ? amount * price : 0;
	        if (existing) {
	          existing.full = tokenFull[symbol] || meta.name || symbol;
	          existing.amt = displayAmount + " " + symbol;
	          existing.usdNum = usdNum || existing.usdNum || 0;
	          existing.address = meta.address || existing.address || null;
	          existing.logo = tokenLogo[symbol] || existing.logo || symbol.slice(0,1);
	          existing.status = tokenStatus;
	          existing.recentSwapAsset = true;
	          existing.homeSwapAsset = true;
	        } else {
	          if (!Array.isArray(assets)) assets = [];
	          assets.push({
	            sym: symbol,
	            full: tokenFull[symbol] || meta.name || symbol,
	            amt: displayAmount + " " + symbol,
	            usdNum: usdNum,
	            cls: "custom",
	            logo: tokenLogo[symbol] || symbol.slice(0,1),
	            address: meta.address || null,
	            status: tokenStatus,
	            recentSwapAsset: true,
	            homeSwapAsset: true
	          });
	        }
	        if (typeof renderAssets === "function") renderAssets();
	      }
	      function balanceNumber(symbol){
	        var raw = (typeof balances !== "undefined" && balances[symbol]) ? String(balances[symbol]) : "0";
	        var n = Number(raw.replace(/,/g, "").replace(/^</, ""));
	        return Number.isFinite(n) ? n : 0;
	      }
	      function updateAssetAmount(symbol, amount){
	        symbol = String(symbol || "").toUpperCase();
	        var amountText = shortAmount(Math.max(0, Number(amount) || 0));
	        balances[symbol] = amountText;
	        availMap[symbol] = amountText + " " + symbol;
	        var asset = (assets || []).find(function(item){ return String(item && item.sym || "").toUpperCase() === symbol; });
	        if (!asset) return;
	        asset.amt = amountText + " " + symbol;
	        var price = Number(tokenMeta(symbol).priceUsd || prices[symbol] || 0);
	        if (!(price > 0) && (symbol === "USDC" || symbol === "USDT" || symbol === "EURC")) price = 1;
	        if (price > 0) asset.usdNum = (Number(amount) || 0) * price;
	      }
	      function optimisticallyApplySwapBalances(){
	        if (!latestSwapQuote) return;
	        var sell = String(swapState.sell || "").toUpperCase();
	        var buy = String(swapState.buy || "").toUpperCase();
	        var amountIn = Number(latestSwapQuote.amountIn || 0);
	        var amountOut = Number(latestSwapQuote.amountOut || 0);
	        if (!sell || !buy || !(amountIn > 0) || !(amountOut > 0)) return;
	        var previousBuyBalance = balanceNumber(buy);
	        updateAssetAmount(sell, balanceNumber(sell) - amountIn);
	        upsertRecentSwapHomeAsset(buy, latestSwapQuote.tokens && latestSwapQuote.tokens.to, amountOut);
	        updateAssetAmount(buy, previousBuyBalance + amountOut);
	        syncSwapQuotePriceToHome();
	        if (typeof refreshSwapLabels === "function") refreshSwapLabels();
	        if (typeof renderAssets === "function") renderAssets();
	        if (typeof window.__luminaRefreshHomeTotalFromAssets === "function") window.__luminaRefreshHomeTotalFromAssets();
	      }
	      function readableSwapError(error){
	        if (!error) return { message:"Unknown swap error" };
	        var out = {
	          name: error.name,
	          message: error.message,
	          code: error.code,
	          error_code: error.error_code,
	          data: error.data,
	          details: error.details,
	          cause: error.cause && (error.cause.message || error.cause.data || error.cause.code || error.cause.error_code)
	        };
	        try { out.serialized = JSON.stringify(error); } catch(e) {}
	        return out;
	      }
	      function swapErrorToast(error){
	        var readable = readableSwapError(error);
	        var raw = [
	          readable && readable.message,
	          readable && readable.code,
	          readable && readable.error_code,
	          readable && readable.cause,
	          readable && readable.serialized
	        ].filter(Boolean).join(" ");
	        var msg = window.__luminaFriendlySwapError ? window.__luminaFriendlySwapError(error) : raw;
	        var text = String(raw || msg || "");
	        if (/cancel|reject|rejected|user_rejected|取消/i.test(text)) return swapCopy("cancelled");
	        if (/invalid_token/i.test(text)) return "Token not active in World App Permit2 list";
	        if (/invalid_contract/i.test(text)) return swapCopy("unsupportedToken");
	        if (/disallowed_operation/i.test(text)) return swapCopy("worldAppBlocked");
	        if (/permitted_amount_exceeds_slippage|permitted_amount_not_found/i.test(text)) return swapCopy("approvalFailed");
	        if (/TRANSFER_FROM_FAILED|transferFrom|transfer failed/i.test(text)) return swapCopy("sellRestricted");
	        if (/V3TooLittleReceived|TooLittleReceived|INSUFFICIENT_OUTPUT_AMOUNT/i.test(text)) return swapCopy("refreshQuoteShort");
	        if (/TransactionDeadlinePassed|DeadlineExpired|EXPIRED/i.test(text)) return swapCopy("quoteExpiredShort");
	        return swapCopy("swapFailed");
	      }
	      function syncSwapQuotePriceToHome(){
	        if (!latestSwapQuote) return;
	        var sell = String(swapState.sell || "").toUpperCase();
	        var buy = String(swapState.buy || "").toUpperCase();
	        var amountIn = Number(latestSwapQuote.amountIn || 0);
	        var amountOut = Number(latestSwapQuote.amountOut || 0);
	        if (buy) upsertRecentSwapHomeAsset(buy, latestSwapQuote.tokens && latestSwapQuote.tokens.to, amountOut);
	        if (!sell || !buy || !(amountIn > 0) || !(amountOut > 0)) return;
	        var sellPrice = tokenMeta(sell, latestSwapQuote.tokens && latestSwapQuote.tokens.from).priceUsd;
	        if (!(sellPrice > 0) && sell === "WETH") sellPrice = Number(prices && prices.ETH) || 0;
	        if (!(sellPrice > 0) && (sell === "WBTC" || sell === "BTC")) sellPrice = Number(prices && prices.BTC) || 0;
	        if (!(sellPrice > 0) && (sell === "USDC" || sell === "USDT" || sell === "EURC")) sellPrice = 1;
	        if (!(sellPrice > 0)) return;
	        var buyPrice = amountIn * sellPrice / amountOut;
	        if (!Number.isFinite(buyPrice) || buyPrice <= 0) return;
	        prices[buy] = buyPrice;
	        if (customTokens && customTokens[buy]) customTokens[buy].priceUsd = buyPrice;
	        var market = window.__luminaMarketBySymbol && window.__luminaMarketBySymbol[buy];
	        if (market) market.priceUsd = buyPrice;
	        upsertRecentSwapHomeAsset(buy, latestSwapQuote.tokens && latestSwapQuote.tokens.to, amountOut);
	        (assets || []).forEach(function(asset){
	          if (String(asset.sym || "").toUpperCase() !== buy) return;
	          var amount = Number(String(asset.amt || "0").split(" ")[0].replace(/,/g, ""));
	          if (Number.isFinite(amount) && amount > 0) asset.usdNum = amount * buyPrice;
	        });
	        if (typeof renderAssets === "function") renderAssets();
	      }
	      function minOutText(){
	        var out = latestSwapQuote ? Number(latestSwapQuote.amountOut || 0) : 0;
	        var slip = slippageBps();
	        return out > 0 ? shortAmount(out * (10000 - slip) / 10000) : "—";
	      }
	      function quoteAgeSeconds(){
	        return latestQuoteAt ? Math.floor((Date.now() - latestQuoteAt) / 1000) : 999;
	      }
	      function quoteSecondsLeft(){
	        return Math.max(0, SWAP_QUOTE_TTL_SECONDS - quoteAgeSeconds());
	      }
	      function impactClassFor(percent){
	        if (percent > 5) return "impact-high";
	        if (percent >= 3) return "impact-mid";
	        return "impact-low";
	      }
	      function normalizedSwapTokenAddress(token){
	        var address = token && (token.contractAddr || token.contractAddress || token.address || token.tokenAddress || token.id);
	        address = String(address || "").toLowerCase();
	        return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
	      }
	      function verifiedSwapToken(token){
	        if (!token) return false;
	        if (token.verified === true) return true;
	        var tokenStatus = String(token.status || token.trust || (token.safety && token.safety.status) || "").toLowerCase();
	        if (tokenStatus === "verified") return true;
	        var symbol = String(token.symbol || token.sym || "").toUpperCase();
	        var address = normalizedSwapTokenAddress(token);
	        var whitelist = typeof swapWhitelistTokens === "function" ? swapWhitelistTokens() : [];
	        if (Array.isArray(whitelist)) {
	          return whitelist.some(function(item){
	            var itemSymbol = String(item && item.symbol || item && item.sym || "").toUpperCase();
	            var itemAddress = normalizedSwapTokenAddress(item);
	            return (address && itemAddress && address === itemAddress) || (symbol && itemSymbol && symbol === itemSymbol);
	          });
	        }
	        return false;
	      }
	      function riskySwapToken(token){
	        if (!token) return false;
	        if (verifiedSwapToken(token)) return false;
	        var trust = String(token.trust || "").toLowerCase();
	        var status = String(token.status || (token.safety && token.safety.status) || "").toLowerCase();
	        return trust === "community" || status === "community" || status === "pending" || status === "unverified" || status === "rejected" || status === "high" || status === "danger";
	      }
	      function normalizeSellPair(){
	        if (!swapState) return;
	        var sell = String(swapState.sell || "").toUpperCase();
	        var buy = String(swapState.buy || "").toUpperCase();
	        if (!sell || !buy || sell !== buy) return;
	        var fallback = sell === "WLD" ? "USDC" : "WLD";
	        if (prices && !prices[fallback]) {
	          fallback = Object.keys(prices).filter(function(sym){ return String(sym).toUpperCase() !== sell; })[0] || fallback;
	        }
	        swapState.buy = fallback;
	      }
	      function swapRiskText(){
	        if (!latestSwapQuote) return "";
	        var risky = [latestSwapQuote.tokens && latestSwapQuote.tokens.from, latestSwapQuote.tokens && latestSwapQuote.tokens.to].filter(function(token){
	          return riskySwapToken(token);
	        });
	        if (risky.length) return { title: swapCopy("communityRiskTitle") + ": " + risky[0].symbol, body: swapCopy("communityRiskBody") };
	        return "";
	      }
	      function validateSwapSafety(){
	        var sell = document.getElementById("sellAmt");
	        var amountText = sell ? String(sell.value || "").replace(/,/g, "").trim() : "";
	        var amount = Number(amountText);
	        var slip = slippageBps();
	        var impact = latestSwapQuote ? Number(latestSwapQuote.priceImpactPercent || 0) : 0;
	        var sellPrice = tokenMeta(swapState.sell, latestSwapQuote && latestSwapQuote.tokens && latestSwapQuote.tokens.from).priceUsd;
	        var amountUsd = Number.isFinite(Number(sellPrice)) ? amount * Number(sellPrice) : null;
	        if (!swapExecutionEnabled) return { ok:false, error:"Swap mainnet execution is disabled until Tenderly verification is approved." };
	        if (!window.__luminaUserAddress) return { ok:false, error:"Connect wallet before swapping." };
	        if (!amount || !Number.isFinite(amount) || amount <= 0) return { ok:false, error:"Enter an amount greater than 0." };
	        if (amount > balanceNumber(swapState.sell)) return { ok:false, error:swapCopy("insufficientBalance") };
	        if (slip <= 0) return { ok:false, error:swapCopy("slippageTooLow") };
	        if (!latestSwapQuote) return { ok:false, error:swapCopy("quoteFirst") };
	        if (latestSwapQuote.source !== "uniswap-v3") return { ok:false, error:"当前交易对暂无可执行路由。" };
	        if (amountUsd !== null && amountUsd > swapMaxUsd) return { ok:false, error:swapCopy("limit") + " $" + swapMaxUsd + ". " + swapCopy("reduceAmount") };
	        var riskText = swapRiskText();
	        return { ok:true, amountText:amountText, impact:impact, riskText:riskText };
	      }
	      function openSwapConfirm(state){
	        return new Promise(function(resolve){
	          highImpactAcknowledged = false;
	          var old = document.getElementById("swapConfirmModal");
	          if (old) old.remove();
	          if (quoteCountdownTimer) { clearInterval(quoteCountdownTimer); quoteCountdownTimer = null; }
	          var modal = document.createElement("div");
	          modal.className = "modal-mask open";
	          modal.id = "swapConfirmModal";
	          modal.innerHTML =
	            '<div class="modal send-confirm-sheet swap-confirm-sheet-v2">' +
	              '<div class="modal-grip"></div><h3>' + swapCopy("confirmSwap") + '</h3>' +
	              '<div class="swap-confirm-list">' +
	                '<div class="ln"><span>' + swapCopy("youPay") + '</span><b>' + state.amountText + ' ' + swapState.sell + '</b></div>' +
	                '<div class="ln"><span>' + swapCopy("youReceiveApprox") + '</span><b>' + shortAmount(latestSwapQuote.amountOut) + ' ' + swapState.buy + '</b></div>' +
	                '<div class="ln"><span>' + swapCopy("minReceive") + '</span><b>' + minOutText() + ' ' + swapState.buy + '</b></div>' +
	                '<div class="ln"><span>' + swapCopy("platformFee") + '</span><b>' + platformFeeText(latestSwapQuote) + '</b></div>' +
	              '</div>' +
	              (state.riskText ? '<div class="swap-risk-wrap"><div class="swap-risk-card"><strong><span class="swap-risk-icon">!</span><span>' + (state.riskText.title || swapCopy("communityRiskTitle")) + '</span></strong><p>' + (state.riskText.body || state.riskText) + '</p></div><button type="button" class="swap-risk-check" id="swapHighImpactAck"><span class="swap-risk-checkbox" aria-hidden="true"></span><span class="swap-risk-check-text">' + swapCopy("riskAck") + '</span></button></div>' : '') +
	              '<div class="earn-action-row swap-confirm-actions"><button class="btn-ghost" id="swapConfirmCancel">' + swapCopy("cancel") + '</button><button class="btn-primary" id="swapConfirmOk">' + swapCopy("confirmSwap") + '</button></div>' +
	            '</div>';
	          document.body.appendChild(modal);
	          function done(value){
	            if (quoteCountdownTimer) { clearInterval(quoteCountdownTimer); quoteCountdownTimer = null; }
	            modal.classList.remove("open"); setTimeout(function(){ modal.remove(); }, 180); resolve(value);
	          }
	          quoteCountdownTimer = setInterval(function(){
	            var left = quoteSecondsLeft();
	            var label = document.getElementById("swapQuoteCountdown");
	            var ok = document.getElementById("swapConfirmOk");
	            if (label) label.textContent = left + "s";
	            if (left <= 0) {
	              if (ok) { ok.textContent = swapCopy("confirmSwap"); }
	            }
	          }, 1000);
	          modal.onclick = function(event){ if (event.target === modal) done(false); };
	          document.getElementById("swapConfirmCancel").onclick = function(){ done(false); };
	          var high = document.getElementById("swapHighImpactAck");
	          if (high) high.onclick = function(){ highImpactAcknowledged = !highImpactAcknowledged; high.classList.toggle("ack", highImpactAcknowledged); };
	          document.getElementById("swapConfirmOk").onclick = function(){
	            if (state.riskText && !highImpactAcknowledged) { toast(swapCopy("ackRiskFirst")); return; }
	            done(true);
	          };
	        });
	      }
	      function showSwapSuccess(result){
	        var old = document.getElementById("swapSuccessModal");
	        if (old) old.remove();
	        var modal = document.createElement("div");
	        modal.className = "modal-mask open";
	        modal.id = "swapSuccessModal";
	        modal.innerHTML =
	          '<div class="modal send-confirm-sheet swap-success-sheet" style="width:calc(100vw - 24px);max-width:390px;padding:24px;border-radius:26px;text-align:center;position:relative;">' +
	            '<button id="swapSuccessClose" aria-label="关闭" style="position:absolute;right:16px;top:14px;width:36px;height:36px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);font-size:22px;line-height:1;">×</button>' +
	            '<div class="modal-grip"></div><div class="swap-success-mark">✓</div><h3>' + swapCopy("submitted") + '</h3>' +
	            '<div class="swap-success-route"><span>' + swapState.sell + '</span><i>→</i><span>' + swapState.buy + '</span></div><p class="swap-success-sub">' + swapCopy("submittedHint") + '</p>' +
	            '<button class="btn-primary" id="swapSuccessOk" style="width:100%;margin-top:16px;">' + swapCopy("viewActivity") + '</button>' +
	          '</div>';
	        document.body.appendChild(modal);
	        document.getElementById("swapSuccessClose").onclick = function(){ modal.remove(); };
	        document.getElementById("swapSuccessOk").onclick = function(){ modal.remove(); go("activity"); setTabByName("Activity"); };
	      }
	      async function handleSwapClick(){
	        if (swapSubmitting) return;
	        if (!latestSwapQuote && activeQuotePromise) {
	          await activeQuotePromise;
	        }
	        if (!latestSwapQuote) {
	          await requestQuote();
	        }
	        var state = validateSwapSafety();
	        if (!state.ok) {
	          setSwapDebug("validate:error", { error: state.error });
	          if (/刷新报价/.test(state.error)) scheduleQuote();
	          toast(state.error);
	          return;
	        }
	        setSwapDebug("validate:success", state);
	        var confirmed = await openSwapConfirm(state);
	        if (!confirmed) { setSwapDebug("confirm:cancelled", state); toast(swapCopy("cancelled")); return; }
	        swapSubmitting = true;
	        setSwapButtonState(swapCopy("signing"), true);
	        try {
	          if (!window.__luminaExecuteSwap) throw new Error("Swap execution is unavailable.");
	          var fromQuoted = latestSwapQuote && latestSwapQuote.tokens ? latestSwapQuote.tokens.from : null;
	          var toQuoted = latestSwapQuote && latestSwapQuote.tokens ? latestSwapQuote.tokens.to : null;
	          setSwapButtonState(swapCopy("confirmInWorldApp"), true);
	          setSwapDebug("execute:start", {
	            fromToken: tokenMeta(swapState.sell, fromQuoted),
	            toToken: tokenMeta(swapState.buy, toQuoted),
	            fromAmountHuman: state.amountText,
	            slippageBps: slippageBps(),
	            quote: latestSwapQuote
	          });
	          var promise = window.__luminaExecuteSwap({
	            fromToken: tokenMeta(swapState.sell, fromQuoted),
	            toToken: tokenMeta(swapState.buy, toQuoted),
	            fromAmountHuman: state.amountText,
	            slippageBps: slippageBps(),
	            userAddress: window.__luminaUserAddress,
	            forceHighImpact: highImpactAcknowledged,
	            quote: latestSwapQuote
	          });
	          setSwapButtonState(swapCopy("submitting"), true);
	          var result = await promise;
	          setSwapDebug("execute:submitted", result);
	          window.dispatchEvent(new CustomEvent("lumina:swap-userop", { detail: { userOpHash: result.userOpHash } }));
	          if (window.__luminaAddLocalActivity) window.__luminaAddLocalActivity({
	            type: "swap",
	            title: "Swap " + swapState.sell + " → " + swapState.buy,
	            subtitle: "Swap",
	            amount: state.amountText + " " + swapState.sell,
	            status: "Completed",
	            hash: result.userOpHash || result.transactionHash || ("pending-" + Date.now())
	          });
	          optimisticallyApplySwapBalances();
	          setSwapButtonState(swapCopy("confirmSwap"), false);
	          showSwapSuccess(result);
	          if (window.__luminaRefreshWalletData) {
	            setTimeout(function(){ window.__luminaRefreshWalletData(); }, 6500);
	          }
	        } catch(e) {
	          setSwapDebug("execute:error", readableSwapError(e));
	          console.error("[SWAP] executeSwap failed", readableSwapError(e), e);
	          toast(swapErrorToast(e));
	          setSwapButtonState(swapCopy("confirmSwap"), false);
	        } finally {
	          swapSubmitting = false;
	        }
	      }
	      var previousRefresh = typeof refreshSwapLabels === "function" ? refreshSwapLabels : null;
      if (previousRefresh && !window.__luminaQuoteRefreshWrapped) {
        window.__luminaQuoteRefreshWrapped = true;
        refreshSwapLabels = function(){
          previousRefresh();
          var warn = document.getElementById("unvWarn");
          if (warn) warn.classList.remove("show");
          var btn = document.getElementById("swapBtn");
          if (btn) btn.disabled = false;
          setSwapPillLogo("sellDot", swapState.sell);
          setSwapPillLogo("buyDot", swapState.buy);
          ensureSwapMaxButton();
          ensureSwapDebugButton();
          scheduleQuote();
        };
      }
      updateUnverifiedWarning = function(){
        var warn = document.getElementById("unvWarn");
        if (warn) warn.classList.remove("show");
        var btn = document.getElementById("swapBtn");
        if (btn) btn.disabled = false;
      };
      if (!window.__luminaTokenModalKeyboardFix) {
        window.__luminaTokenModalKeyboardFix = true;
        if (typeof pickToken === "function" && !window.__luminaPickTokenWrappedForSellPair) {
          window.__luminaPickTokenWrappedForSellPair = true;
          var previousPickToken = pickToken;
          pickToken = function(symbol){
            previousPickToken(symbol);
            normalizeSellPair();
            if (typeof refreshSwapLabels === "function") refreshSwapLabels();
          };
        }
        function handleTokenRowActivate(event){
          var row = event.target && event.target.closest ? event.target.closest("#tokenModalList .tk-row") : null;
          var list = document.getElementById("tokenModalList");
          if (!row || !list || !list.contains(row)) return;
          if (event.__luminaTokenPicked) return;
          event.__luminaTokenPicked = true;
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          var now = Date.now();
          if (window.__luminaLastTokenRowTap && now - window.__luminaLastTokenRowTap < 420) return;
          window.__luminaLastTokenRowTap = now;
          var symbol = row.getAttribute("data-token-symbol") || "";
          if (!symbol) {
            var symEl = row.querySelector(".s");
            symbol = symEl ? String(symEl.textContent || "").replace(/白名单|已导入|Verified|High risk|Unverified/g, "").trim() : "";
          }
          symbol = String(symbol || "").toUpperCase();
          if (symbol && typeof pickToken === "function") pickToken(symbol);
        }
        function handleSwapPickerActivate(event){
          var picker = event.target && event.target.closest ? event.target.closest("#view-swap .swap-panel .tk") : null;
          if (!picker) return;
          if (event.__luminaSwapPickerOpened) return;
          event.__luminaSwapPickerOpened = true;
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          var now = Date.now();
          if (window.__luminaLastSwapPickerTap && now - window.__luminaLastSwapPickerTap < 420) return;
          window.__luminaLastSwapPickerTap = now;
          var target = picker.querySelector("#buyDot, #buySym") ? "buy" : "sell";
          if (typeof openTokenModal === "function") openTokenModal(target);
        }
        document.addEventListener("click", handleTokenRowActivate, true);
        document.addEventListener("click", handleSwapPickerActivate, true);
        document.addEventListener("focusin", function(event){
          if (event.target && event.target.id === "tkSearch") {
            var modal = document.getElementById("tokenModal");
            if (modal) modal.classList.add("keyboard-open");
            setTimeout(function(){
              var inner = modal && modal.querySelector(".modal");
              if (inner) inner.scrollTop = 0;
            }, 60);
          }
        });
        document.addEventListener("focusout", function(event){
          if (event.target && event.target.id === "tkSearch") {
            setTimeout(function(){
              var active = document.activeElement;
              if (active && active.id === "tkSearch") return;
              var modal = document.getElementById("tokenModal");
              if (modal) modal.classList.remove("keyboard-open");
            }, 120);
          }
        });
      }
      flipSwap = function(){
        var nextSell = swapState.buy;
        var nextBuy = swapState.sell;
        swapState.sell = nextSell;
        swapState.buy = nextBuy;
        normalizeSellPair();
        highImpactAcknowledged = false;
        if (typeof refreshSwapLabels === "function") refreshSwapLabels();
        toast(typeof t === "function" ? t("tFlipped") : "已对调买卖方向");
      };
      var swapGear = document.querySelector("#view-swap .swap-head .gear");
      if (swapGear) swapGear.remove();
      function ensureSlipBack(){
        var panel = document.getElementById("slipPanel");
        if (!panel || panel.querySelector(".slip-back")) return;
        panel.insertAdjacentHTML("afterbegin", '<button type="button" class="slip-back" onclick="toggleSlip()" aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg><span>Back</span></button>');
      }
      toggleSlip = function(){
        var panel = document.getElementById("slipPanel");
        if (!panel) return;
        ensureSlipBack();
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) {
          setTimeout(function(){ panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 30);
        }
      };
      recalc = scheduleQuote;
	      confirmSwap = handleSwapClick;
      document.querySelectorAll(".slip-opt").forEach(function(el){
        el.addEventListener("click", scheduleQuote);
      });
      var customSlip = document.querySelector(".slip-custom");
      if (customSlip) customSlip.addEventListener("input", scheduleQuote);
      ensureSlipBack();
      resetInitialSwapAmounts();
      ensureSwapMaxButton();
      ensureSwapDebugButton();
      setSwapButtonPending();
      ensureQuoteBox();
      setSwapPillLogo("sellDot", swapState.sell);
      setSwapPillLogo("buyDot", swapState.buy);
      window.__luminaApplySwapSystemConfig();
      scheduleQuote();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance swap quote");
}

/**
 * Connects the prototype Send form to MiniKit.sendTransaction with validation and balance checks.
 */
function enhancePrototypeSend() {
  const sendTokens = TOKENS.map(
    (token) => ({
      symbol: token.symbol,
      address: token.native ? null : token.contractAddress ?? null,
      decimals: token.decimals,
      name: token.name,
      native: Boolean(token.native),
    }),
  );
  const source = `
    (function(){
      var sendTokens = ${JSON.stringify(sendTokens)};
      var sendTokenMap = {};
      sendTokens.forEach(function(token){ sendTokenMap[token.symbol] = token; });
      var sending = false;
      var form = document.querySelector("#view-send .form-card");
      if (!form) return;
      var fields = form.querySelectorAll("input.field");
      var recipientInput = fields[0];
      var amountInput = fields[1];
      var maxBtn = form.querySelector(".amount-row .max");
      var submit = form.querySelector(".send-submit");
      var recipientError = document.getElementById("sendRecipientError");
      var amountError = document.getElementById("sendAmountError");
      function sendLang(){
        return window.currentLang || localStorage.getItem("ww_lang_pref_v2") || "en";
      }
      function sendCopy(key){
        var lang = sendLang();
        var copy = {
          processing: { en:"Processing...", "zh-CN":"处理中...", "zh-TW":"處理中...", fr:"Traitement...", de:"Wird verarbeitet...", es:"Procesando...", ja:"処理中..." },
          confirmTransfer: { en:"Confirm transfer", "zh-CN":"确认转账", "zh-TW":"確認轉帳", fr:"Confirmer le transfert", de:"Transfer bestätigen", es:"Confirmar transferencia", ja:"送金を確認" },
          selectToken: { en:"Select a World Chain token", "zh-CN":"请选择 World Chain 代币", "zh-TW":"請選擇 World Chain 代幣", fr:"Sélectionnez un jeton World Chain", de:"World Chain Token auswählen", es:"Selecciona un token World Chain", ja:"World Chain トークンを選択" },
          missingContract: { en:"Missing token contract address", "zh-CN":"缺少代币合约地址", "zh-TW":"缺少代幣合約地址", fr:"Adresse du contrat manquante", de:"Token-Vertragsadresse fehlt", es:"Falta la dirección del contrato", ja:"トークンコントラクトアドレスがありません" },
          invalidRecipient: { en:"Invalid recipient address", "zh-CN":"收款地址无效", "zh-TW":"收款地址無效", fr:"Adresse destinataire invalide", de:"Ungültige Empfängeradresse", es:"Dirección de destinatario inválida", ja:"受取人アドレスが無効です" },
          enterAmount: { en:"Enter an amount greater than 0", "zh-CN":"请输入大于 0 的金额", "zh-TW":"請輸入大於 0 的金額", fr:"Saisissez un montant supérieur à 0", de:"Betrag größer als 0 eingeben", es:"Ingresa un importe mayor que 0", ja:"0 より大きい金額を入力" },
          insufficient: { en:"Insufficient balance", "zh-CN":"余额不足", "zh-TW":"餘額不足", fr:"Solde insuffisant", de:"Unzureichendes Guthaben", es:"Saldo insuficiente", ja:"残高不足" },
          maxFilled: { en:"Max filled", "zh-CN":"已填入最大金额", "zh-TW":"已填入最大金額", fr:"Maximum rempli", de:"Maximum eingetragen", es:"Máximo rellenado", ja:"最大額を入力しました" },
          confirmTitle: { en:"Confirm transfer", "zh-CN":"确认转账", "zh-TW":"確認轉帳", fr:"Confirmer le transfert", de:"Transfer bestätigen", es:"Confirmar transferencia", ja:"送金を確認" },
          send: { en:"Send", "zh-CN":"发送", "zh-TW":"發送", fr:"Envoyer", de:"Senden", es:"Enviar", ja:"送金" },
          to: { en:"to", "zh-CN":"至", "zh-TW":"至", fr:"à", de:"an", es:"a", ja:"宛先" },
          cancel: { en:"Cancel", "zh-CN":"取消", "zh-TW":"取消", fr:"Annuler", de:"Abbrechen", es:"Cancelar", ja:"キャンセル" },
          confirm: { en:"Confirm", "zh-CN":"确认", "zh-TW":"確認", fr:"Confirmer", de:"Bestätigen", es:"Confirmar", ja:"確認" },
          submitted: { en:"Transaction submitted", "zh-CN":"交易已提交", "zh-TW":"交易已提交", fr:"Transaction envoyée", de:"Transaktion gesendet", es:"Transacción enviada", ja:"取引を送信しました" },
          waiting: { en:"Waiting for World Chain confirmation. Activity will update automatically.", "zh-CN":"等待 World Chain 确认。活动记录会自动更新。", "zh-TW":"等待 World Chain 確認。活動記錄會自動更新。", fr:"En attente de confirmation World Chain. Activity se mettra à jour.", de:"Warten auf World Chain-Bestätigung. Activity aktualisiert automatisch.", es:"Esperando confirmación de World Chain. Activity se actualizará.", ja:"World Chain の確認待ちです。Activity は自動更新されます。" },
          viewActivity: { en:"View Activity", "zh-CN":"查看活动", "zh-TW":"查看活動", fr:"Voir l'activité", de:"Aktivität anzeigen", es:"Ver Activity", ja:"Activity を見る" },
          explorer: { en:"Explorer", "zh-CN":"浏览器", "zh-TW":"瀏覽器", fr:"Explorer", de:"Explorer", es:"Explorer", ja:"Explorer" },
          close: { en:"Close", "zh-CN":"关闭", "zh-TW":"關閉", fr:"Fermer", de:"Schließen", es:"Cerrar", ja:"閉じる" },
          cancelled: { en:"Transaction cancelled", "zh-CN":"交易已取消", "zh-TW":"交易已取消", fr:"Transaction annulée", de:"Transaktion abgebrochen", es:"Transacción cancelada", ja:"取引をキャンセルしました" },
          transferFailed: { en:"Transfer failed", "zh-CN":"转账失败", "zh-TW":"轉帳失敗", fr:"Échec du transfert", de:"Transfer fehlgeschlagen", es:"Transferencia fallida", ja:"送金に失敗しました" },
          validRequired: { en:"Enter a valid address and amount", "zh-CN":"请输入有效地址和金额", "zh-TW":"請輸入有效地址和金額", fr:"Saisissez une adresse et un montant valides", de:"Gültige Adresse und Betrag eingeben", es:"Ingresa dirección e importe válidos", ja:"有効なアドレスと金額を入力" }
        };
        return (copy[key] && (copy[key][lang] || copy[key].en)) || key;
      }
      if (!recipientError) {
        recipientError = document.createElement("div");
        recipientError.id = "sendRecipientError";
        recipientError.className = "send-field-error";
        recipientInput.insertAdjacentElement("afterend", recipientError);
      }
      if (!amountError) {
        amountError = document.createElement("div");
        amountError.id = "sendAmountError";
        amountError.className = "send-field-error";
        form.querySelector(".amount-row").insertAdjacentElement("afterend", amountError);
      }
      function cleanAmount(value){ return String(value || "").replace(/,/g, "").trim(); }
      function isValidAddress(value){ return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim()); }
      function selectedToken(){
        var sym = String(sendCurrentToken || "").toUpperCase();
        if (sendTokenMap[sym]) return sendTokenMap[sym];
        var custom = customTokens && customTokens[sym] ? customTokens[sym] : null;
        if (custom && custom.address) {
          return {
            symbol: sym,
            address: custom.address,
            decimals: Number(custom.decimals || 18),
            name: custom.name || tokenFull[sym] || sym,
            native: false
          };
        }
        return null;
      }
      function balanceNumber(symbol){
        var raw = (typeof balances !== "undefined" && balances[symbol]) ? String(balances[symbol]) : "0";
        var n = Number(raw.replace(/,/g, "").replace(/^</, ""));
        return Number.isFinite(n) ? n : 0;
      }
      function setButtonLoading(active){
        if (!submit) return;
        submit.classList.toggle("is-loading", active);
        submit.innerHTML = active ? '<span class="send-spinner"></span><span>' + sendCopy("processing") + '</span>' : '<span data-i18n="confirmSend">' + sendCopy("confirmTransfer") + '</span>';
      }
      function validation(){
        var token = selectedToken();
        var recipient = recipientInput ? recipientInput.value.trim() : "";
        var amountText = amountInput ? cleanAmount(amountInput.value) : "";
        var amount = Number(amountText);
        var balance = token ? balanceNumber(token.symbol) : 0;
        var recipientMsg = "";
        var amountMsg = "";
        if (!token) amountMsg = sendCopy("selectToken");
        if (token && !token.native && !token.address) amountMsg = sendCopy("missingContract");
        if (recipient && !isValidAddress(recipient)) recipientMsg = sendCopy("invalidRecipient");
        if (amountText && (!Number.isFinite(amount) || amount <= 0)) amountMsg = sendCopy("enterAmount");
        if (token && Number.isFinite(amount) && amount > balance) amountMsg = sendCopy("insufficient");
        if (recipientError) recipientError.textContent = recipientMsg;
        if (amountError) amountError.textContent = amountMsg;
        var disabled = sending || !window.__luminaUserAddress || !token || !recipient || !isValidAddress(recipient) || !amountText || !Number.isFinite(amount) || amount <= 0 || amount > balance;
        if (submit) {
          submit.disabled = disabled;
          if (!sending) setButtonLoading(false);
        }
        return { ok: !disabled, token: token, recipient: recipient, amountText: amountText, amount: amount, error: recipientMsg || amountMsg };
      }
      function setMaxAmount(){
        var token = selectedToken();
        if (!token || !amountInput) return;
        var max = balanceNumber(token.symbol);
        if (token.symbol === "ETH") max = Math.max(0, max - 0.001);
        amountInput.value = max > 0 ? String(Number(max.toFixed(token.decimals === 6 ? 6 : 8))) : "";
        validation();
        toast(sendCopy("maxFilled"), "success");
      }
      function confirmSendAction(state){
        return new Promise(function(resolve){
          var old = document.getElementById("sendConfirmModal");
          if (old) old.remove();
          var modal = document.createElement("div");
          modal.className = "modal-mask open";
          modal.id = "sendConfirmModal";
          modal.innerHTML =
            '<div class="modal send-confirm-sheet" style="width:calc(100vw - 24px);max-width:430px;min-height:300px;padding:24px 24px 22px;margin:0 auto 10px;border-radius:26px;">' +
              '<div class="modal-grip"></div>' +
              '<h3>' + sendCopy("confirmTitle") + '</h3>' +
              '<p class="send-confirm-body" style="display:block;width:100%;margin:10px 0 22px;color:var(--text-dim);font-size:16px;line-height:1.7;overflow-wrap:anywhere;">' + sendCopy("send") + ' ' + state.amountText + ' ' + state.token.symbol + '<br>' + sendCopy("to") + ' ' + state.recipient.slice(0, 6) + '...' + state.recipient.slice(-4) + '</p>' +
              '<div class="earn-action-row" style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;"><button class="btn-ghost" id="sendConfirmCancel">' + sendCopy("cancel") + '</button><button class="btn-primary" id="sendConfirmOk">' + sendCopy("confirm") + '</button></div>' +
            '</div>';
          document.body.appendChild(modal);
          function done(value){
            modal.classList.remove("open");
            setTimeout(function(){ modal.remove(); }, 180);
            resolve(value);
          }
          modal.onclick = function(event){ if (event.target === modal) done(false); };
          document.getElementById("sendConfirmCancel").onclick = function(){ done(false); };
          document.getElementById("sendConfirmOk").onclick = function(){ done(true); };
        });
      }
      function shortHash(hash){
        var value = String(hash || "");
        if (!value) return sendCopy("submitted");
        if (value.length <= 22) return value;
        return value.slice(0, 10) + "..." + value.slice(-6);
      }
      function showTransactionSubmitted(hash){
        var existing = document.getElementById("luminaTxSubmitted");
        if (existing) existing.remove();
        var tx = String(hash || "");
        var canOpen = /^0x[a-fA-F0-9]{64}$/.test(tx);
        var panel = document.createElement("div");
        panel.id = "luminaTxSubmitted";
        panel.className = "tx-submitted-toast";
        panel.innerHTML =
          '<div class="tx-submitted-card">' +
            '<div class="tx-submitted-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg></div>' +
            '<div class="tx-submitted-body"><strong>' + sendCopy("submitted") + '</strong><p>' + sendCopy("waiting") + '</p><span class="tx-submitted-hash">' + shortHash(tx) + '</span></div>' +
            '<div class="tx-submitted-actions"><button type="button" class="primary" id="txToastActivity">' + sendCopy("viewActivity") + '</button>' +
            (canOpen ? '<a href="https://worldscan.org/tx/' + tx + '" target="_blank" rel="noreferrer">' + sendCopy("explorer") + '</a>' : '<button type="button" id="txToastClose">' + sendCopy("close") + '</button>') +
            '</div>' +
          '</div>';
        document.body.appendChild(panel);
        requestAnimationFrame(function(){ panel.classList.add("show"); });
        var close = function(){ panel.classList.remove("show"); setTimeout(function(){ panel.remove(); }, 220); };
        var activity = document.getElementById("txToastActivity");
        if (activity) activity.onclick = function(){ close(); go("activity"); setTabByName("Activity"); if (window.__luminaRefreshActivity) window.__luminaRefreshActivity(); };
        var closeBtn = document.getElementById("txToastClose");
        if (closeBtn) closeBtn.onclick = close;
        clearTimeout(window.__luminaTxToastTimer);
        window.__luminaTxToastTimer = setTimeout(close, 5200);
      }
      async function handleSendClick(){
        var state = validation();
        if (sending) return;
        if (!state.ok) {
          toast(state.error || sendCopy("validRequired"));
          return;
        }
        var confirmed = await confirmSendAction(state);
        if (!confirmed) {
          toast(sendCopy("cancelled"));
          return;
        }
        sending = true;
        setButtonLoading(true);
        validation();
        try {
          if (!window.__luminaSendToken) throw new Error("MiniKit sendTransaction is unavailable.");
          var result = await window.__luminaSendToken({
            tokenSymbol: state.token.symbol,
            tokenAddress: state.token.address,
            tokenDecimals: state.token.decimals,
            recipient: state.recipient,
            amountHuman: state.amountText,
            userAddress: window.__luminaUserAddress || ""
          });
          if (result.status === "success") {
            var hash = result.txHash || "";
            if (window.__luminaAddLocalActivity) window.__luminaAddLocalActivity({
              type: "out",
              title: "Sent " + state.token.symbol,
              subtitle: state.recipient,
              amount: "-" + state.amountText + " " + state.token.symbol,
              status: "Completed",
              hash: hash || ("pending-" + Date.now())
            });
            showTransactionSubmitted(hash);
            if (window.__luminaRefreshWalletData) window.__luminaRefreshWalletData();
            setTimeout(function(){ go("activity"); setTabByName("Activity"); if (window.__luminaRefreshActivity) window.__luminaRefreshActivity(); }, 1500);
            recipientInput.value = "";
            amountInput.value = "";
          } else if (result.status === "user_rejected") {
            toast(sendCopy("cancelled"));
          } else {
            var msg = window.__luminaFriendlySendError ? window.__luminaFriendlySendError(result.error) : (result.error || sendCopy("transferFailed"));
            toast(sendCopy("transferFailed") + ": " + msg);
          }
        } catch(e) {
          var code = e && e.message ? e.message : "generic_error";
          var friendly = window.__luminaFriendlySendError ? window.__luminaFriendlySendError(code) : code;
          toast(sendCopy("transferFailed") + ": " + friendly);
        } finally {
          console.log("[A7] finally — setSending false");
          sending = false;
          setButtonLoading(false);
          validation();
        }
      }
      var previousSelectSendToken = typeof selectSendToken === "function" ? selectSendToken : null;
      if (previousSelectSendToken && !window.__luminaSendSelectWrapped) {
        window.__luminaSendSelectWrapped = true;
        selectSendToken = function(sym){
          previousSelectSendToken(sym);
          validation();
        };
      }
      if (recipientInput && !recipientInput.__luminaSendWired) {
        recipientInput.__luminaSendWired = true;
        recipientInput.addEventListener("input", validation);
        recipientInput.addEventListener("blur", validation);
      }
      if (amountInput && !amountInput.__luminaSendWired) {
        amountInput.__luminaSendWired = true;
        amountInput.addEventListener("input", validation);
        amountInput.addEventListener("blur", validation);
      }
      if (maxBtn && !maxBtn.__luminaSendWired) {
        maxBtn.__luminaSendWired = true;
        maxBtn.textContent = "MAX";
        maxBtn.addEventListener("click", function(event){ event.preventDefault(); event.stopPropagation(); setMaxAmount(); });
      }
      if (submit && !submit.__luminaSendWired) {
        submit.__luminaSendWired = true;
        submit.onclick = function(event){ event.preventDefault(); handleSendClick(); };
      }
      validation();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance Send prototype");
}

/**
 * Replaces prototype Activity rows with real World Chain transfer history.
 */
function enhancePrototypeActivity() {
  const source = `
    (function(){
      var activityItems = [];
      function emptyActivity(message){
        return '<div style="text-align:center;color:var(--text-mute);padding:42px var(--pad-screen);font-size:14px;line-height:1.5;">' + message + '</div>';
      }
      function activityCopy(key){
        var lang = window.currentLang || "en";
        var copy = {
          loading: { en:"Loading activity...", fr:"Chargement de l'activité...", de:"Aktivität wird geladen...", es:"Cargando actividad...", ja:"アクティビティを読み込み中...", "zh-CN":"正在读取活动...", "zh-TW":"正在讀取活動..." },
          empty: { en:"No activity yet", fr:"Aucune activité pour le moment", de:"Noch keine Aktivität", es:"Aún no hay actividad", ja:"アクティビティはまだありません", "zh-CN":"暂无活动", "zh-TW":"暫無活動" },
          swapRoute: { en:"Swap", fr:"Échange", de:"Swap", es:"Intercambio", ja:"スワップ", "zh-CN":"兑换", "zh-TW":"兌換" },
          completed: { en:"Completed", fr:"Terminé", de:"Abgeschlossen", es:"Completado", ja:"完了", "zh-CN":"已完成", "zh-TW":"已完成" },
          pendingToast: { en:"Transaction submitted. Waiting for confirmation.", fr:"Transaction envoyée. En attente de confirmation.", de:"Transaktion gesendet. Warten auf Bestätigung.", es:"Transacción enviada. Esperando confirmación.", ja:"取引を送信しました。確認待ちです。", "zh-CN":"交易已提交,等待确认。", "zh-TW":"交易已提交,等待確認。" }
        };
        return (copy[key] && (copy[key][lang] || copy[key].en)) || key;
      }
      function activitySubtitle(value){
        if (/uniswap route/i.test(String(value || "")) || String(value || "") === "Swap") return activityCopy("swapRoute");
        return value || "";
      }
      function activityStatus(value){
        if (!value || /completed/i.test(String(value))) return activityCopy("completed");
        return value;
      }
      function readJson(key, fallback){
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch(e) { return fallback; }
      }
      function writeJson(key, value){
        try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
      }
      function localActivity(){
        var rows = readJson("lumina_local_activity", []);
        return Array.isArray(rows) ? rows : [];
      }
      function saveLocalActivity(rows){
        writeJson("lumina_local_activity", Array.isArray(rows) ? rows.slice(0, 50) : []);
      }
      function normalizeActivityItem(item){
        return {
          type: item && item.type || "swap",
          title: item && item.title || "Transaction",
          subtitle: item && item.subtitle || "",
          amount: item && item.amount || "—",
          status: item && item.status || "Completed",
          hash: item && item.hash || ("pending-" + Date.now()),
          createdAt: item && item.createdAt || new Date().toISOString()
        };
      }
      function mergeActivityRows(localRows, remoteRows){
        var seen = {};
        return []
          .concat(Array.isArray(localRows) ? localRows : [])
          .concat(Array.isArray(remoteRows) ? remoteRows : [])
          .map(normalizeActivityItem)
          .filter(function(item){
            var key = String(item.hash || "") || (item.title + item.amount + item.createdAt);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
          })
          .sort(function(a, b){ return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });
      }
      window.__luminaAddLocalActivity = function(item){
        var next = normalizeActivityItem(item || {});
        var rows = localActivity().filter(function(row){ return String(row && row.hash || "") !== String(next.hash || ""); });
        rows.unshift(next);
        saveLocalActivity(rows);
        activityItems = mergeActivityRows(rows, activityItems);
        renderActivity();
      };
      function tokenInitial(symbol){
        symbol = String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase();
        return symbol || "?";
      }
      function parseTokenAmount(value){
        var match = String(value || "").replace(/,/g, "").match(/([+-]?\\d+(?:\\.\\d+)?)/);
        if (!match) return 0;
        var number = Number(match[1]);
        return Number.isFinite(number) ? Math.abs(number) : 0;
      }
      function receivedSymbol(item){
        var direct = String(item && (item.symbol || item.tokenSymbol || item.token) || "").toUpperCase();
        if (direct) return direct;
        var source = String((item && (item.tokenText || item.amount || item.title)) || "");
        var titleMatch = String(item && item.title || "").match(/^Received\\s+([a-zA-Z0-9]{1,16})\\b/i);
        if (titleMatch) return titleMatch[1].toUpperCase();
        var amountMatch = source.match(/\\b([a-zA-Z][a-zA-Z0-9]{0,15})\\b\\s*$/);
        return amountMatch ? amountMatch[1].toUpperCase() : "";
      }
      function rememberReceivedAssets(rows){
        if (!Array.isArray(rows)) return;
        var remembered = readJson("lumina_recent_swap_assets_v1", []);
        if (!Array.isArray(remembered)) remembered = [];
        var changed = false;
        rows.forEach(function(item){
          if (!item || item.type !== "in") return;
          var title = String(item.title || "");
          if (title && !/^Received\\b/i.test(title)) return;
          var symbol = receivedSymbol(item);
          if (!symbol || symbol === "WLD" || symbol === "USDC") return;
          var amountNumber = Number(item.tokenAmount);
          if (!Number.isFinite(amountNumber) || amountNumber <= 0) amountNumber = parseTokenAmount(item.tokenText || item.amount);
          var amountText = amountNumber > 0
            ? (function(n){
                var digits = n < 0.00001 ? 12 : n < 1 ? 8 : 6;
                var display = n.toLocaleString("en-US", { useGrouping:false, maximumFractionDigits: digits });
                return display === "0" ? String(item.tokenAmount || item.tokenText || item.amount || n).replace(/,/g, "").replace(/(\\.\\d*?[1-9])0+$/, "$1").replace(/\\.0+$/, "") : display;
              })(amountNumber)
            : "0";
          var currentBalance = Number(String((balances && balances[symbol]) || "0").replace(/,/g, ""));
          tokenFull[symbol] = tokenFull[symbol] || item.tokenName || symbol;
          if (tokenLogo && window.__luminaTokenLogoHtml) tokenLogo[symbol] = window.__luminaTokenLogoHtml(symbol, tokenInitial(symbol));
          else if (tokenLogo && !tokenLogo[symbol]) tokenLogo[symbol] = tokenInitial(symbol);
          if (dotColor && !dotColor[symbol]) dotColor[symbol] = "linear-gradient(135deg,#1b231e,#26362b)";
          if (prices && prices[symbol] === undefined) prices[symbol] = 0;
          if (balances && (!(currentBalance > 0) && amountNumber > 0)) balances[symbol] = amountText;
          if (availMap && (!availMap[symbol] || availMap[symbol] === "0 " + symbol)) availMap[symbol] = (balances && balances[symbol] ? balances[symbol] : amountText) + " " + symbol;
          if (Array.isArray(assets)) {
            var existing = assets.find(function(asset){ return String(asset && asset.sym || "").toUpperCase() === symbol; });
            if (!existing) {
              assets.push({ sym:symbol, full:tokenFull[symbol] || symbol, amt:(balances && balances[symbol] ? balances[symbol] : amountText) + " " + symbol, usdNum:0, cls:"custom", logo:tokenLogo && tokenLogo[symbol] || tokenInitial(symbol), recentSwapAsset:true, receivedAsset:true });
            } else {
              existing.recentSwapAsset = true;
              existing.receivedAsset = true;
              existing.full = existing.full || tokenFull[symbol] || symbol;
              if (!(Number(String(existing.amt || "0").split(" ")[0].replace(/,/g, "")) > 0)) existing.amt = (balances && balances[symbol] ? balances[symbol] : amountText) + " " + symbol;
            }
          }
          remembered = remembered.filter(function(token){ return String(token && token.symbol || "").toUpperCase() !== symbol; });
          remembered.unshift({ symbol:symbol, name:tokenFull[symbol] || symbol, amount:balances && balances[symbol] ? balances[symbol] : amountText, usdNum:0, receivedAsset:true });
          changed = true;
        });
        if (changed) writeJson("lumina_recent_swap_assets_v1", remembered.slice(0, 24));
      }
      function itemHtml(a){
        var plus = a.type === "in" ? " plus" : "";
        var canOpen = a.hash && String(a.hash).indexOf("pending-") !== 0;
        return '<div class="act-item" onclick="' + (canOpen ? 'openExplorer(\\'' + a.hash + '\\')' : 'toast(\\'' + activityCopy("pendingToast") + '\\')') + '" style="cursor:pointer;">' +
          '<div class="act-ic ' + a.type + '">' + actIcon(a.type) + '</div>' +
          '<div class="act-mid"><div class="t">' + a.title + (canOpen ? ' <span style="color:var(--text-mute);font-size:11px;">↗</span>' : '') + '</div><div class="s">' + activitySubtitle(a.subtitle) + '</div></div>' +
          '<div class="act-amt"><div class="v' + plus + '">' + a.amount + '</div><div class="st">' + activityStatus(a.status) + '</div></div>' +
        '</div>';
      }
      renderActivity = function(){
        var box = document.getElementById("actList");
        if (!box) return;
        var items = activityItems.filter(function(item){ return actFilter === "all" || item.type === actFilter; });
        box.innerHTML = items.length ? items.map(itemHtml).join("") : emptyActivity(activityCopy("empty"));
      };
      window.__luminaRefreshActivity = function(){
        var box = document.getElementById("actList");
        if (box && !activityItems.length && !box.children.length) box.innerHTML = emptyActivity(activityCopy("loading"));
        var localRows = localActivity();
        var address = window.__luminaUserAddress || "";
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          activityItems = mergeActivityRows(localRows, []);
          renderActivity();
          return;
        }
        fetch("/api/activity?address=" + encodeURIComponent(address), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : []; })
          .then(function(rows){ activityItems = mergeActivityRows(localRows, Array.isArray(rows) ? rows : []); rememberReceivedAssets(activityItems); renderActivity(); if (typeof renderAssets === "function") renderAssets(); })
          .catch(function(){ activityItems = mergeActivityRows(localRows, []); renderActivity(); });
      };
      if (!window.__luminaActivityGoWrapped && typeof go === "function") {
        window.__luminaActivityGoWrapped = true;
        var previousGo = go;
        go = function(name){
          previousGo(name);
          if (name === "activity") setTimeout(window.__luminaRefreshActivity, 80);
        };
      }
      window.__luminaRefreshActivity();
      setInterval(function(){
        var view = document.getElementById("view-activity");
        if (view && view.classList.contains("active")) window.__luminaRefreshActivity();
      }, 60000);
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance real activity");
}

/**
 * Rebuilds the Me page around feedback, legal links, preferences, and real user identity.
 */
function enhancePrototypeMe() {
  const source = `
    (function(){
      function meCopy(){
        var lang = window.currentLang || "en";
        var labels = {
          support: { en:"Support", fr:"Assistance", de:"Support", es:"Soporte", ja:"サポート", "zh-CN":"支持", "zh-TW":"支援" },
          feedback: { en:"Feedback", fr:"Retour", de:"Feedback", es:"Comentarios", ja:"フィードバック", "zh-CN":"在线反馈", "zh-TW":"線上回饋" },
          points: { en:"Points", fr:"Points", de:"Punkte", es:"Puntos", ja:"ポイント", "zh-CN":"积分", "zh-TW":"積分" },
          pointsCenter: { en:"Points Center", fr:"Centre de points", de:"Punktezentrum", es:"Centro de puntos", ja:"ポイントセンター", "zh-CN":"积分中心", "zh-TW":"積分中心" },
          pointsRule: { en:"Earn 1 point for every $1 traded.", fr:"Gagnez 1 point par 1 $ échangé.", de:"1 Punkt pro gehandeltem $1.", es:"Gana 1 punto por cada $1 negociado.", ja:"取引 $1 ごとに 1 ポイント獲得。", "zh-CN":"交易 1 美元获得 1 积分。", "zh-TW":"交易 1 美元獲得 1 積分。" },
          lifetimePoints: { en:"Lifetime points", fr:"Points cumulés", de:"Gesamtpunkte", es:"Puntos totales", ja:"累計ポイント", "zh-CN":"累计积分", "zh-TW":"累計積分" },
          pointsHistory: { en:"Points history", fr:"Historique des points", de:"Punkteverlauf", es:"Historial de puntos", ja:"ポイント履歴", "zh-CN":"积分记录", "zh-TW":"積分記錄" },
          tradeLabel: { en:"Trade", fr:"Transaction", de:"Transaktion", es:"Operación", ja:"取引", "zh-CN":"交易", "zh-TW":"交易" },
          noPoints: { en:"No points records yet.", fr:"Aucun point pour le moment.", de:"Noch keine Punkte.", es:"Aún no hay puntos.", ja:"ポイント履歴はまだありません。", "zh-CN":"暂无积分记录。", "zh-TW":"暫無積分記錄。" },
          mediaCenter: { en:"Media Center", fr:"Centre média", de:"Medienzentrum", es:"Centro multimedia", ja:"メディアセンター", "zh-CN":"媒体中心", "zh-TW":"媒體中心" },
          mediaHint: { en:"Follow Lumina official channels.", fr:"Suivez les canaux officiels Lumina.", de:"Folgen Sie den offiziellen Lumina-Kanälen.", es:"Sigue los canales oficiales de Lumina.", ja:"Lumina 公式チャンネルをフォロー。", "zh-CN":"查看 Lumina 官方媒体链接。", "zh-TW":"查看 Lumina 官方媒體連結。" },
          noMedia: { en:"No media links configured yet.", fr:"Aucun lien média configuré.", de:"Noch keine Medienlinks konfiguriert.", es:"Aún no hay enlaces configurados.", ja:"メディアリンクは未設定です。", "zh-CN":"后台还没有配置媒体链接。", "zh-TW":"後台還沒有配置媒體連結。" },
          preferences: { en:"Preferences", fr:"Préférences", de:"Einstellungen", es:"Preferencias", ja:"設定", "zh-CN":"偏好设置", "zh-TW":"偏好設定" },
          language: { en:"Language", fr:"Langue", de:"Sprache", es:"Idioma", ja:"言語", "zh-CN":"语言", "zh-TW":"語言" },
          currency: { en:"Display currency", fr:"Devise d'affichage", de:"Anzeigewährung", es:"Moneda", ja:"表示通貨", "zh-CN":"显示货币", "zh-TW":"顯示貨幣" },
          notifications: { en:"Notifications", fr:"Notifications", de:"Benachrichtigungen", es:"Notificaciones", ja:"通知", "zh-CN":"通知", "zh-TW":"通知" },
          legal: { en:"Legal", fr:"Legal", de:"Legal", es:"Legal", ja:"Legal", "zh-CN":"Legal", "zh-TW":"Legal" },
          privacy: { en:"Privacy Policy", fr:"Privacy Policy", de:"Privacy Policy", es:"Privacy Policy", ja:"Privacy Policy", "zh-CN":"Privacy Policy", "zh-TW":"Privacy Policy" },
          terms: { en:"Terms of Service", fr:"Terms of Service", de:"Terms of Service", es:"Terms of Service", ja:"Terms of Service", "zh-CN":"Terms of Service", "zh-TW":"Terms of Service" },
          version: { en:"Version", fr:"Version", de:"Version", es:"Versión", ja:"バージョン", "zh-CN":"版本", "zh-TW":"版本" },
          connected: { en:"World App connected", fr:"World App connecté", de:"World App verbunden", es:"World App conectado", ja:"World App 接続済み", "zh-CN":"World App 已连接", "zh-TW":"World App 已連接" },
          notConnected: { en:"Not connected", fr:"Non connecté", de:"Nicht verbunden", es:"No conectado", ja:"未接続", "zh-CN":"未连接", "zh-TW":"未連接" },
          feedbackTitle: { en:"Feedback", fr:"Retour", de:"Feedback", es:"Comentarios", ja:"フィードバック", "zh-CN":"在线反馈", "zh-TW":"線上回饋" },
          feedbackHint: { en:"Tell us what went wrong or what you want improved. Feedback is saved for the Lumina team.", fr:"Dites-nous ce qui ne va pas ou ce que vous voulez améliorer.", de:"Sag uns, was nicht funktioniert oder verbessert werden soll.", es:"Cuéntanos qué falló o qué quieres mejorar.", ja:"問題や改善してほしい点をお知らせください。", "zh-CN":"告诉我们哪里出错了，或你希望改进什么。反馈会保存给 Lumina 团队。", "zh-TW":"告訴我們哪裡出錯，或你希望改善什麼。" },
          feedbackPlaceholder: { en:"Tell us what happened...", fr:"Dites-nous ce qui s'est passé...", de:"Beschreibe, was passiert ist...", es:"Cuéntanos qué pasó...", ja:"何が起きたか入力...", "zh-CN":"请输入你的反馈...", "zh-TW":"請輸入你的回饋..." },
          contactPlaceholder: { en:"Telegram / email (optional)", fr:"Telegram / e-mail (facultatif)", de:"Telegram / E-Mail (optional)", es:"Telegram / email (opcional)", ja:"Telegram / email（任意）", "zh-CN":"联系方式 / Telegram / email（可选）", "zh-TW":"聯絡方式 / Telegram / email（選填）" },
          send: { en:"Send feedback", fr:"Envoyer", de:"Senden", es:"Enviar", ja:"送信", "zh-CN":"发送反馈", "zh-TW":"送出回饋" },
          sending: { en:"Sending...", fr:"Envoi...", de:"Wird gesendet...", es:"Enviando...", ja:"送信中...", "zh-CN":"发送中...", "zh-TW":"送出中..." },
          tooShort: { en:"Please enter at least 3 characters.", fr:"Saisissez au moins 3 caractères.", de:"Bitte mindestens 3 Zeichen eingeben.", es:"Introduce al menos 3 caracteres.", ja:"3文字以上入力してください。", "zh-CN":"请输入至少 3 个字的反馈内容", "zh-TW":"請至少輸入 3 個字" },
          sent: { en:"Feedback sent", fr:"Retour envoyé", de:"Feedback gesendet", es:"Comentarios enviados", ja:"送信しました", "zh-CN":"反馈已发送", "zh-TW":"回饋已送出" },
          failed: { en:"Unable to send feedback. Please try again.", fr:"Impossible d'envoyer. Réessayez.", de:"Senden fehlgeschlagen. Bitte erneut versuchen.", es:"No se pudo enviar. Inténtalo de nuevo.", ja:"送信できません。もう一度お試しください。", "zh-CN":"发送失败，请稍后重试", "zh-TW":"送出失敗，請稍後再試" }
        };
        var out = {};
        Object.keys(labels).forEach(function(key){
          out[key] = labels[key][lang] || labels[key].en;
        });
        return out;
      }
      function meIcon(name) {
        if (name === "feedback") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4z"/><path d="M8 9h8M8 13h5"/></svg>';
        if (name === "points") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.9 6 6.6.9-4.8 4.7 1.1 6.5L12 17l-5.8 3.1 1.1-6.5-4.8-4.7 6.6-.9L12 2z"/></svg>';
        if (name === "media") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4.2M8.6 13.4l6.8 4.2"/></svg>';
        if (name === "privacy") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12l1.7 1.7 3.8-4"/></svg>';
        if (name === "terms") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>';
        if (name === "version") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
        if (name === "language") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>';
        if (name === "currency") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
        if (name === "bell") return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
        return "";
      }
      function row(icon, label, value, action, extra) {
        return '<div class="me-row" ' + (action ? 'onclick="' + action + '"' : '') + '><span class="ic">' + meIcon(icon) + '</span><span class="lbl">' + label + '</span>' + (value ? '<span class="val">' + value + '</span>' : '') + (extra || '<span class="chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>') + '</div>';
      }
      function feedbackRow(label) {
        return '<div class="me-row" onclick="openFeedback()"><span class="ic feedback-ic">' + meIcon("feedback") + '<b id="feedbackUnreadDot">1</b></span><span class="lbl">' + label + '</span><span class="chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span></div>';
      }
      function toggleHtml(){
        return '<span class="toggle on" onclick="event.stopPropagation();this.classList.toggle(\\'on\\')"></span>';
      }
      function socialLinks(){
        try {
          var cfg = JSON.parse(localStorage.getItem("ww_system_config") || "{}");
          return cfg.socialLinks || {};
        } catch(e) {
          return {};
        }
      }
      function normalizeSocialItem(raw){
        if (!raw) return null;
        if (typeof raw === "string") return { url: raw, logoUrl: "" };
        return { url: raw.url || "", logoUrl: raw.logoUrl || "" };
      }
      function safeAttr(value){
        return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      }
      function linkIcon(label, logoUrl){
        if (/^https?:\\/\\//i.test(String(logoUrl || ""))) {
          return '<span class="media-icon has-img"><img src="' + safeAttr(logoUrl) + '" alt="' + safeAttr(label) + ' logo" onerror="this.parentNode.textContent=\\'' + String(label || "?").slice(0, 1).toUpperCase() + '\\'"></span>';
        }
        return '<span class="media-icon">' + String(label || "?").slice(0, 1).toUpperCase() + '</span>';
      }
      function socialRows(){
        var links = socialLinks();
        return [
          ["x", "X"],
          ["telegram", "Telegram"],
          ["website", "Website"],
          ["discord", "Discord"],
          ["youtube", "YouTube"]
        ].map(function(item){
          var data = normalizeSocialItem(links[item[0]]);
          return data && data.url ? { key:item[0], label:item[1], url:data.url, logoUrl:data.logoUrl } : null;
        }).filter(Boolean).map(function(item){
          return '<button class="media-row" onclick="window.open(\\'' + String(item.url).replace(/'/g, "%27") + '\\', \\'_blank\\')">' + linkIcon(item.label, item.logoUrl) + '<span>' + item.label + '</span><i>↗</i></button>';
        }).join("");
      }
      function ensureMediaModal(){
        if (document.getElementById("mediaModal")) return;
        var modal = document.createElement("div");
        modal.className = "modal-mask";
        modal.id = "mediaModal";
        modal.onclick = function(event){ if(event.target === modal) closeMediaCenter(); };
        modal.innerHTML = '<div class="modal media-sheet"><div class="modal-grip"></div><h3></h3><p></p><div id="mediaRows"></div></div>';
        document.body.appendChild(modal);
      }
      window.openMediaCenter = function(){
        ensureMediaModal();
        var c = meCopy();
        var modal = document.getElementById("mediaModal");
        modal.querySelector("h3").textContent = c.mediaCenter;
        modal.querySelector("p").textContent = c.mediaHint;
        document.getElementById("mediaRows").innerHTML = socialRows() || '<div class="media-empty">' + c.noMedia + '</div>';
        modal.classList.add("open");
      };
      window.closeMediaCenter = function(){
        var modal = document.getElementById("mediaModal");
        if (modal) modal.classList.remove("open");
      };
      function priceForSymbol(symbol){
        try {
          if (prices && prices[symbol]) return Number(prices[symbol]);
          if (symbol === "WETH") return Number(prices && prices.ETH);
          if (symbol === "WBTC" || symbol === "BTC") return Number(prices && prices.BTC);
          if (symbol === "USDT" || symbol === "USDC" || symbol === "EURC") return 1;
          var markets = window.__luminaMarketPrices || [];
          var market = markets.find(function(item){ return item.symbol === symbol; });
          return market ? Number(market.priceUsd || market.usd) : 0;
        } catch(e) {
          return 0;
        }
      }
      function pointsFromActivity(rows){
        var total = 0;
        var records = [];
        (rows || []).forEach(function(item){
          var text = String(item.amount || "").replace(/[+,]/g, "").trim();
          var match = text.match(/(-?\\d+(?:\\.\\d+)?)\\s+([A-Za-z0-9$]+)/);
          if (!match) return;
          var amount = Math.abs(Number(match[1]));
          var symbol = match[2].replace(/^\\$/, "");
          var price = priceForSymbol(symbol);
          if (Number.isFinite(amount) && Number.isFinite(price) && price > 0) {
            var usd = amount * price;
            var points = Math.floor(usd);
            if (points > 0) {
              records.push({ date: item.time || item.day || item.createdAt || "", usd: usd, points: points, symbol: symbol });
              total += points;
            }
          }
        });
        window.__luminaPointRecords = records;
        return Math.floor(total);
      }
      function refreshPoints(){
        var badge = document.getElementById("mePointsBadge");
        var center = document.getElementById("pointsCenterValue");
        function setValue(value){
          window.__luminaPoints = value;
          if (!Array.isArray(window.__luminaPointRecords)) window.__luminaPointRecords = [];
          if (badge) badge.textContent = value.toLocaleString();
          if (center) center.textContent = value.toLocaleString();
        }
        setValue(Number(window.__luminaPoints || 0));
        var address = window.__luminaUserAddress || "";
        if (!address) return;
        fetch("/api/activity?address=" + encodeURIComponent(address), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : []; })
          .then(function(rows){ setValue(pointsFromActivity(Array.isArray(rows) ? rows : [])); })
          .catch(function(){});
      }
      function updateFeedbackCopy(){
        var modal = document.getElementById("feedbackModal");
        if (!modal) return;
        var c = meCopy();
        var title = modal.querySelector("h3");
        var hint = modal.querySelector(".feedback-hint");
        var text = document.getElementById("feedbackText");
        var contact = document.getElementById("feedbackContact");
        var btn = document.getElementById("feedbackSendBtn");
        if (title) title.textContent = c.feedbackTitle;
        if (hint) hint.textContent = c.feedbackHint;
        if (text) text.setAttribute("placeholder", c.feedbackPlaceholder);
        if (contact) contact.setAttribute("placeholder", c.contactPlaceholder);
        if (btn && !btn.disabled) btn.textContent = c.send;
      }
      function feedbackReadKey(){
        return "lumina_feedback_read_at_" + (window.__luminaUserAddress || "guest").toLowerCase();
      }
      function getFeedbackReadAt(){
        try { return Number(localStorage.getItem(feedbackReadKey()) || "0"); } catch(e) { return 0; }
      }
      function setFeedbackReadAt(value){
        try { localStorage.setItem(feedbackReadKey(), String(value || Date.now())); } catch(e) {}
      }
      function replyTime(item){
        var at = item && item.repliedAt ? new Date(item.repliedAt).getTime() : 0;
        return Number.isFinite(at) ? at : 0;
      }
      function updateFeedbackUnread(rows){
        var dot = document.getElementById("feedbackUnreadDot");
        if (!dot) return;
        var readAt = getFeedbackReadAt();
        var count = (rows || []).filter(function(item){ return item && item.reply && replyTime(item) > readAt; }).length;
        dot.textContent = String(Math.min(count, 9));
        dot.style.display = count > 0 ? "grid" : "none";
      }
      function ensureFeedbackModal(){
        if (document.getElementById("feedbackModal")) { updateFeedbackCopy(); return; }
        var modal = document.createElement("div");
        modal.className = "modal-mask";
        modal.id = "feedbackModal";
        modal.onclick = function(event){ if(event.target === modal) closeFeedback(); };
        modal.innerHTML =
          '<div class="modal feedback-sheet"><div class="modal-grip"></div><h3></h3>' +
          '<p class="feedback-hint"></p>' +
          '<textarea id="feedbackText" maxlength="1200"></textarea>' +
          '<input id="feedbackContact" maxlength="120" />' +
          '<button id="feedbackSendBtn" onclick="sendFeedback()"></button>' +
          '<div id="feedbackReplies" style="margin-top:14px;"></div></div>';
        document.body.appendChild(modal);
        updateFeedbackCopy();
      }
      window.loadFeedbackReplies = async function(markRead){
        var box = document.getElementById("feedbackReplies");
        if (!box || !window.__luminaUserAddress) return;
        try {
          var res = await fetch("/api/feedback?address=" + encodeURIComponent(window.__luminaUserAddress), { cache: "no-store" });
          var rows = await res.json().catch(function(){ return []; });
          if (!res.ok || !Array.isArray(rows) || !rows.length) { box.innerHTML = ""; updateFeedbackUnread([]); return; }
          if (markRead) {
            var latestReplyAt = rows.reduce(function(max, item){ return Math.max(max, replyTime(item)); }, 0);
            if (latestReplyAt) setFeedbackReadAt(latestReplyAt);
          }
          updateFeedbackUnread(rows);
          box.innerHTML = '<div style="font-size:12px;color:var(--text-mute);margin-bottom:8px;">Team replies</div>' + rows.map(function(item){
            var reply = item.reply ? '<div style="margin-top:8px;padding:10px;border-radius:12px;background:rgba(74,222,128,.12);color:var(--text);"><strong>Lumina:</strong> ' + escapeHtml(item.reply) + '</div>' : '';
            return '<div style="border-top:1px solid var(--line);padding:10px 0;font-size:13px;line-height:1.5;"><div style="color:var(--text-dim);">' + escapeHtml(item.message) + '</div>' + reply + '</div>';
          }).join('');
        } catch(e) {
          box.innerHTML = "";
        }
      };
      window.openFeedback = function(){
        ensureFeedbackModal();
        updateFeedbackCopy();
        document.getElementById("feedbackText").value = "";
        document.getElementById("feedbackContact").value = "";
        document.getElementById("feedbackModal").classList.add("open");
        if (typeof loadFeedbackReplies === "function") loadFeedbackReplies(true);
      };
      window.closeFeedback = function(){
        var modal = document.getElementById("feedbackModal");
        if (modal) modal.classList.remove("open");
      };
      window.sendFeedback = async function(){
        var c = meCopy();
        var text = (document.getElementById("feedbackText").value || "").trim();
        var contact = (document.getElementById("feedbackContact").value || "").trim();
        if (text.length < 3) { toast(c.tooShort); return; }
        var btn = document.getElementById("feedbackSendBtn");
        btn.disabled = true;
        btn.textContent = c.sending;
        try {
          var res = await fetch("/api/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: text,
              contact: contact,
              address: window.__luminaUserAddress || "",
              username: window.__luminaUsername || ""
            })
          });
          var data = await res.json().catch(function(){ return null; });
          if (!res.ok || !data || data.ok !== true) throw new Error((data && data.error) || c.failed);
          if (typeof loadFeedbackReplies === "function") loadFeedbackReplies();
          closeFeedback();
          toast(c.sent);
        } catch(e) {
          toast(e && e.message ? e.message : c.failed);
        } finally {
          btn.disabled = false;
          btn.textContent = meCopy().send;
        }
      };
      window.copyMeAddress = function(event){
        if (event) event.stopPropagation();
        var address = window.__luminaUserAddress || "";
        if (!address) {
          toast("No address connected");
          return;
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(address);
          } else {
            var input = document.createElement("textarea");
            input.value = address;
            input.setAttribute("readonly", "readonly");
            input.style.position = "fixed";
            input.style.left = "-9999px";
            document.body.appendChild(input);
            input.select();
            document.execCommand("copy");
            input.remove();
          }
        } catch(e) {}
        toast("Address copied", "success");
      };
      function renderMe(){
        var c = meCopy();
        var view = document.getElementById("view-me");
        if (!view) return;
        var address = window.__luminaUserAddress || "";
        var short = address ? address.slice(0, 6) + "..." + address.slice(-4) : c.notConnected;
        var name = window.__luminaUsername || short;
        var langObj = (typeof languages !== "undefined" && languages.filter(function(l){ return l.code === (window.currentLang || "en"); })[0]) || null;
        var langValue = '<span id="langVal">' + (langObj ? langObj.name : "English") + '</span>';
        var currencyValue = '<span id="currencyVal">' + (typeof currentCurrency !== "undefined" ? currentCurrency : "USD") + '</span>';
        view.innerHTML =
          '<div class="subhead" style="padding-bottom:14px"><h1>Me</h1></div>' +
          '<div class="me-card"><div class="me-avatar"></div><div class="me-info"><div class="me-name">' + name + ' <span class="v"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.4 1.7 2.9-.3 1.2 2.7 2.7 1.2-.3 2.9L23 12l-1.7 2.4.3 2.9-2.7 1.2-1.2 2.7-2.9-.3L12 23l-2.4-1.7-2.9.3-1.2-2.7-2.7-1.2.3-2.9L1 12l1.7-2.4-.3-2.9 2.7-1.2L6.3 2.7l2.9.3z"/><path d="M10.5 15.2l-2.7-2.7 1.4-1.4 1.3 1.3 4-4 1.4 1.4z" fill="#000"/></svg></span></div><div class="me-addr"><span>' + short + '</span>' + (address ? '<button type="button" class="me-copy-btn" onclick="copyMeAddress(event)" aria-label="Copy address"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' : '') + '</div><span class="me-orb">' + c.connected + '</span></div><button type="button" class="me-points-chip" onclick="openPointsCenter()"><b id="mePointsBadge">' + Number(window.__luminaPoints || 0).toLocaleString() + '</b><span>' + c.points + '</span></button></div>' +
          '<div class="me-group-label">' + c.support + '</div><div class="me-group">' +
            feedbackRow(c.feedback) +
          '</div>' +
          '<div class="me-group-label">' + c.pointsCenter + '</div><div class="me-group">' +
            row("points", c.pointsCenter, '<span id="pointsCenterValue">' + Number(window.__luminaPoints || 0).toLocaleString() + '</span>', "openPointsCenter()") +
          '</div>' +
          '<div class="me-group-label">' + c.preferences + '</div><div class="me-group">' +
            row("media", c.mediaCenter, "", "openMediaCenter()") +
            row("language", c.language, langValue, "openLangModal()") +
            row("currency", c.currency, currencyValue, "openCurrencyModal()") +
            row("bell", c.notifications, "", "", toggleHtml()) +
          '</div>' +
          '<div class="me-group-label">' + c.legal + '</div><div class="me-group">' +
            row("privacy", c.privacy, "", "window.__luminaOpenLegal && window.__luminaOpenLegal(\\'privacy\\')") +
            row("terms", c.terms, "", "window.__luminaOpenLegal && window.__luminaOpenLegal(\\'terms\\')") +
            row("version", c.version, "Lumina v1.0.0", "", "") +
          '</div>';
        ensureFeedbackModal();
        ensureMediaModal();
        refreshPoints();
        if (typeof loadFeedbackReplies === "function") loadFeedbackReplies(false);
      }
      window.openPointsCenter = function(){
        var c = meCopy();
        var old = document.getElementById("pointsModal");
        if (old) old.remove();
        var modal = document.createElement("div");
        modal.className = "modal-mask open";
        modal.id = "pointsModal";
        modal.onclick = function(event){ if(event.target === modal) modal.remove(); };
        function dateText(raw){
          var d = raw ? new Date(raw) : null;
          if (!d || isNaN(d.getTime())) d = new Date();
          return d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate();
        }
        var records = (window.__luminaPointRecords || []).slice(0, 20);
        var list = records.length ? records.map(function(item){
          var usd = Number(item.usd || 0);
          var usdText = "$" + (usd >= 10 ? usd.toFixed(0) : usd.toFixed(2)).replace(/\\.00$/, "");
          return '<div class="points-record"><div><strong>' + dateText(item.date) + '</strong><span>' + c.tradeLabel + ' ' + usdText + '</span></div><b>+' + Number(item.points || 0).toLocaleString() + '</b></div>';
        }).join("") : '<div class="points-empty">' + c.noPoints + '</div>';
        modal.innerHTML = '<div class="modal points-sheet"><div class="modal-grip"></div><h3>' + c.pointsCenter + '</h3><div class="points-hero"><strong>' + Number(window.__luminaPoints || 0).toLocaleString() + '</strong><span>' + c.lifetimePoints + '</span></div><div class="points-rule">' + c.pointsRule + '</div><div class="points-history-title">' + c.pointsHistory + '</div><div class="points-records">' + list + '</div></div>';
        document.body.appendChild(modal);
      };
      window.__luminaRenderMe = renderMe;
      if (!window.__luminaMeLangPatch && typeof applyLang === "function") {
        window.__luminaMeLangPatch = true;
        var previousApplyLang = applyLang;
        applyLang = function(code){
          previousApplyLang(code);
          if (window.__luminaLanguageChoiceActive) {
            try {
              localStorage.setItem("ww_lang_pref_v2", code);
              localStorage.setItem("ww_lang", code);
            } catch(e) {}
          }
          if (typeof window.__luminaRenderMe === "function") window.__luminaRenderMe();
          updateFeedbackCopy();
        };
      }
      if (!window.__luminaChooseLangPatch && typeof chooseLang === "function") {
        window.__luminaChooseLangPatch = true;
        var previousChooseLang = chooseLang;
        chooseLang = function(code){
          window.__luminaLanguageChoiceActive = true;
          try {
            previousChooseLang(code);
          } finally {
            window.__luminaLanguageChoiceActive = false;
          }
        };
      }
      (function enforceDefaultEnglishLang(){
        var savedLang = "";
        try { savedLang = localStorage.getItem("ww_lang_pref_v2") || ""; } catch(e) {}
        if (savedLang) {
          applyLang(savedLang);
          return;
        }
        try { localStorage.removeItem("ww_lang"); } catch(e) {}
        applyLang("en");
      })();
      if (!window.__luminaMeCurrencyPatch && typeof pickCurrency === "function") {
        window.__luminaMeCurrencyPatch = true;
        var previousPickCurrency = pickCurrency;
        pickCurrency = function(code){
          previousPickCurrency(code);
          if (typeof window.__luminaRenderMe === "function") window.__luminaRenderMe();
        };
      }
      renderMe();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance Me page");
}

/**
 * Adds interactive market ranges and a Worldscan link to the preserved prototype detail view.
 */
function enhancePrototypeDetail() {
  const scriptEl = document.createElement("script");
  scriptEl.text = `
    (function(){
      var contracts = {
        WLD: "0x2cfc85d8e48f8eab294be644d9e25c3030863003",
        USDC: "0x79a02482a880bce3f13e09da970dc34db4cd24d1"
      };
      var seriesByRange = {
        "1H": [44,46,45,48,47,50,49,53,52,56,55,58],
        "1D": [35,40,39,43,38,41,47,54,57,66,65,71,58,54,48,44,39,42,51,56,64,62,71,77,77,69,65,65],
        "1W": [40,44,47,43,52,59,63,61,67,71,69,74,78,73,80,84,82],
        "1M": [62,65,63,55,51,57,66,73,74,62,54,48,39,41,53,61,67,58],
        "1Y": [28,35,41,38,47,55,62,59,66,74,70,78,82,76,86,90,87],
        "ALL": [18,20,24,23,28,32,31,36,40,45,43,50,54,53,59,64,62,69,72,76,74,81,79,86]
      };

      function chartSvg(range, forceDown) {
        var values = seriesByRange[range] || seriesByRange["1D"];
        var width = 430;
        var height = 230;
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var span = Math.max(1, max - min);
        var down = forceDown === true || values[values.length - 1] < values[0];
        var color = down ? "#f87171" : "#4ade80";
        var points = values.map(function(v, i) {
          var x = 46 + (i / (values.length - 1)) * (width - 64);
          var y = 82 + ((max - v) / span) * 88;
          return [x, y];
        });
        var line = points.map(function(p, i) {
          return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
        }).join(" ");
        var last = points[points.length - 1];
        var area = line + " L " + last[0].toFixed(1) + " 190 L 46 190 Z";
        var topLabel = "$" + (max / 100).toFixed(4);
        var bottomLabel = "$" + (min / 100).toFixed(4);
        return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs><linearGradient id="luminaDetailArea" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.42"/>' +
          '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<text x="10" y="82" fill="#98a09a" font-size="12">' + topLabel + '</text>' +
          '<text x="10" y="174" fill="#626862" font-size="12">' + bottomLabel + '</text>' +
          '<path d="'+area+'" fill="url(#luminaDetailArea)"/>' +
          '<path d="'+line+'" fill="none" stroke="' + color + '" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6" fill="' + color + '"/>' +
          '<text x="18" y="213" fill="#9da39d" font-size="15">00:00</text>' +
          '<text x="202" y="213" fill="#9da39d" font-size="15">12:00</text>' +
          '<text x="372" y="213" fill="#9da39d" font-size="15">24:00</text>' +
          '</svg>';
      }

      function detailIcon(name) {
        if (name === "activity") {
          return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2h7l4 4v16H5V2h3z"/><path d="M14 2v5h5"/><path d="M8 12h8M8 16h8"/></svg>';
        }
        if (name === "globe") {
          return '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>';
        }
        if (name === "more") {
          return '<svg width="23" height="23" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
        }
        return "";
      }

      function detailTokenIcon(asset) {
        return window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(asset.sym, asset.logo || asset.sym.charAt(0)) : "";
      }

      function compactUsd(value) {
        var n = Number(value || 0);
        if (!Number.isFinite(n)) return "$0";
        if (n >= 1000000) return "$" + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
        if (n >= 1000) return "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
        return "$" + n.toFixed(0);
      }
      function detailLang(){
        return (window.currentLang || "en") === "zh-CN" ? "zh-CN" : "en";
      }
      function detailCopy(key){
        var zh = detailLang() === "zh-CN";
        var copy = {
          noChart: zh ? "暂无" : "No real",
          chartData: zh ? "行情图数据" : "chart data",
          forToken: zh ? "的" : "for",
          liveData: zh ? "实时行情" : "Live market data",
          noCandles: zh ? "池子暂未返回 K 线历史。" : "No candle history from the pool yet.",
          price: zh ? "价格" : "Price",
          change24h: zh ? "24h 涨跌" : "24h Change",
          volume24h: zh ? "24h 交易量" : "24h Volume",
          liquidity: zh ? "流动性" : "Liquidity",
          loadingMarket: zh ? "正在读取行情..." : "Loading market data...",
          lookupFailed: zh ? "行情池查询失败。" : "Market pool lookup failed.",
          noPool: zh ? "暂未找到 GeckoTerminal 池子。" : "No GeckoTerminal pool found.",
          loadingHistory: zh ? "正在读取行情历史..." : "Loading market history...",
          noHistory: zh ? "未找到市场历史。" : "No market history found.",
          historyFailed: zh ? "行情历史请求失败。" : "Market history request failed.",
          noDexPool: zh ? "未找到 DEX 池子,尝试读取历史行情。" : "No DEX pool found; CoinGecko history unavailable.",
          loadingChart: zh ? "正在读取 K 线..." : "Loading chart...",
          emptyOhlcv: zh ? "DEX K 线暂为空。" : "DEX OHLCV returned empty.",
          ohlcvFailed: zh ? "DEX K 线请求失败。" : "DEX OHLCV request failed.",
          noData: zh ? "暂无数据" : "No data",
          noSwaps: zh ? "暂无最近兑换。" : "No recent swaps found.",
          marketPairUnavailable: zh ? "暂无行情交易对。" : "Market pair unavailable.",
          loadingTrades: zh ? "正在读取成交..." : "Loading trades...",
          tradesFailed: zh ? "成交记录读取失败。" : "Unable to load trades.",
          buy: zh ? "买入" : "Buy",
          sell: zh ? "卖出" : "Sell",
          trades: zh ? "成交" : "Trades",
          livePool: zh ? "实时池子" : "Live pool",
          receive: zh ? "接收" : "Receive",
          swap: zh ? "兑换" : "Swap",
          send: zh ? "发送" : "Send",
          recentActivity: zh ? "最近活动" : "Recent Activity",
          viewExplorer: zh ? "在浏览器查看" : "View on Explorer"
        };
        return copy[key] || key;
      }
      function detailVerifyMeta(asset){
        var market = marketForAsset(asset);
        var status = String((asset && asset.status) || (market && market.status) || "").toLowerCase();
        if (status === "verified") return { cls:"ok", text: detailLang() === "zh-CN" ? "已验证" : "Verified" };
        if (status === "rejected" || status === "high" || status === "danger") return { cls:"danger", text: detailLang() === "zh-CN" ? "高风险" : "High risk" };
        if (status === "pending" || status === "community" || status === "unverified") return { cls:"warn", text: detailLang() === "zh-CN" ? "未验证" : "Unverified" };
        if (market && market.verified === true) return { cls:"ok", text: detailLang() === "zh-CN" ? "已验证" : "Verified" };
        return { cls:"warn", text: detailLang() === "zh-CN" ? "未验证" : "Unverified" };
      }
      function updateDetailVerifyBadge(asset){
        var badge = document.getElementById("detVerifyBadge");
        if (!badge) return;
        var meta = detailVerifyMeta(asset);
        badge.className = "detail-verify-badge " + meta.cls;
        badge.textContent = meta.text;
      }

      function marketForAsset(asset) {
        var map = window.__luminaMarketBySymbol || {};
        var sym = String(asset && asset.sym || "").toUpperCase();
        if (map[sym]) return map[sym];
        var address = assetMarketAddress(asset);
        if (address) {
          var values = Object.keys(map).map(function(key){ return map[key]; });
          for (var i = 0; i < values.length; i++) {
            if (String(values[i] && values[i].address || "").toLowerCase() === address) return values[i];
          }
        }
        if (asset && asset.poolAddress) {
          return {
            symbol: sym,
            name: asset.full || sym,
            address: address || asset.address || asset.contractAddr || null,
            poolAddress: asset.poolAddress,
            priceUsd: Number(asset.usdNum || 0) > 0 && Number(String(asset.amt || "0").split(" ")[0].replace(/,/g, "")) > 0
              ? Number(asset.usdNum || 0) / Number(String(asset.amt || "0").split(" ")[0].replace(/,/g, ""))
              : (sym === "USDC" || sym === "EURC" ? 1 : null),
            change24h: null,
            volume24hUsd: 0,
            liquidityUsd: 1,
            logoUrl: null,
            verified: true
          };
        }
        return null;
      }
      function assetMarketAddress(asset) {
        var address = String(asset && (asset.contractAddress || asset.marketAddress || asset.address || asset.contractAddr) || "").toLowerCase();
        return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
      }
      function realChartUnavailable(asset, range, reason) {
        var sym = asset && asset.sym ? asset.sym : "token";
        return '<div class="market-detail-state">' + detailCopy("noChart") + ' ' + (range || "1D") + ' ' + detailCopy("chartData") + ' ' + detailCopy("forToken") + ' ' + sym + (reason ? '<br><span>' + reason + '</span>' : '') + '</div>';
      }
      function liveMarketSummary(asset, range, reason) {
        var market = marketForAsset(asset);
        if (!market || !market.priceUsd) return realChartUnavailable(asset, range, reason);
        var change = Number(market.change24h || 0);
        var changeClass = change >= 0 ? "up" : "down";
        return '<div class="market-detail-state live-market-summary">' +
          '<strong>' + detailCopy("liveData") + '</strong>' +
          '<span>' + (reason || detailCopy("noCandles")) + '</span>' +
          '<div class="market-stat-row"><span>' + detailCopy("price") + '</span><b>' + formatChartPrice(market.priceUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>' + detailCopy("change24h") + '</span><b class="' + changeClass + '">' + (change >= 0 ? "+" : "") + change.toFixed(2) + '%</b></div>' +
          '<div class="market-stat-row"><span>' + detailCopy("volume24h") + '</span><b>' + compactUsd(market.volume24hUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>' + detailCopy("liquidity") + '</span><b>' + compactUsd(market.liquidityUsd) + '</b></div>' +
          '</div>';
      }

      function renderMarketCard(asset) {
        var market = marketForAsset(asset);
        var chart = document.getElementById("detChart");
        if (!chart) return;
        if (!market || !market.liquidityUsd) {
          if (asset && !asset.__marketLookupStarted) {
            asset.__marketLookupStarted = true;
            chart.innerHTML = '<div class="market-detail-state">' + detailCopy("loadingMarket") + '</div>';
            var address = assetMarketAddress(asset);
            var lookupUrl = /^0x[a-fA-F0-9]{40}$/.test(address)
              ? "/api/market/token?address=" + encodeURIComponent(address) + "&symbol=" + encodeURIComponent(asset.sym || "")
              : "/api/tokens/top?mode=all";
            fetch(lookupUrl, { cache: "no-store" })
              .then(function(res){ return res.ok ? res.json() : []; })
              .then(function(payload){
                var markets = Array.isArray(payload) ? payload : (payload && payload.market ? [payload.market] : []);
                if (Array.isArray(markets)) markets.forEach(function(item){
                  if (window.__luminaRegisterMarketToken) window.__luminaRegisterMarketToken(item);
                  else if (typeof registerMarketToken === "function") registerMarketToken(item);
                });
                renderMarketTables(asset);
                updateDetailVerifyBadge(asset);
                renderMarketCard(asset);
              })
              .catch(function(){
                chart.innerHTML = realChartUnavailable(asset, "1D", detailCopy("lookupFailed"));
                updateRangeChange(null, "1D", asset);
              });
            return;
          }
          chart.innerHTML = realChartUnavailable(asset, "1D", detailCopy("noPool"));
          updateRangeChange(null, "1D", asset);
          return;
        }
        renderMarketChart(asset, "1D");
      }
      function renderMarketChart(asset, range) {
        var market = marketForAsset(asset);
        var chart = document.getElementById("detChart");
        if (!chart) return;
        var address = assetMarketAddress(asset);
        function renderHistory(reason){
          chart.innerHTML = '<div class="market-detail-state">' + detailCopy("loadingHistory") + '</div>';
          fetch("/api/market/history?symbol=" + encodeURIComponent(asset.sym) + "&address=" + encodeURIComponent(address || "") + "&range=" + encodeURIComponent(range || "1D"), { cache: "no-store" })
            .then(function(res){ return res.ok ? res.json() : { candles: [] }; })
            .then(function(data){
              var candles = Array.isArray(data.candles) ? data.candles : [];
              if (candles.length) {
                renderCandlesChart(chart, candles, range || "1D");
                updateRangeChange(candles, range || "1D", asset);
              } else {
                chart.innerHTML = liveMarketSummary(asset, range || "1D", reason || detailCopy("noHistory"));
                updateRangeChangeFromMarket(asset, range || "1D");
              }
            })
            .catch(function(){
              chart.innerHTML = liveMarketSummary(asset, range || "1D", reason || detailCopy("historyFailed"));
              updateRangeChangeFromMarket(asset, range || "1D");
            });
        }
        if (!market || !market.poolAddress) {
          renderHistory(detailCopy("noDexPool"));
          return;
        }
        chart.innerHTML = '<div class="market-detail-state">' + detailCopy("loadingChart") + '</div>';
        fetch("/api/market/ohlcv?pool=" + encodeURIComponent(market.poolAddress) + "&range=" + encodeURIComponent(range || "1D") + "&token=" + encodeURIComponent(address || market.address || ""), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : { candles: [] }; })
          .then(function(data){
            var candles = Array.isArray(data.candles) ? data.candles : [];
            if (candles.length) {
              renderCandlesChart(chart, candles, range || "1D");
              updateRangeChange(candles, range || "1D", asset);
            } else {
              renderHistory(detailCopy("emptyOhlcv"));
            }
          })
          .catch(function(){
            renderHistory(detailCopy("ohlcvFailed"));
          });
      }
      function updateRangeChange(candles, range, asset){
        var pill = document.getElementById("detChangePill");
        var label = document.getElementById("detChangeLabel");
        if (label) label.textContent = range;
        if (!pill) return;
        var change = null;
        if (candles && candles.length) {
          var first = candles[0];
          var last = candles[candles.length - 1];
          var start = Number(first.open || first[1] || first.close || first[4] || 0);
          var end = Number(last.close || last[4] || 0);
          if (start > 0 && Number.isFinite(end)) change = ((end - start) / start) * 100;
        }
        if (change === null || change === undefined || !Number.isFinite(Number(change))) {
          pill.className = "none";
          pill.textContent = detailCopy("noData");
          return;
        }
        var up = Number(change) >= 0;
        pill.className = up ? "up" : "down";
        pill.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="' + (up ? "M7 17L17 7M9 7h8v8" : "M7 7l10 10M17 9v8H9") + '"/></svg>' + (up ? "+" : "") + Number(change).toFixed(1) + "%";
      }
      function renderCandlesChart(chart, candles, range) {
        if (window.__luminaRenderLightweightChart && window.__luminaRenderLightweightChart(chart, candles, range || "1D")) return;
        chart.innerHTML = trendSvg(candles, range || "1D");
      }
      function updateRangeChangeFromMarket(asset, range) {
        var market = marketForAsset(asset);
        var pill = document.getElementById("detChangePill");
        var label = document.getElementById("detChangeLabel");
        if (label) label.textContent = range || "1D";
        if (!pill || !market || market.change24h === null || market.change24h === undefined) {
          updateRangeChange(null, range || "1D", asset);
          return;
        }
        var change = Number(market.change24h);
        if (!Number.isFinite(change)) {
          updateRangeChange(null, range || "1D", asset);
          return;
        }
        var up = change >= 0;
        pill.className = up ? "up" : "down";
        pill.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="' + (up ? "M7 17L17 7M9 7h8v8" : "M7 7l10 10M17 9v8H9") + '"/></svg>' + (up ? "+" : "") + change.toFixed(1) + "% (24h)";
      }
      function formatChartPrice(value){
        var n = Number(value || 0);
        if (!Number.isFinite(n) || n <= 0) return "$0";
        if (n >= 1) return "$" + n.toFixed(n >= 100 ? 0 : 2);
        if (n >= 0.01) return "$" + n.toFixed(4);
        return "$" + n.toPrecision(5);
      }
      function trendSvg(candles, range){
        if (!candles.length) return '<div class="market-detail-state">' + detailCopy("noChart") + ' ' + (range || "1D") + ' ' + detailCopy("chartData") + '</div>';
        var width = 430, height = 230, padL = 54, padR = 48, padT = 26, chartH = 132, volY = 174, volH = 24;
        var rows = candles.map(function(c){
          return {
            open: Number(c.open || c[1] || 0),
            high: Number(c.high || c[2] || 0),
            low: Number(c.low || c[3] || 0),
            close: Number(c.close || c[4] || 0),
            volume: Number(c.volume || c[5] || 0),
            timestamp: Number(c.timestamp || c[0] || 0)
          };
        }).filter(function(c){ return c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0; });
        if (rows.length < 2) return '<div class="market-detail-state">' + detailCopy("noChart") + ' ' + (range || "1D") + ' ' + detailCopy("chartData") + '</div>';
        var highs = rows.map(function(c){ return c.high; });
        var lows = rows.map(function(c){ return c.low; });
        var max = Math.max.apply(null, highs), min = Math.min.apply(null, lows);
        if (!Number.isFinite(max) || !Number.isFinite(min) || max <= min) return '<div class="market-detail-state">' + detailCopy("noChart") + ' ' + (range || "1D") + ' ' + detailCopy("chartData") + '</div>';
        var maxVol = Math.max.apply(null, rows.map(function(c){ return c.volume || 0; }).concat([1]));
        function y(v){ return padT + (max - v) / (max - min) * chartH; }
        function x(i){ return padL + (i / Math.max(1, rows.length - 1)) * (width - padL - padR); }
        var band = (width - padL - padR) / Math.max(8, rows.length);
        var bodyW = Math.max(2, Math.min(9, band * 0.56));
        var firstClose = rows[0].close;
        var lastClose = rows[rows.length - 1].close;
        var upTrend = lastClose >= firstClose;
        var trendColor = upTrend ? "#00c2a8" : "#ff4d5f";
        var candlesSvg = rows.map(function(c, i){
          var cx = x(i);
          var up = c.close >= c.open;
          var color = up ? "#00c2a8" : "#ff4d5f";
          var top = Math.min(y(c.open), y(c.close));
          var bottom = Math.max(y(c.open), y(c.close));
          var bodyH = Math.max(2, bottom - top);
          var volHeight = Math.max(1, (c.volume || 0) / maxVol * volH);
          return '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(c.high).toFixed(1) + '" y2="' + y(c.low).toFixed(1) + '" stroke="' + color + '" stroke-width="1.15"/>' +
            '<rect x="' + (cx - bodyW / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bodyW.toFixed(1) + '" height="' + bodyH.toFixed(1) + '" rx="0.8" fill="' + color + '"/>' +
            '<rect x="' + (cx - bodyW / 2).toFixed(1) + '" y="' + (volY + volH - volHeight).toFixed(1) + '" width="' + bodyW.toFixed(1) + '" height="' + volHeight.toFixed(1) + '" fill="' + color + '" opacity="0.52"/>';
        }).join("");
        var grid = [0,1,2,3].map(function(i){
          var gy = padT + (chartH / 3) * i;
          return '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + gy.toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
        });
        var lastX = width - padR + 5;
        var lastY = y(lastClose);
        return '<svg class="market-candles market-terminal" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
          '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="rgba(2,4,4,0.2)"/>' +
          '<text x="10" y="20" fill="#b6bdc8" font-size="10">Volume SMA</text>' +
          '<text x="82" y="20" fill="' + trendColor + '" font-size="10">' + rows.length + '</text>' +
          grid.join("") +
          '<line x1="' + padL + '" y1="' + lastY.toFixed(1) + '" x2="' + (width - padR) + '" y2="' + lastY.toFixed(1) + '" stroke="' + trendColor + '" stroke-dasharray="2 3" opacity="0.7"/>' +
          candlesSvg +
          '<text x="8" y="' + (padT + 4) + '" text-anchor="start" fill="#a9b0b8" font-size="11">' + formatChartPrice(max) + '</text>' +
          '<text x="8" y="' + (padT + chartH + 3) + '" text-anchor="start" fill="#7b828c" font-size="11">' + formatChartPrice(min) + '</text>' +
          '<rect x="' + lastX.toFixed(1) + '" y="' + (lastY - 10).toFixed(1) + '" width="70" height="20" rx="5" fill="' + trendColor + '"/>' +
          '<text x="' + (lastX + 35).toFixed(1) + '" y="' + (lastY + 4).toFixed(1) + '" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">' + formatChartPrice(lastClose).replace("$","") + '</text>' +
          '<text x="26" y="218" fill="#9da3ad" font-size="13">' + (range === "1H" ? "5m" : range === "1D" ? "1h" : range === "1W" ? "4h" : "1d") + '</text>' +
          '<text x="188" y="218" fill="#9da3ad" font-size="13">' + (range || "1D") + '</text>' +
          '<text x="342" y="218" fill="#9da3ad" font-size="13">auto</text>' +
          '</svg>';
      }
      function shortAddr(value){
        value = String(value || "");
        return value.length > 12 ? value.slice(0, 6) + "..." + value.slice(-4) : value;
      }
      function tradeRows(trades, asset){
        if (!trades || !trades.length) return '<div class="detail-empty-row">' + detailCopy("noSwaps") + '</div>';
        return trades.slice(0, 8).map(function(t){
          var side = t.side === "sell" ? "sell" : "buy";
          var amount = t.amount ? Number(t.amount).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + asset.sym : "—";
          var usd = t.amountUsd ? compactUsd(t.amountUsd) : (t.priceUsd ? formatChartPrice(t.priceUsd) : "—");
          var time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          var hash = t.hash ? String(t.hash) : "";
          var open = hash ? ' onclick="window.open(\\'https://worldscan.org/tx/' + hash + '\\', \\'_blank\\')"' : "";
          return '<div class="detail-trade-row"' + open + '><span class="trade-side ' + side + '">' + (side === "buy" ? detailCopy("buy") : detailCopy("sell")) + '</span><span class="trade-main"><b>' + amount + '</b><em>' + time + ' · ' + shortAddr(t.maker) + '</em></span><span class="trade-usd">' + usd + '</span></div>';
        }).join("");
      }
      function renderMarketTables(asset) {
        var tradesBox = document.getElementById("detTrades");
        if (!tradesBox) return;
        var market = marketForAsset(asset);
        if (!market || !market.poolAddress || !market.address) {
          tradesBox.innerHTML = '<div class="detail-empty-row">' + detailCopy("marketPairUnavailable") + '</div>';
          return;
        }
        tradesBox.innerHTML = '<div class="detail-empty-row">' + detailCopy("loadingTrades") + '</div>';
        fetch("/api/market/token-detail?pool=" + encodeURIComponent(market.poolAddress) + "&token=" + encodeURIComponent(market.address), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : { trades: [], holders: [] }; })
          .then(function(data){
            tradesBox.innerHTML = tradeRows(Array.isArray(data.trades) ? data.trades : [], asset);
          })
          .catch(function(){
            tradesBox.innerHTML = '<div class="detail-empty-row">' + detailCopy("tradesFailed") + '</div>';
          });
      }
      window.openPoolInfo = function(){
        var asset = assets && assets[currentDetailIdx] ? assets[currentDetailIdx] : null;
        var market = asset ? marketForAsset(asset) : null;
        if (!market) { toast("暂无 pool 信息"); return; }
        var modal = document.getElementById("poolInfoModal");
        if (!modal) {
          modal = document.createElement("div");
          modal.id = "poolInfoModal";
          modal.className = "pool-info-modal";
          document.body.appendChild(modal);
        }
        modal.innerHTML =
          '<div class="pool-info-sheet"><button class="pool-close" onclick="document.getElementById(\\'poolInfoModal\\').classList.remove(\\'open\\')">×</button><strong>World Chain pool</strong>' +
          '<div class="market-stat-row"><span>' + detailCopy("volume24h") + '</span><b>' + compactUsd(market.volume24hUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>' + detailCopy("liquidity") + '</span><b>' + compactUsd(market.liquidityUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>Token contract</span><b>' + String(market.address || "").slice(0, 6) + "..." + String(market.address || "").slice(-4) + '</b></div>' +
          '<div class="market-stat-row"><span>Pool address</span><b>' + String(market.poolAddress || "").slice(0, 6) + "..." + String(market.poolAddress || "").slice(-4) + '</b></div>' +
          '</div>';
        modal.classList.add("open");
      }
      window.goSwapFromDetail = function(){
        var asset = assets && assets[currentDetailIdx] ? assets[currentDetailIdx] : null;
        if (asset && typeof swapState !== "undefined") {
          swapState.sell = asset.sym;
          if (asset.sym !== "WLD") swapState.buy = "WLD";
          else if (swapState.buy === asset.sym) swapState.buy = "USDC";
          if (typeof refreshSwapLabels === "function") refreshSwapLabels();
        }
        go("swap");
        setTabByName("Swap");
      }
      function activeDetailReturnView(){
        try {
          var active = document.querySelector(".view.active");
          var id = active && active.id ? String(active.id).replace(/^view-/, "") : "";
          if (id && id !== "detail") return id;
        } catch(e) {}
        return window.__luminaDetailReturnView || "home";
      }
      function detailReturnTab(view){
        if (view === "swap") return "Swap";
        if (view === "activity") return "Activity";
        if (view === "earn" || view === "earn-detail") return "Earn";
        if (view === "me") return "Me";
        return "Home";
      }
      window.__luminaBackFromDetail = function(){
        var view = window.__luminaDetailReturnView || "home";
        go(view);
        setTabByName(detailReturnTab(view));
      };

      function ensureDetailShell() {
        var view = document.getElementById("view-detail");
        if (!view || view.dataset.luminaDetailV2 === "1") return;
        view.dataset.luminaDetailV2 = "1";
        view.innerHTML =
          '<div class="detail-v2-topbar">' +
            '<button class="detail-v2-back" onclick="window.__luminaBackFromDetail && window.__luminaBackFromDetail()" aria-label="Back"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>' +
            '<div class="detail-v2-token"><div class="detail-v2-token-icon" id="detCoin">◉</div><div><div class="detail-v2-symbol" id="detTitle">WLD</div><div class="detail-v2-name" id="detName">Worldcoin</div></div></div>' +
            '<div class="detail-v2-tools"><button type="button" onclick="openPoolInfo()">' + detailIcon("more") + '</button></div>' +
          '</div>' +
          '<section class="detail-v2-hero">' +
            '<div class="detail-v2-amount" id="detAmt">0 WLD</div>' +
            '<div class="detail-v2-fiat" id="detUsd">≈ $0.00</div>' +
            '<div class="detail-v2-change"><span id="detChangePill">+0.00%</span><em id="detChangeLabel">1D</em><b id="detVerifyBadge" class="detail-verify-badge warn">未验证</b></div>' +
          '</section>' +
          '<section class="detail-v2-chart-card">' +
            '<div class="detail-chart" id="detChart"></div>' +
            '<div class="range-row detail-v2-ranges"><div class="range">1H</div><div class="range sel">1D</div><div class="range">1W</div><div class="range">1Y</div><div class="range">ALL</div></div>' +
          '</section>' +
          '<div class="detail-actions detail-v2-actions">' +
            '<button class="btn-ghost detail-action-receive" onclick="window.__luminaOpenReceive && window.__luminaOpenReceive()"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v15"/><path d="M6 12l6 6 6-6"/><path d="M5 21h14"/></svg>' + detailCopy("receive") + '</button>' +
            '<button class="btn-ghost detail-action-swap" onclick="goSwapFromDetail()"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>' + detailCopy("swap") + '</button>' +
            '<button class="btn-primary detail-action-send" onclick="goSend(assets[currentDetailIdx].sym)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V6"/><path d="M6 12l6-6 6 6"/></svg>' + detailCopy("send") + '</button>' +
          '</div>' +
          '<section class="detail-market-panels">' +
            '<div class="detail-market-card"><div class="detail-market-title"><span>' + detailCopy("trades") + '</span><em>' + detailCopy("livePool") + '</em></div><div id="detTrades"></div></div>' +
          '</section>' +
          '<section class="detail-v2-menu">' +
            '<button type="button" onclick="go(\\'activity\\'); setTabByName(\\'Activity\\')"><span>' + detailIcon("activity") + '</span><strong>' + detailCopy("recentActivity") + '</strong><i>›</i></button>' +
            '<a id="detExplorer" target="_blank" rel="noreferrer"><span>' + detailIcon("globe") + '</span><strong>' + detailCopy("viewExplorer") + '</strong><i>›</i></a>' +
          '</section>';
      }

      function renderRange(range) {
        ensureDetailShell();
        var asset = assets && assets[currentDetailIdx] ? assets[currentDetailIdx] : null;
        if (asset) {
          renderMarketChart(asset, range);
          document.querySelectorAll("#view-detail .range").forEach(function(el) {
            el.classList.toggle("sel", el.textContent.trim() === range);
            el.onclick = function(){ renderRange(el.textContent.trim()); };
          });
          return;
        }
        var chart = document.getElementById("detChart");
        if (chart) chart.innerHTML = chartSvg(range);
        document.querySelectorAll("#view-detail .range").forEach(function(el) {
          el.classList.toggle("sel", el.textContent.trim() === range);
          el.onclick = function(){ renderRange(el.textContent.trim()); };
        });
      }

      function updateExplorer() {
        ensureDetailShell();
        var link = document.getElementById("detExplorer");
        if (!link) return;
        var sym = "";
        try {
          sym = assets && assets[currentDetailIdx] ? assets[currentDetailIdx].sym : "";
        } catch(e) {}
        var contract = contracts[sym];
        if (contract) {
          link.href = "https://worldscan.org/token/" + contract;
          return;
        }
        var address = window.__luminaUserAddress || "";
        link.href = address ? "https://worldscan.org/address/" + address : "https://worldscan.org";
      }

      function formatFiat(value) {
        try { return formatMoney(value || 0); } catch(e) { return "$" + Number(value || 0).toFixed(2); }
      }

      function updateDetailContent(asset) {
        ensureDetailShell();
        var coin = document.getElementById("detCoin");
        coin.innerHTML = detailTokenIcon(asset);
        coin.className = "detail-v2-token-icon coin " + (asset.cls || "custom");
        document.getElementById("detTitle").textContent = asset.sym;
        document.getElementById("detName").textContent = asset.full || asset.sym;
        document.getElementById("detAmt").textContent = asset.amt || ("0 " + asset.sym);
        document.getElementById("detUsd").textContent = "≈ " + formatFiat(asset.usdNum || 0);
        var pill = document.getElementById("detChangePill");
        renderMarketTables(asset);
        updateDetailVerifyBadge(asset);
        pill.className = "none";
        pill.textContent = detailCopy("noData");
        renderMarketCard(asset);
      }

      var previousOpenDetail = typeof openDetail === "function" ? openDetail : null;
      if (previousOpenDetail) {
        openDetail = function(index) {
          window.__luminaDetailReturnView = activeDetailReturnView();
          currentDetailIdx = index;
          var asset = assets[index];
          if (!asset) return;
          go("detail"); setTabByName(detailReturnTab(window.__luminaDetailReturnView));
          try {
            updateDetailContent(asset);
            renderRange("1D");
            updateExplorer();
          } catch(e) {
            try {
              ensureDetailShell();
              document.getElementById("detTitle").textContent = asset.sym;
              document.getElementById("detName").textContent = asset.full || asset.sym;
              document.getElementById("detAmt").textContent = asset.amt || ("0 " + asset.sym);
              document.getElementById("detUsd").textContent = "≈ " + formatFiat(asset.usdNum || 0);
              var chart = document.getElementById("detChart");
              if (chart) chart.innerHTML = '<div class="market-detail-state">' + detailCopy("noData") + '</div>';
            } catch(inner) {}
            try { console.error("[DETAIL] openDetail failed", e); } catch(logErr) {}
          }
          setTimeout(function(){
            try {
              if (window.__luminaHomeDebug && typeof window.__luminaSetHomeDebug === "function") {
                window.__luminaSetHomeDebug("openDetail:after", {
                  index:index,
                  symbol:asset && asset.sym,
                  activeViews:Array.from(document.querySelectorAll(".view.active")).map(function(view){ return view.id; })
                });
              }
            } catch(e) {}
          }, 0);
        };
      }

      if (!window.__luminaDetailRangeBound) {
        window.__luminaDetailRangeBound = true;
        document.addEventListener("click", function(event) {
          var target = event.target && event.target.closest ? event.target.closest("#view-detail .range") : null;
          if (!target) return;
          event.preventDefault();
          renderRange(target.textContent.trim());
        }, true);
      }

      ensureDetailShell();
      renderRange("1D");
      updateExplorer();
    })();
  `;
  document.body.appendChild(scriptEl);
  scriptEl.remove();
}

function runInPrototypeScope(source: string, errorLabel: string) {
  const script = document.createElement("script");
  script.text = `try { ${source} } catch (error) { console.error(${JSON.stringify(errorLabel)}, error); }`;
  document.body.appendChild(script);
  script.remove();
}
