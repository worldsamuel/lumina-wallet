"use client";

import { useEffect, useRef, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { useSWRConfig } from "swr";
import { prototypeMarkup } from "./prototype-markup";
import { prototypeScript } from "./prototype-script";
import { shortenAddress } from "@/lib/auth/store";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";
import { useBackendConfigSync } from "@/lib/backend/use-backend-config";
import { useChainBalanceSync } from "@/lib/chain/use-chain-balance-sync";
import { legalContent, type LegalPageKind } from "@/lib/legal-content";
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
    ) => Promise<unknown>;
    __luminaSendToken?: (params: SendParams) => Promise<SendResult>;
    __luminaFriendlySendError?: (error?: string) => string;
    __luminaRefreshWalletData?: () => void;
    __luminaRefreshActivity?: () => void;
    __luminaRefreshImportedTokens?: () => void;
    __luminaOpenLegal?: (kind: LegalPageKind) => void;
    __luminaCloseLegal?: () => void;
    __luminaOpenReceive?: () => void;
    __luminaTxToastTimer?: ReturnType<typeof setTimeout>;
    eruda?: { init: () => void };
    __luminaErudaInstalled?: boolean;
  }
}

type EarnConfirmInput = {
  action: "deposit" | "withdraw";
  amount: string;
  product: string;
};

type MiniKitCalldataTransaction = {
  address: string;
  abi: readonly unknown[];
  functionName: string;
  args: string[];
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
    transactionHash?: string;
    transaction_id?: string;
    transactionId?: string;
    error_code?: string;
    message?: string;
  };
  status?: string;
  userOpHash?: string;
  transactionHash?: string;
  transaction_id?: string;
  transactionId?: string;
  error_code?: string;
  message?: string;
};

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
  const { address, error, login, logout, status, username } = useWalletAuth();
  const { mutate } = useSWRConfig();
  useBackendConfigSync(status === "authenticated" && dataSyncReady);
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

  if (status === "not-installed") {
    return <WorldAppPrompt />;
  }

  if (status === "checking" || status === "authenticating") {
    return <AuthLoading />;
  }

  if (status === "error") {
    return <AuthError message={error ?? "Wallet authentication failed."} onRetry={login} />;
  }

  return <div ref={hostRef} />;
}

function installMobileConsole() {
  if (typeof window === "undefined" || window.__luminaErudaInstalled) return;
  const debugAllowed =
    process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true" ||
    new URLSearchParams(window.location.search).get("debug") === "eruda";
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
  window.__luminaSendMorphoTransactions = async (transactions, permit2) => {
    if (new URL(window.location.href).searchParams.get("mockWorld") === "1") {
      return { userOpHash: `0xmock${Date.now().toString(16)}` };
    }

    const miniKit = MiniKit as unknown as {
      sendTransaction?: (input: {
        chainId?: number;
        transactions?: MiniKitCalldataTransaction[];
        permit2?: MiniKitPermit2[];
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
          ...(permit2 && permit2.length ? { permit2 } : {}),
        },
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );
    const startTime = Date.now();
    const txPromise = miniKit.sendTransaction({
      chainId: 480,
      transactions,
      ...(permit2 && permit2.length ? { permit2 } : {}),
    });
    const timeoutPromise = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("EARN_TIMEOUT_20S")), 20000),
    );
    let result: MiniKitSendTransactionEnvelope;
    try {
      result = (await Promise.race([txPromise, timeoutPromise])) as MiniKitSendTransactionEnvelope;
      const debugResult = result as MiniKitSendTransactionEnvelope & {
        finalPayload?: {
          status?: unknown;
          error_code?: unknown;
          transaction_id?: unknown;
        };
      };
      console.log("[EARN A2] returned after", Date.now() - startTime, "ms");
      console.log("[EARN A2] result full:", JSON.stringify(result, null, 2));
      console.log("[EARN A2] result.finalPayload:", debugResult?.finalPayload);
      console.log("[EARN A2] result.finalPayload.status:", debugResult?.finalPayload?.status);
      console.log("[EARN A2] result.finalPayload.error_code:", debugResult?.finalPayload?.error_code);
      console.log("[EARN A2] result.finalPayload.transaction_id:", debugResult?.finalPayload?.transaction_id);
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

    const payload = result?.data ?? result;
    if (payload?.status && payload.status !== "success") {
      throw new Error(payload.error_code || payload.message || "Transaction was not submitted.");
    }
    if (payload?.error_code) throw new Error(payload.error_code);
    return result;
  };
}

function exposeTokenTransfer(
  address: string | null,
  mutate: ReturnType<typeof useSWRConfig>["mutate"],
) {
  window.__luminaFriendlySendError = friendlySendError;
  window.__luminaSendToken = async (params) => sendToken(params);
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
      { sym: "WLD", full: "Worldcoin", amt: "0 WLD", usdNum: 0, cls: "wld", logo: "W" },
      { sym: "USDC", full: "USD Coin", amt: "0 USDC", usdNum: 0, cls: "usdc", logo: "$" },
      { sym: "USDT", full: "Tether USD", amt: "0 USDT", usdNum: 0, cls: "usdt", logo: "$" },
      { sym: "ETH", full: "Ether", amt: "0 ETH", usdNum: 0, cls: "eth", logo: "E" },
      { sym: "BTC", full: "Bitcoin", amt: "0 BTC", usdNum: 0, cls: "btc", logo: "B", marketOnly: true }
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
        ETH: "0x4200000000000000000000000000000000000006"
      };
      var logoUrlsBySymbol = {};
      function htmlEscape(value){
        return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      }
      function initial(symbol){
        return String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
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
        return "<img class=\\"lumina-token-img\\" src=\\"" + htmlEscape(url) + "\\" alt=\\"" + htmlEscape(sym) + " logo\\" loading=\\"eager\\" decoding=\\"async\\" fetchpriority=\\"high\\" data-fallback=\\"" + htmlEscape(fallback) + "\\" data-initial=\\"" + htmlEscape(initial(sym)) + "\\" onerror=\\"if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.outerHTML=this.dataset.initial||'';}\\"/>";
      }
      function builtinLogo(symbol){
        var sym = String(symbol || "").toUpperCase();
        var cryptologos = {
          WLD: "https://cryptologos.cc/logos/worldcoin-org-wld-logo.svg",
          USDT: "https://cryptologos.cc/logos/tether-usdt-logo.svg",
          USDC: "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg",
          ETH: "https://cryptologos.cc/logos/ethereum-eth-logo.svg",
          BTC: "https://cryptologos.cc/logos/bitcoin-btc-logo.svg",
          WBTC: "https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.svg"
        };
        if (cryptologos[sym]) return logoImg(sym, cryptologos[sym], "");
        return "";
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
        var builtin = builtinLogo(sym);
        if (builtin) return builtin;
        var configured = logoUrlsBySymbol[sym];
        if (configured) return logoImg(sym, configured, ethTrustLogoUrl(sym));
        var trusted = trustedLogoUrl(sym);
        if (trusted) return logoImg(sym, trusted, ethTrustLogoUrl(sym));
        var fb = String(fallback || "");
        if (fb.indexOf("<img") >= 0) return fb;
        return initial(sym);
      };
      window.__luminaRefreshTokenLogos = function(){
        readLogoConfig();
        tokenLogo.WLD = window.__luminaTokenLogoHtml("WLD", "");
        tokenLogo.USDC = window.__luminaTokenLogoHtml("USDC", "");
        tokenLogo.USDT = window.__luminaTokenLogoHtml("USDT", "");
        tokenLogo.ETH = window.__luminaTokenLogoHtml("ETH", "");
        tokenLogo.BTC = window.__luminaTokenLogoHtml("BTC", "");
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
        renderTokenList = function(filter){
          filter = (filter || "").toLowerCase();
          var rows = Object.keys(prices).filter(function(sym){
            if (!filter) return true;
            return sym.toLowerCase().indexOf(filter) >= 0 || (tokenFull[sym]||"").toLowerCase().indexOf(filter) >= 0;
          }).map(function(sym){
            var badge = customTokens[sym] ? '<span class="custom-badge">已导入</span>' : '';
            var color = sym === "WLD" ? "#000" : "#fff";
            return '<div class="tk-row" onclick="pickToken(\\'' + sym + '\\')"><div class="ic coin ' + String(sym).toLowerCase() + '" style="background:' + (dotColor[sym] || "var(--surface-2)") + ';color:' + color + '">' + window.__luminaTokenLogoHtml(sym, tokenLogo[sym]) + '</div><div class="mid"><div class="s">' + sym + badge + '</div><div class="f">' + (tokenFull[sym] || sym) + '</div></div><div class="bal">' + (balances[sym] || "0") + '</div></div>';
          }).join('');
          document.getElementById("tokenModalList").innerHTML = rows || '<div class="import-load">没有匹配的代币</div>';
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
      };

      window.showMorphoApyInfo = function(){
        toast("APY 含 Morpho 协议奖励,每日变动");
      };

      function setMorphoBusy(isBusy){
        ["morphoDepositBtn"].forEach(function(id){
          var btn = document.getElementById(id);
          if (!btn) return;
          btn.disabled = !!isBusy;
          btn.textContent = isBusy ? "Submitting..." : "Deposit";
        });
      }

      function confirmMorphoDeposit(message){
        return new Promise(function(resolve){
          var old = document.getElementById("morphoConfirmMask");
          if (old) old.remove();
          var mask = document.createElement("div");
          mask.className = "modal-mask open morpho-confirm-modal";
          mask.id = "morphoConfirmMask";
          mask.innerHTML =
            '<div class="modal"><div class="modal-grip"></div><h3>确认存款</h3>' +
            '<p class="morpho-confirm-body">' + message + '</p>' +
            '<div class="earn-action-row"><button class="btn-ghost" id="morphoConfirmCancel">取消</button><button class="btn-primary" id="morphoConfirmOk">确认存入</button></div></div>';
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
        var lang = window.currentLang || "en";
        var copy = lang === "zh-CN" ? {
          deposited: "已存入 ",
          amount: "金额",
          wallet: "钱包余额",
          yearly: "预计年收益",
          daily: "预计日收益",
          fee: "费用",
          provider: "服务提供方",
          curator: "Re7 Labs (Vault 策展方)",
          deposit: "存入",
          withdraw: "提现",
          pausedTitle: "存款已暂停",
          pausedBody: "紧急暂停已开启。已有仓位仍可提现。",
          aboutTitle: "ⓘ 关于本产品",
          aboutBody: "本理财服务由 Morpho 协议(morpho.org)提供,Re7 Labs 担任策展方。Lumina 仅作为第三方钱包入口,不托管您的资产。您的资产存入 Morpho Vault 智能合约,通过借贷市场赚取利息。智能合约已经 Spearbit、OpenZeppelin 审计,但任何 DeFi 都存在技术风险(智能合约漏洞、价格预言机故障等)。APY 实时变动,不保证收益。您可随时提现,但 vault 流动性不足时需要等待。"
        } : {
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
        if (pos && Number(pos.walletBalanceFormatted || 0) < n) return toast("先获取 " + vault.asset.symbol);
        var apy = vault.liveData ? fmtPct(vault.liveData.netApy) : "—";
        var confirmed = await confirmMorphoDeposit("您将存入 " + amount + " " + vault.asset.symbol + " 到 " + vault.displayName + " Vault,当前 APY " + apy);
        if (!confirmed) return;
        try {
          setMorphoBusy(true);
          var res = await fetch("/api/morpho/tx", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "deposit", vaultAddress: vault.address, amount: amount, userAddress: window.__luminaUserAddress || "" })
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || "Unable to build transaction");
          console.log("[EARN] built tx:", JSON.stringify(data));
          var result = await window.__luminaSendMorphoTransactions(data.transactions, data.permit2);
          var payload = result && (result.data || result);
          var hash = (payload && (payload.userOpHash || payload.transactionHash || payload.transaction_id || payload.transactionId)) || "submitted";
          toast("Transaction submitted: " + String(hash).slice(0, 18));
          pollMorphoPositions();
        } catch(e) {
          console.error("[EARN] error:", e);
          var msg = e && e.message ? e.message : "Deposit failed";
          if (/user_rejected/i.test(msg)) msg = "Cancelled in World App";
          toast("存款失败: " + msg);
        } finally {
          setMorphoBusy(false);
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
        mask.innerHTML =
          '<div class="modal"><div class="grab"></div><h3>Withdraw ' + vault.displayName + '</h3>' +
          '<p class="hint">Available: ' + fmtAmount(pos.maxWithdrawFormatted, 6) + " " + vault.asset.symbol + '</p>' +
          '<div class="earn-amount-row"><input id="morphoWithdrawAmount" inputmode="decimal" placeholder="0.00" /><span>' + vault.asset.symbol + '</span></div>' +
          '<div class="earn-action-row"><button class="btn-primary" onclick="submitMorphoWithdraw(false)">Withdraw amount</button><button class="btn-ghost" onclick="submitMorphoWithdraw(true)">Withdraw all</button></div>' +
          '<button class="sheet-cancel" onclick="closeMorphoWithdrawModal()">Cancel</button></div>';
        document.body.appendChild(mask);
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
          if (n > Number(pos.maxWithdrawFormatted || 0)) return toast("Vault 流动性暂时不足,请稍后再试或减少金额");
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
          var result = await window.__luminaSendMorphoTransactions(data.transactions);
          var payload = result && (result.data || result);
          var hash = (payload && (payload.userOpHash || payload.transactionHash || payload.transaction_id || payload.transactionId)) || "submitted";
          closeMorphoWithdrawModal();
          toast("Transaction submitted: " + String(hash).slice(0, 18));
          pollMorphoPositions();
        } catch(e) {
          var msg = e && e.message ? e.message : "Withdraw failed";
          if (/liquid|withdraw/i.test(msg)) msg = "Vault 流动性暂时不足,请稍后再试或减少金额";
          toast(msg);
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
      async function loadMorphoPositions(){
        var address = window.__luminaUserAddress || "";
        if (!address) { morphoPositions = []; return; }
        var res = await fetch("/api/morpho/position/" + address, { cache: "no-store" });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load positions");
        morphoPositions = Array.isArray(data.positions) ? data.positions : [];
      }
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
            await loadMorphoPositions();
            renderProducts();
            if (document.getElementById("view-earn-detail").classList.contains("active")) openEarn(activeEarnIndex);
          } catch(e) {}
          if (tries >= 6) clearInterval(timer);
        }, 5000);
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
        morphoLoading = false;
        updateEarnHero();
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
        if (!cfg.maintenance) {
          if (existing) existing.remove();
          return;
        }
        if (existing) return;
        var overlay = document.createElement("div");
        overlay.id = "luminaMaintenanceOverlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:#030503;display:flex;align-items:center;justify-content:center;padding:28px;color:#fff;text-align:center;";
        overlay.innerHTML = '<div style="max-width:320px;"><div style="width:74px;height:74px;margin:0 auto 22px;border-radius:50%;border:2px solid #6ee787;display:flex;align-items:center;justify-content:center;color:#6ee787;font-size:34px;font-weight:900;box-shadow:0 0 40px rgba(74,222,128,.22);">L</div><h1 style="font-size:30px;line-height:1.05;margin:0 0 12px;font-weight:950;">Lumina is under maintenance</h1><p style="margin:0;color:#9ca39c;font-size:15px;line-height:1.55;">We are updating the service. Please check back shortly.</p></div>';
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
        return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
      }
      function importedList(){
        var list = readJson(importStoreKey, []);
        return Array.isArray(list) ? list : [];
      }
      function hiddenSet(){
        var list = readJson(hiddenStoreKey, []);
        return new Set(Array.isArray(list) ? list.map(function(x){ return String(x).toLowerCase(); }) : []);
      }
      function saveImported(token){
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

      showImportPreview = async function(addr){
        var owner = window.__luminaUserAddress || "";
        var preview = document.getElementById("importPreview");
        preview.innerHTML = '<div class="import-load">Reading token contract...</div>';
        try {
          var res = await fetch("/api/token-info?address=" + encodeURIComponent(addr) + "&owner=" + encodeURIComponent(owner), { cache: "no-store" });
          var token = await res.json();
          if (!res.ok) throw new Error(token.error || "Unable to read token");
          var score = token.risk && token.risk.score ? token.risk.score : "mid";
          var needAck = score !== "low";
          var btnAttr = needAck ? ' disabled id="impBtn"' : ' id="impBtn"';
          var ackHtml = needAck
            ? '<div class="ack" id="impAck" onclick="toggleImpAck()"><span class="box"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#042" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span><span>This token is not verified. Importing it may expose you to honeypot, high-tax, fake-token, or no-liquidity risk.</span></div>'
            : "";
          preview.innerHTML =
            '<div class="import-card">' +
              '<div class="hd">' +
                '<div class="ic token-initial">' + tokenInitial(token.symbol) + '</div>' +
                '<div class="mid"><div class="s">' + token.symbol + '</div><div class="f">' + token.name + ' · Balance ' + formatImportedAmount(token.formatted) + '</div></div>' +
              '</div>' +
              '<div class="addr">' + token.address + '</div>' +
              '<div class="scan-rows">' + renderScanRows(token.risk) + '</div>' +
              '<div class="risk-score ' + riskClass(score) + '"><span class="big">' + riskLabel(score) + '</span><span class="txt">Risk affects display and swap/send protection. High-risk tokens are hidden from Home and shown in View All.</span></div>' +
              ackHtml +
              '<button class="btn"' + btnAttr + ' onclick="doImportFromInfo()">' + (needAck ? "Import anyway" : "Import") + ' ' + token.symbol + '</button>' +
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
        go("home");
        setTabByName("Home");
      };

      doImport = function(sym, addr, score){
        showImportPreview(addr);
      };

      function assetIconHtml(symbol, className, logo) {
        return '<div class="coin ' + (className || "custom") + '">' + (logo || tokenInitial(symbol)) + '</div>';
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
        var verifiedRows = (assets || []).map(function(a, i){
          return '<div class="asset all-asset-row" onclick="openDetail(' + i + ')">' +
            assetIconHtml(a.sym, a.cls, a.logo) +
            '<div class="name"><div class="sym">' + a.sym + ' <span class="asset-risk low">Verified</span></div><div class="full">' + a.full + '</div></div>' +
            '<div></div><div class="vals"><div class="amt">' + a.amt + '</div><div class="usd">' + formatMoney(a.usdNum || 0) + '</div></div></div>';
        });
        var importedRows = importedList().map(function(token){
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

      restoreImportedTokens();
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
      function fixSignedMoney(){
        if (!window.__luminaHomeMoneyFix && typeof formatMoney === "function") {
          window.__luminaHomeMoneyFix = true;
          var rawFormatMoney = formatMoney;
          formatMoney = function(usd){
            var n = Number(usd);
            if (!Number.isFinite(n)) return rawFormatMoney(usd);
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
          };
        }
      }
      function ensureHomeShell() {
        fixSignedMoney();
        var home = document.getElementById("view-home");
        if (!home || home.dataset.luminaHomeV2 === "1") return;
        home.dataset.luminaHomeV2 = "1";
        var balanceCard = home.querySelector(".balance-card");
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
      function rowHtml(asset, index, imported){
        var open = imported ? 'openImportedTokenHome(\\'' + asset.sym + '\\')' : 'openDetail(' + index + ')';
        var logoHtml = window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(asset.sym, asset.logo || tokenInitialHome(asset.sym)) : (asset.logo || tokenInitialHome(asset.sym));
        return '<div class="asset home-v2-asset" onclick="' + open + '">' +
          '<div class="coin ' + (asset.cls || "custom") + '">' + logoHtml + '</div>' +
          '<div class="name"><div class="sym">' + asset.sym + '</div><div class="full">' + asset.full + '</div></div>' +
          '<div class="vals"><div class="amt">' + asset.amt + '</div><div class="usd">' + (typeof formatMoney === "function" ? formatMoney(asset.usdNum) : "—") + '</div></div>' +
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
          return !a.custom && (!filter || (a.sym + " " + a.full).toLowerCase().indexOf(filter) >= 0);
        });
        var html = verified.map(function(a, i){ return rowHtml(a, i, false); }).join("");
        html += importedHomeRows(filter).map(function(a){ return rowHtml(a, 0, true); }).join("");
        html += '<button class="home-add-token-row" type="button" onclick="openTokenModal(\\'buy\\')"><span>＋</span> Add Token</button>';
        list.innerHTML = html || '<div class="article-empty">No assets detected yet</div>';
      };
      ensureHomeShell();
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
      function worldLogo(){
        return '<svg class="wld-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M5 16h22M16 5c5 5.5 5 16.5 0 22M16 5c-5 5.5-5 16.5 0 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
      }
      function iconFor(symbol, fallback){
        if (window.__luminaTokenLogoHtml) return window.__luminaTokenLogoHtml(symbol, fallback);
        if (String(symbol).toUpperCase() === "WLD") return worldLogo();
        return fallback || String(symbol || "?").slice(0, 3).toUpperCase();
      }
      function coinHtml(asset){
        return '<div class="coin ' + (asset.cls || "custom") + '">' + iconFor(asset.sym, asset.logo) + '</div>';
      }
      function moneyCompact(value){
        var n = Number(value || 0);
        if (!Number.isFinite(n)) return "$0";
        if (n >= 1000000) return "$" + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
        if (n >= 1000) return "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
        return "$" + n.toFixed(0);
      }
      function formatMarketPrice(value){
        var n = Number(value || 0);
        if (!n) return "No price";
        if (n < 0.0001) return "$" + n.toExponential(2);
        if (n < 1) return "$" + n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
        return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 4 });
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
          if (["WLD","USDC","USDT","ETH","BTC"].indexOf(asset.sym) >= 0) asset.logo = iconFor(asset.sym, asset.logo);
        });
      }
      function registerMarketToken(market){
        var sym = market.symbol;
        if (market.logoUrl && window.__luminaSetTokenLogoUrl) window.__luminaSetTokenLogoUrl(sym, market.logoUrl);
        prices[sym] = market.priceUsd || 0;
        dotColor[sym] = sym === "WLD" ? "#fff" : "linear-gradient(135deg,#1b231e,#26362b)";
        tokenFull[sym] = market.name || sym;
        tokenLogo[sym] = iconFor(sym, tokenLogo[sym] || market.symbol);
        tokenChanges24h = tokenChanges24h || {};
        tokenChanges24h[sym] = market.change24h;
        window.__luminaMarketBySymbol[sym] = market;
        if (balances[sym] === undefined) balances[sym] = "0";
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
            marketChange24h: market.change24h
          });
        }
        openDetail(idx);
      }
      window.openMarketDetail = openMarketDetail;
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
          registerMarketToken(g);
          var rankCls = i < 3 ? "rank top" : "rank";
          var bg = g.symbol === "WLD" ? "#fff" : "linear-gradient(135deg,#1b231e,#26362b)";
          var color = g.symbol === "WLD" ? "#000" : "#fff";
          var pctClass = Number(g.change24h || 0) >= 0 ? "pct" : "pct down";
          var routeBadge = ["WLD","USDC","USDT","ETH","BTC"].indexOf(String(g.symbol || "").toUpperCase()) >= 0 ? "" : '<span class="market-route-badge">Market only</span>';
          return '<div class="gainer" onclick="openMarketDetail(\\'' + g.symbol + '\\')">' +
            '<div class="' + rankCls + '">' + (i + 1) + '</div>' +
            '<div class="ic" style="background:' + bg + ';color:' + color + '">' + iconFor(g.symbol, g.symbol.slice(0, 3)) + '</div>' +
            '<div class="mid"><div class="s">' + g.symbol + routeBadge + '</div><div class="p">' + formatMarketPrice(g.priceUsd) + '</div></div>' +
            '<div class="chg"><div class="' + pctClass + '">' + (Number(g.change24h || 0) >= 0 ? "+" : "") + Number(g.change24h || 0).toFixed(2) + '%</div><div class="vol">Vol ' + moneyCompact(g.volume24hUsd) + '</div></div>' +
          '</div>';
        }).join("");
      }
      function marketsFromCoinGecko(payload){
        if (!payload) return [];
        return ["WLD","USDC","ETH","BTC"].map(function(sym){
          var row = payload[sym];
          if (!row || typeof row !== "object") return null;
          return {
            symbol: sym,
            name: tokenFull[sym] || (sym === "BTC" ? "Bitcoin" : sym),
            priceUsd: row.usd,
            change24h: row.usd_24h_change,
            volume24hUsd: 0,
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
      function shortAmount(value){
        var n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 8 : 6 });
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
        var box = document.getElementById("quoteCompareBox");
        if (box) return box;
        var detail = document.querySelector(".swap-detail");
        if (!detail) return null;
        detail.insertAdjacentHTML("afterend",
          '<div class="quote-warning" id="quoteWarning"></div>' +
          '<div class="quote-compare" id="quoteCompareBox">' +
            '<div class="quote-compare-title">报价来源对比</div>' +
            '<div class="quote-compare-rows" id="quoteCompareRows"></div>' +
          '</div>'
        );
        return document.getElementById("quoteCompareBox");
      }
      function setSwapButtonPending(){
        var btn = document.getElementById("swapBtn");
        if (!btn) return;
        btn.classList.add("quote-only");
        btn.disabled = false;
        btn.setAttribute("aria-disabled", "true");
        var span = btn.querySelector("span");
        if (span) span.textContent = "Swap 即将上线";
        btn.onclick = function(){ toast("兑换功能即将上线"); };
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
      function setQuoteState(message, impactClass){
        ensureQuoteBox();
        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        var rows = document.getElementById("quoteCompareRows");
        var warn = document.getElementById("quoteWarning");
        if (buy) buy.value = "—";
        if (rate) rate.textContent = message;
        if (impact) { impact.textContent = "—"; impact.className = impactClass || "impact-mid"; }
        if (gas) gas.textContent = "—";
        if (rows) rows.innerHTML = "";
        if (warn) { warn.classList.remove("show"); warn.textContent = ""; }
      }
      function formatRate(value){
        var n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return "—";
        return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 8 : 6 });
      }
      function referenceRow(label, ref, suffix){
        var available = ref && ref.available !== false && ref.rate;
        var mark = ref && ref.selected ? ' <span class="quote-current">✓ 当前</span>' : "";
        var right = available ? ("1 " + swapState.sell + " = " + formatRate(ref.rate) + " " + swapState.buy + mark) : "—";
        return '<div class="quote-ref-row"><span>' + label + '</span><strong>' + right + (suffix || "") + '</strong></div>';
      }
      function renderReferences(data){
        ensureQuoteBox();
        var rows = document.getElementById("quoteCompareRows");
        if (!rows) return;
        var refs = data.references || {};
        rows.innerHTML =
          referenceRow("Uniswap V3", refs.uniswapV3) +
          referenceRow("Uniswap V4", refs.uniswapV4) +
          referenceRow("Chainlink", Object.assign({ available: !!(refs.chainlink && refs.chainlink.rate) }, refs.chainlink || {}), ' <span class="quote-muted">(参考)</span>') +
          referenceRow("CoinGecko", Object.assign({ available: !!(refs.coingecko && refs.coingecko.rate) }, refs.coingecko || {}), ' <span class="quote-muted">(参考)</span>');
      }
      function renderWarning(data){
        var warn = document.getElementById("quoteWarning");
        if (!warn) return;
        var text = "";
        if (data.blocked) text = data.blockReason || "报价风险过高,暂不允许兑换";
        else if (data.warnings && data.warnings.indexOf("price_anomaly") >= 0) text = "价格偏差较大,可能是低流动性导致,建议小额测试";
        else if (data.warnings && data.warnings.indexOf("low_liquidity") >= 0) text = "当前池子流动性较低,大额兑换可能出现明显滑点";
        warn.textContent = text;
        warn.classList.toggle("show", !!text);
      }
      function applyQuote(data){
        ensureQuoteBox();
        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        if (buy) buy.value = shortAmount(data.amountOut);
        if (rate && data.rate) {
          rate.textContent = "1 " + swapState.sell + " ≈ " + formatRate(data.rate) + " " + swapState.buy + " · " + data.source + " · " + (data.feeTier / 10000) + "%";
        }
        if (impact) {
          var p = Number(data.priceImpactPercent || 0);
          impact.textContent = p < 0.01 ? "<0.01%" : p.toFixed(2) + "%";
          impact.className = data.priceImpactLevel === "green" ? "impact-low" : (data.priceImpactLevel === "yellow" ? "impact-mid" : "impact-high");
        }
        if (gas) gas.textContent = Number.isFinite(Number(data.gasEstimateUsd)) ? "Network fee: ~$" + Number(data.gasEstimateUsd).toFixed(2) : "Network fee: —";
        renderReferences(data);
        renderWarning(data);
        setSwapButtonPending();
      }
      async function requestQuote(){
        setSwapButtonPending();
        var sell = document.getElementById("sellAmt");
        var amount = sell ? String(sell.value || "").trim() : "";
        if (!amount || Number(amount) <= 0) {
          setQuoteState("Enter an amount to get a quote");
          return;
        }
        if (customTokens && (customTokens[swapState.sell] || customTokens[swapState.buy])) {
          setQuoteState("No route yet. Imported tokens need verified liquidity and approval checks.", "impact-high");
          return;
        }
        var seq = ++quoteSeq;
        setQuoteState("Reading DEX route...");
        try {
          var res = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
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
        } catch(e) {
          if (seq !== quoteSeq) return;
          var msg = e && e.message ? e.message : "Quote failed";
          if (/No Uniswap|No quote|not supported|Cannot resolve/i.test(msg)) msg = "No executable route for this pair. Top rankings are market discovery only.";
          setQuoteState(msg, "impact-high");
        }
      }
      function scheduleQuote(){
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(requestQuote, 500);
      }
      var previousRefresh = typeof refreshSwapLabels === "function" ? refreshSwapLabels : null;
      if (previousRefresh && !window.__luminaQuoteRefreshWrapped) {
        window.__luminaQuoteRefreshWrapped = true;
        refreshSwapLabels = function(){
          previousRefresh();
          setSwapPillLogo("sellDot", swapState.sell);
          setSwapPillLogo("buyDot", swapState.buy);
          scheduleQuote();
        };
      }
      recalc = scheduleQuote;
      confirmSwap = function(){ toast("兑换功能即将上线"); };
      document.querySelectorAll(".slip-opt").forEach(function(el){
        el.addEventListener("click", scheduleQuote);
      });
      var customSlip = document.querySelector(".slip-custom");
      if (customSlip) customSlip.addEventListener("input", scheduleQuote);
      setSwapButtonPending();
      ensureQuoteBox();
      setSwapPillLogo("sellDot", swapState.sell);
      setSwapPillLogo("buyDot", swapState.buy);
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
        var n = Number(raw.replace(/,/g, ""));
        return Number.isFinite(n) ? n : 0;
      }
      function setButtonLoading(active){
        if (!submit) return;
        submit.classList.toggle("is-loading", active);
        submit.innerHTML = active ? '<span class="send-spinner"></span><span>处理中...</span>' : '<span data-i18n="confirmSend">确认转账</span>';
      }
      function validation(){
        var token = selectedToken();
        var recipient = recipientInput ? recipientInput.value.trim() : "";
        var amountText = amountInput ? cleanAmount(amountInput.value) : "";
        var amount = Number(amountText);
        var balance = token ? balanceNumber(token.symbol) : 0;
        var recipientMsg = "";
        var amountMsg = "";
        if (!token) amountMsg = "请选择可发送的 World Chain 代币";
        if (token && !token.native && !token.address) amountMsg = "缺少代币合约地址";
        if (recipient && !isValidAddress(recipient)) recipientMsg = "收款地址格式不对";
        if (amountText && (!Number.isFinite(amount) || amount <= 0)) amountMsg = "请输入大于 0 的金额";
        if (token && Number.isFinite(amount) && amount > balance) amountMsg = "余额不足";
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
        toast("已填入全部可用余额");
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
              '<h3>确认转账</h3>' +
              '<p class="send-confirm-body" style="display:block;width:100%;margin:10px 0 22px;color:var(--text-dim);font-size:16px;line-height:1.7;overflow-wrap:anywhere;">转 ' + state.amountText + ' ' + state.token.symbol + '<br>到 ' + state.recipient.slice(0, 6) + '...' + state.recipient.slice(-4) + '</p>' +
              '<div class="earn-action-row" style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px;"><button class="btn-ghost" id="sendConfirmCancel">取消</button><button class="btn-primary" id="sendConfirmOk">确认</button></div>' +
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
        if (!value) return "Submitted";
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
            '<div class="tx-submitted-body"><strong>Transaction submitted</strong><p>Waiting for World Chain confirmation. Activity will update automatically.</p><span class="tx-submitted-hash">' + shortHash(tx) + '</span></div>' +
            '<div class="tx-submitted-actions"><button type="button" class="primary" id="txToastActivity">View Activity</button>' +
            (canOpen ? '<a href="https://worldscan.org/tx/' + tx + '" target="_blank" rel="noreferrer">Explorer</a>' : '<button type="button" id="txToastClose">Close</button>') +
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
          toast(state.error || "请先填写有效地址和金额");
          return;
        }
        var confirmed = await confirmSendAction(state);
        if (!confirmed) {
          toast("已取消");
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
            try { localStorage.removeItem("lumina_local_activity"); } catch(e) {}
            showTransactionSubmitted(hash);
            if (window.__luminaRefreshWalletData) window.__luminaRefreshWalletData();
            setTimeout(function(){ go("activity"); setTabByName("Activity"); if (window.__luminaRefreshActivity) window.__luminaRefreshActivity(); }, 1500);
            recipientInput.value = "";
            amountInput.value = "";
          } else if (result.status === "user_rejected") {
            toast("您取消了交易");
          } else {
            var msg = window.__luminaFriendlySendError ? window.__luminaFriendlySendError(result.error) : (result.error || "交易失败");
            toast("转账失败: " + msg);
          }
        } catch(e) {
          var code = e && e.message ? e.message : "generic_error";
          var friendly = window.__luminaFriendlySendError ? window.__luminaFriendlySendError(code) : code;
          toast("转账失败: " + friendly);
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
        maxBtn.textContent = "全部";
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
      try { localStorage.removeItem("lumina_local_activity"); } catch(e) {}
      function emptyActivity(message){
        return '<div style="text-align:center;color:var(--text-mute);padding:42px var(--pad-screen);font-size:14px;line-height:1.5;">' + message + '</div>';
      }
      function activityCopy(key){
        var lang = window.currentLang || "en";
        var copy = {
          loading: { en:"Loading activity...", fr:"Chargement de l'activité...", de:"Aktivität wird geladen...", es:"Cargando actividad...", ja:"アクティビティを読み込み中...", "zh-CN":"正在读取活动...", "zh-TW":"正在讀取活動..." },
          empty: { en:"No activity yet", fr:"Aucune activité pour le moment", de:"Noch keine Aktivität", es:"Aún no hay actividad", ja:"アクティビティはまだありません", "zh-CN":"暂无活动", "zh-TW":"暫無活動" }
        };
        return (copy[key] && (copy[key][lang] || copy[key].en)) || key;
      }
      function itemHtml(a){
        var plus = a.type === "in" ? " plus" : "";
        var canOpen = a.hash && String(a.hash).indexOf("pending-") !== 0;
        return '<div class="act-item" onclick="' + (canOpen ? 'openExplorer(\\'' + a.hash + '\\')' : 'toast(\\'交易已提交,等待链上确认\\')') + '" style="cursor:pointer;">' +
          '<div class="act-ic ' + a.type + '">' + actIcon(a.type) + '</div>' +
          '<div class="act-mid"><div class="t">' + a.title + (canOpen ? ' <span style="color:var(--text-mute);font-size:11px;">↗</span>' : '') + '</div><div class="s">' + a.subtitle + '</div></div>' +
          '<div class="act-amt"><div class="v' + plus + '">' + a.amount + '</div><div class="st">' + (a.status || "Completed") + '</div></div>' +
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
        var address = window.__luminaUserAddress || "";
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          activityItems = [];
          renderActivity();
          return;
        }
        fetch("/api/activity?address=" + encodeURIComponent(address), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : []; })
          .then(function(rows){ activityItems = Array.isArray(rows) ? rows : []; renderActivity(); })
          .catch(function(){ activityItems = []; renderActivity(); });
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
      function toggleHtml(){
        return '<span class="toggle on" onclick="event.stopPropagation();this.classList.toggle(\\'on\\')"></span>';
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
          '<button id="feedbackSendBtn" onclick="sendFeedback()"></button></div>';
        document.body.appendChild(modal);
        updateFeedbackCopy();
      }
      window.openFeedback = function(){
        ensureFeedbackModal();
        updateFeedbackCopy();
        document.getElementById("feedbackText").value = "";
        document.getElementById("feedbackContact").value = "";
        document.getElementById("feedbackModal").classList.add("open");
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
          closeFeedback();
          toast(c.sent);
        } catch(e) {
          toast(e && e.message ? e.message : c.failed);
        } finally {
          btn.disabled = false;
          btn.textContent = meCopy().send;
        }
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
          '<div class="me-card"><div class="me-avatar"></div><div class="me-info"><div class="me-name">' + name + ' <span class="v"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.4 1.7 2.9-.3 1.2 2.7 2.7 1.2-.3 2.9L23 12l-1.7 2.4.3 2.9-2.7 1.2-1.2 2.7-2.9-.3L12 23l-2.4-1.7-2.9.3-1.2-2.7-2.7-1.2.3-2.9L1 12l1.7-2.4-.3-2.9 2.7-1.2L6.3 2.7l2.9.3z"/><path d="M10.5 15.2l-2.7-2.7 1.4-1.4 1.3 1.3 4-4 1.4 1.4z" fill="#000"/></svg></span></div><div class="me-addr">' + short + '</div><span class="me-orb">' + c.connected + '</span></div></div>' +
          '<div class="me-group-label">' + c.support + '</div><div class="me-group">' +
            row("feedback", c.feedback, "", "openFeedback()") +
          '</div>' +
          '<div class="me-group-label">' + c.preferences + '</div><div class="me-group">' +
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
      }
      window.__luminaRenderMe = renderMe;
      if (!window.__luminaMeLangPatch && typeof applyLang === "function") {
        window.__luminaMeLangPatch = true;
        var previousApplyLang = applyLang;
        applyLang = function(code){
          previousApplyLang(code);
          try { localStorage.setItem("ww_lang", code); } catch(e) {}
          if (typeof window.__luminaRenderMe === "function") window.__luminaRenderMe();
          updateFeedbackCopy();
        };
      }
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

      function detailWorldLogo(){
        return '<svg class="wld-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M5 16h22M16 5c5 5.5 5 16.5 0 22M16 5c-5 5.5-5 16.5 0 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
      }

      function detailTokenIcon(asset) {
        return window.__luminaTokenLogoHtml ? window.__luminaTokenLogoHtml(asset.sym, asset.logo || asset.sym.charAt(0)) : (asset.sym === "WLD" ? detailWorldLogo() : (asset.logo || asset.sym.charAt(0)));
      }

      function compactUsd(value) {
        var n = Number(value || 0);
        if (!Number.isFinite(n)) return "$0";
        if (n >= 1000000) return "$" + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
        if (n >= 1000) return "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K";
        return "$" + n.toFixed(0);
      }

      function marketForAsset(asset) {
        var map = window.__luminaMarketBySymbol || {};
        return map[asset.sym] || null;
      }

      function renderMarketCard(asset) {
        var market = marketForAsset(asset);
        var chart = document.getElementById("detChart");
        if (!chart) return;
        if (!market || !market.liquidityUsd) {
          if (asset && !asset.__marketLookupStarted) {
            asset.__marketLookupStarted = true;
            chart.innerHTML = '<div class="market-detail-state">Loading market data...</div>';
            fetch("/api/tokens/top?mode=all", { cache: "no-store" })
              .then(function(res){ return res.ok ? res.json() : []; })
              .then(function(markets){
                if (Array.isArray(markets)) markets.forEach(registerMarketToken);
                renderMarketCard(asset);
              })
              .catch(function(){
                chart.innerHTML = chartSvg("1D", Number(tokenChanges24h && tokenChanges24h[asset.sym]) < 0);
                updateRangeChange(null, "1D", asset);
              });
            return;
          }
          chart.innerHTML = chartSvg("1D", Number(tokenChanges24h && tokenChanges24h[asset.sym]) < 0);
          updateRangeChange(null, "1D", asset);
          return;
        }
        renderMarketChart(asset, "1D");
      }
      function renderMarketChart(asset, range) {
        var market = marketForAsset(asset);
        var chart = document.getElementById("detChart");
        var fallbackDown = false;
        try { fallbackDown = Number(tokenChanges24h && tokenChanges24h[asset.sym]) < 0; } catch(e) {}
        if (!chart) return;
        if (!market || !market.poolAddress) {
          chart.innerHTML = chartSvg(range || "1D", fallbackDown);
          updateRangeChange(null, range || "1D", asset);
          return;
        }
        chart.innerHTML = '<div class="market-detail-state">Loading chart...</div>';
        fetch("/api/market/ohlcv?pool=" + encodeURIComponent(market.poolAddress) + "&range=" + encodeURIComponent(range || "1D"), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : { candles: [] }; })
          .then(function(data){
            var candles = Array.isArray(data.candles) ? data.candles : [];
            if (candles.length) {
              chart.innerHTML = trendSvg(candles, range || "1D");
              updateRangeChange(candles, range || "1D", asset);
            } else {
              chart.innerHTML = chartSvg(range || "1D", fallbackDown);
              updateRangeChange(null, range || "1D", asset);
            }
          })
          .catch(function(){
            chart.innerHTML = chartSvg(range || "1D", fallbackDown);
            updateRangeChange(null, range || "1D", asset);
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
        if (change === null || !Number.isFinite(change)) {
          try { change = tokenChanges24h && tokenChanges24h[asset.sym] !== undefined ? tokenChanges24h[asset.sym] : null; } catch(e) { change = null; }
        }
        if (change === null || change === undefined || !Number.isFinite(Number(change))) {
          pill.className = "none";
          pill.textContent = "No data";
          return;
        }
        var up = Number(change) >= 0;
        pill.className = up ? "up" : "down";
        pill.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="' + (up ? "M7 17L17 7M9 7h8v8" : "M7 7l10 10M17 9v8H9") + '"/></svg>' + (up ? "+" : "") + Number(change).toFixed(1) + "%";
      }
      function formatChartPrice(value){
        var n = Number(value || 0);
        if (!Number.isFinite(n) || n <= 0) return "$0";
        if (n >= 1) return "$" + n.toFixed(n >= 100 ? 0 : 2);
        if (n >= 0.01) return "$" + n.toFixed(4);
        return "$" + n.toPrecision(5);
      }
      function trendSvg(candles, range){
        if (!candles.length) return chartSvg(range || "1D");
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
        if (rows.length < 2) return chartSvg(range || "1D");
        var highs = rows.map(function(c){ return c.high; });
        var lows = rows.map(function(c){ return c.low; });
        var max = Math.max.apply(null, highs), min = Math.min.apply(null, lows);
        if (!Number.isFinite(max) || !Number.isFinite(min) || max <= min) return chartSvg(range || "1D");
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
        if (!trades || !trades.length) return '<div class="detail-empty-row">No recent swaps found.</div>';
        return trades.slice(0, 8).map(function(t){
          var side = t.side === "sell" ? "sell" : "buy";
          var amount = t.amount ? Number(t.amount).toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + asset.sym : "—";
          var usd = t.amountUsd ? compactUsd(t.amountUsd) : (t.priceUsd ? formatChartPrice(t.priceUsd) : "—");
          var time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          var hash = t.hash ? String(t.hash) : "";
          var open = hash ? ' onclick="window.open(\\'https://worldscan.org/tx/' + hash + '\\', \\'_blank\\')"' : "";
          return '<div class="detail-trade-row"' + open + '><span class="trade-side ' + side + '">' + (side === "buy" ? "Buy" : "Sell") + '</span><span class="trade-main"><b>' + amount + '</b><em>' + time + ' · ' + shortAddr(t.maker) + '</em></span><span class="trade-usd">' + usd + '</span></div>';
        }).join("");
      }
      function holderRows(holders, asset){
        if (!holders || !holders.length) return '<div class="detail-empty-row">No holder ranking available.</div>';
        var market = marketForAsset(asset) || {};
        var decimals = Number.isFinite(Number(market.decimals)) ? Number(market.decimals) : (asset.sym === "USDC" || asset.sym === "USDT" ? 6 : 18);
        var divisor = Math.pow(10, decimals);
        return holders.slice(0, 8).map(function(h, i){
          var raw = Number(h.balance || 0);
          var amount = raw > divisor ? raw / divisor : raw;
          var label = h.label || shortAddr(h.address);
          var tag = h.isContract ? "Contract" : "Wallet";
          return '<div class="detail-holder-row"><span class="holder-rank">' + (i + 1) + '</span><span class="holder-main"><b>' + label + '</b><em>' + tag + '</em></span><span class="holder-bal">' + amount.toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' ' + asset.sym + '</span></div>';
        }).join("");
      }
      function renderMarketTables(asset) {
        var tradesBox = document.getElementById("detTrades");
        var holdersBox = document.getElementById("detHolders");
        if (!tradesBox || !holdersBox) return;
        var market = marketForAsset(asset);
        if (!market || !market.poolAddress || !market.address) {
          tradesBox.innerHTML = '<div class="detail-empty-row">Market pair unavailable.</div>';
          holdersBox.innerHTML = '<div class="detail-empty-row">Holder ranking unavailable.</div>';
          return;
        }
        tradesBox.innerHTML = '<div class="detail-empty-row">Loading trades...</div>';
        holdersBox.innerHTML = '<div class="detail-empty-row">Loading holders...</div>';
        fetch("/api/market/token-detail?pool=" + encodeURIComponent(market.poolAddress) + "&token=" + encodeURIComponent(market.address), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : { trades: [], holders: [] }; })
          .then(function(data){
            tradesBox.innerHTML = tradeRows(Array.isArray(data.trades) ? data.trades : [], asset);
            holdersBox.innerHTML = holderRows(Array.isArray(data.holders) ? data.holders : [], asset);
          })
          .catch(function(){
            tradesBox.innerHTML = '<div class="detail-empty-row">Unable to load trades.</div>';
            holdersBox.innerHTML = '<div class="detail-empty-row">Unable to load holders.</div>';
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
          '<div class="market-stat-row"><span>24h Volume</span><b>' + compactUsd(market.volume24hUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>Liquidity</span><b>' + compactUsd(market.liquidityUsd) + '</b></div>' +
          '<div class="market-stat-row"><span>Pool</span><b>' + String(market.poolAddress || "").slice(0, 6) + "..." + String(market.poolAddress || "").slice(-4) + '</b></div>' +
          '</div>';
        modal.classList.add("open");
      }
      window.goSwapFromDetail = function(){
        var asset = assets && assets[currentDetailIdx] ? assets[currentDetailIdx] : null;
        if (asset && typeof swapState !== "undefined") {
          swapState.sell = asset.sym;
          if (swapState.buy === asset.sym) swapState.buy = asset.sym === "WLD" ? "USDC" : "WLD";
          if (typeof refreshSwapLabels === "function") refreshSwapLabels();
        }
        go("swap");
        setTabByName("Swap");
      }

      function ensureDetailShell() {
        var view = document.getElementById("view-detail");
        if (!view || view.dataset.luminaDetailV2 === "1") return;
        view.dataset.luminaDetailV2 = "1";
        view.innerHTML =
          '<div class="detail-v2-topbar">' +
            '<button class="detail-v2-back" onclick="go(\\'home\\'); setTabByName(\\'Home\\')" aria-label="Back"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></button>' +
            '<div class="detail-v2-token"><div class="detail-v2-token-icon" id="detCoin">◉</div><div><div class="detail-v2-symbol" id="detTitle">WLD</div><div class="detail-v2-name" id="detName">Worldcoin</div></div></div>' +
            '<div class="detail-v2-tools"><button type="button" onclick="openPoolInfo()">' + detailIcon("more") + '</button></div>' +
          '</div>' +
          '<section class="detail-v2-hero">' +
            '<div class="detail-v2-amount" id="detAmt">0 WLD</div>' +
            '<div class="detail-v2-fiat" id="detUsd">≈ $0.00</div>' +
            '<div class="detail-v2-change"><span id="detChangePill">+0.00%</span><em id="detChangeLabel">1D</em></div>' +
          '</section>' +
          '<section class="detail-v2-chart-card">' +
            '<div class="detail-chart" id="detChart"></div>' +
            '<div class="range-row detail-v2-ranges"><div class="range">1H</div><div class="range sel">1D</div><div class="range">1W</div><div class="range">1Y</div><div class="range">ALL</div></div>' +
          '</section>' +
          '<div class="detail-actions detail-v2-actions">' +
            '<button class="btn-ghost detail-action-receive" onclick="window.__luminaOpenReceive && window.__luminaOpenReceive()"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v15"/><path d="M6 12l6 6 6-6"/><path d="M5 21h14"/></svg>Receive</button>' +
            '<button class="btn-ghost detail-action-swap" onclick="goSwapFromDetail()"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>Swap</button>' +
            '<button class="btn-primary detail-action-send" onclick="goSend(assets[currentDetailIdx].sym)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V6"/><path d="M6 12l6-6 6 6"/></svg>Send</button>' +
          '</div>' +
          '<section class="detail-market-panels">' +
            '<div class="detail-market-card"><div class="detail-market-title"><span>Trades</span><em>Live pool</em></div><div id="detTrades"></div></div>' +
            '<div class="detail-market-card"><div class="detail-market-title"><span>Holders</span><em>Top ranking</em></div><div id="detHolders"></div></div>' +
          '</section>' +
          '<section class="detail-v2-menu">' +
            '<button type="button" onclick="go(\\'activity\\'); setTabByName(\\'Activity\\')"><span>' + detailIcon("activity") + '</span><strong>Recent Activity</strong><i>›</i></button>' +
            '<a id="detExplorer" target="_blank" rel="noreferrer"><span>' + detailIcon("globe") + '</span><strong>View on Explorer</strong><i>›</i></a>' +
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
        var change = null;
        try { change = tokenChanges24h && tokenChanges24h[asset.sym] !== undefined ? tokenChanges24h[asset.sym] : null; } catch(e) { change = null; }
        var pill = document.getElementById("detChangePill");
        renderMarketTables(asset);
        if (change === null || change === undefined || !Number.isFinite(Number(change))) {
          pill.className = "none";
          pill.textContent = "No data";
          renderMarketCard(asset);
          return;
        }
        var up = change >= 0;
        pill.className = up ? "up" : "down";
        pill.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="' + (up ? "M7 17L17 7M9 7h8v8" : "M7 7l10 10M17 9v8H9") + '"/></svg>' + (up ? "+" : "") + Number(change).toFixed(1) + "%";
        renderMarketCard(asset);
      }

      var previousOpenDetail = typeof openDetail === "function" ? openDetail : null;
      if (previousOpenDetail) {
        openDetail = function(index) {
          currentDetailIdx = index;
          var asset = assets[index];
          if (!asset) return;
          updateDetailContent(asset);
          renderRange("1D");
          updateExplorer();
          go("detail"); setTabByName("Home");
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
