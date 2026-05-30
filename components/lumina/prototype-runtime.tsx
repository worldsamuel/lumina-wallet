"use client";

import { useEffect, useRef, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import { prototypeMarkup } from "./prototype-markup";
import { prototypeScript } from "./prototype-script";
import { shortenAddress } from "@/lib/auth/store";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";
import { useBackendConfigSync } from "@/lib/backend/use-backend-config";
import { useChainBalanceSync } from "@/lib/chain/use-chain-balance-sync";

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
    __luminaSendMorphoTransactions?: (transactions: MiniKitCalldataTransaction[]) => Promise<unknown>;
  }
}

type EarnConfirmInput = {
  action: "deposit" | "withdraw";
  amount: string;
  product: string;
};

type MiniKitCalldataTransaction = {
  to: string;
  data: string;
  value?: string;
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
  const { address, error, login, logout, status, username } = useWalletAuth();
  useBackendConfigSync(status === "authenticated");
  useChainBalanceSync(status === "authenticated" && prototypeReady, address);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "authenticated") return;

    setPrototypeReady(false);
    host.innerHTML = prototypeMarkup;
    const scriptEl = document.createElement("script");
    scriptEl.text = prototypeScript;
    host.appendChild(scriptEl);
    resetPrototypePortfolio();
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
      if (initialView === "about") appendLegalLinks(host);
      wireRealReceiveLinks(host);
      enhancePrototypeDetail();
      enhancePrototypeEarn();
      enhancePrototypeTokens();
      enhancePrototypeBuiltinTokenLogos();
      enhancePrototypeHome();
      enhancePrototypeMarket();
      enhancePrototypeSwapQuote();
      enhancePrototypeActivity();
      enhancePrototypeMe();
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
  }, [address, initialView, login, logout, status, username]);

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

function exposeEarnWalletConfirm() {
  window.__luminaConfirmEarnAction = async ({ action, amount, product }) => {
    const message = `Lumina Earn ${action}: ${amount} into ${product}`;
    if (new URL(window.location.href).searchParams.get("mockWorld") === "1") {
      return window.confirm(message);
    }

    const miniKit = MiniKit as unknown as {
      signMessage?: (input: { message: string }) => Promise<unknown>;
    };
    const signMessage = miniKit.signMessage;
    if (!signMessage) {
      return window.confirm(message);
    }

    try {
      const result = await signMessage({ message });
      return !JSON.stringify(result).toLowerCase().includes("error");
    } catch {
      return false;
    }
  };
}

function exposeMorphoTransactions() {
  window.__luminaSendMorphoTransactions = async (transactions) => {
    if (new URL(window.location.href).searchParams.get("mockWorld") === "1") {
      return { userOpHash: `0xmock${Date.now().toString(16)}` };
    }

    const miniKit = MiniKit as unknown as {
      sendTransaction?: (input: {
        chainId?: number;
        transaction?: MiniKitCalldataTransaction[];
        transactions?: MiniKitCalldataTransaction[];
      }) => Promise<unknown>;
    };
    const sendTransaction = miniKit.sendTransaction;
    if (!sendTransaction) throw new Error("MiniKit sendTransaction is unavailable.");

    return sendTransaction({
      chainId: 480,
      transaction: transactions,
      transactions,
    });
  };
}

/**
 * Clears prototype demo balances before live chain data arrives so stale placeholder money never flashes.
 */
function resetPrototypePortfolio() {
  const source = `
    assets = [];
    balances = { WLD: "0", USDC: "0", USDT: "0", ETH: "0" };
    availMap = {};
    totalUsdNum = 0;
    change24hUsdNum = 0;
    if (document.querySelector(".balance-change")) {
      document.querySelector(".balance-change").childNodes[0].textContent = "+0.00% ";
      document.querySelector(".balance-change").classList.remove("down");
    }
    if (typeof renderMoney === "function") renderMoney();
    var subEl = document.getElementById("balSub");
    if (subEl && typeof formatMoney === "function") subEl.textContent = "+" + formatMoney(0) + " (24h)";
    var list = document.getElementById("assetList");
    if (list) {
      list.innerHTML = Array.from({ length: 3 }).map(function(){
        return '<div class="asset asset-skeleton"><div class="coin"></div><div class="name"><div class="sym"></div><div class="full"></div></div><div class="spark"></div><div class="vals"><div class="amt"></div><div class="usd"></div></div></div>';
      }).join("");
    }
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
      <h1>Connecting Lumina</h1>
      <p>Confirm wallet authentication in World App.</p>
      <div className="mini-auth-progress" aria-hidden="true">
        <div className="mini-auth-progress-fill" />
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
    '<a class="legal-link-row" href="/privacy">隐私政策 / Privacy Policy <span aria-hidden="true">›</span></a>',
    '<a class="legal-link-row" href="/terms">服务条款 / Terms of Service <span aria-hidden="true">›</span></a>',
  ].join("");
  aboutContent.appendChild(wrapper);
}

/**
 * Sends receive entry points to the real React receive route instead of the old prototype view.
 */
function wireRealReceiveLinks(host: HTMLDivElement) {
  host
    .querySelectorAll<HTMLElement>("[onclick*=\"go('receive')\"], [onclick*='go(\"receive\")']")
    .forEach((el) => {
      el.onclick = (event) => {
        event.preventDefault();
        window.location.href = `/receive${window.location.search}`;
      };
    });
}

/**
 * Provides stable built-in token marks independent of GeckoTerminal image availability.
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
      function mark(symbol){
        var sym = String(symbol || "").toUpperCase();
        if (sym === "WLD") return '<svg class="lumina-token-mark wld-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M5 16h22M16 5c5 5.5 5 16.5 0 22M16 5c-5 5.5-5 16.5 0 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
        if (sym === "USDC") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 7v18M20.2 10.8c-1-.9-2.4-1.5-4.2-1.5-2.7 0-4.7 1.4-4.7 3.6 0 2.4 2.3 3.1 4.8 3.7 2.4.6 3.9 1 3.9 2.9 0 2-1.8 3.3-4.3 3.3-1.9 0-3.6-.7-5-2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
        if (sym === "USDT") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 9h16v4H8zM14 13h4v9h-4z" fill="#fff"/><ellipse cx="16" cy="14" rx="8" ry="2.5" fill="none" stroke="#fff" stroke-width="1.8"/></svg>';
        if (sym === "ETH") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l8 13-8 4.6L8 16 16 3z" fill="#8aa3d8"/><path d="M16 22.4L8 17.7 16 29l8-11.3-8 4.7z" fill="#b8c8ff"/><path d="M16 20.6V3l8 13-8 4.6z" fill="#dfe6ff" opacity=".38"/></svg>';
        return "";
      }
      function initial(symbol){
        return String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
      }
      function trustLogo(symbol){
        var sym = String(symbol || "").toUpperCase();
        var address = trustLogoAddresses[sym];
        if (!address) return "";
        var world = "https://assets-cdn.trustwallet.com/blockchains/worldchain/assets/" + address + "/logo.png";
        var eth = "https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/" + address + "/logo.png";
        var fallback = String(mark(sym) || initial(sym)).replace(/"/g, "&quot;");
        return "<img class=\\"lumina-token-img\\" src=\\"" + world + "\\" alt=\\"" + sym + " logo\\" loading=\\"lazy\\" data-cache-key=\\"worldchain:" + address.toLowerCase() + "\\" data-fallback=\\"" + eth + "\\" data-initial=\\"" + fallback + "\\" onload=\\"try{var k=this.dataset.cacheKey;var c=JSON.parse(localStorage.getItem('lumina_token_logo_cache_v1')||'{}');c[k]={url:this.currentSrc||this.src,expiresAt:Date.now()+432000000};localStorage.setItem('lumina_token_logo_cache_v1',JSON.stringify(c));}catch(e){}\\" onerror=\\"if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.outerHTML=this.dataset.initial||'';}\\"/>";
      }
      window.__luminaTokenLogoHtml = function(symbol, fallback){
        var trusted = trustLogo(symbol);
        if (trusted) return trusted;
        if (mark(symbol)) return mark(symbol);
        var fb = String(fallback || "");
        if (fb.indexOf("<svg") >= 0 || fb.indexOf("<img") >= 0) return fb;
        return initial(symbol);
      };
      tokenFull.USDT = tokenFull.USDT || "Tether USD";
      tokenLogo.WLD = window.__luminaTokenLogoHtml("WLD", mark("WLD"));
      tokenLogo.USDC = window.__luminaTokenLogoHtml("USDC", mark("USDC"));
      tokenLogo.USDT = window.__luminaTokenLogoHtml("USDT", mark("USDT"));
      tokenLogo.ETH = window.__luminaTokenLogoHtml("ETH", mark("ETH"));
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
        var totalEl = document.getElementById("earnTotal");
        if (totalEl) {
          var active = morphoPositions.filter(function(p){ return Number(p.assetsFormatted || 0) > 0; }).length;
          totalEl.textContent = active ? String(active) : "0";
        }
        var sub = document.querySelector(".earn-hero .sub");
        if (sub) sub.textContent = morphoError || "Morpho Re7 vaults on World Chain";
        var claim = document.querySelector(".earn-hero .claim");
        if (claim) {
          claim.disabled = morphoLoading;
          claim.textContent = morphoLoading ? "Loading" : "Refresh";
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
        var paused = !!vault.depositsPaused;
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
          (paused ? '<div class="earn-dev-note"><strong>' + copy.pausedTitle + '</strong><span>' + copy.pausedBody + '</span></div>' : "") +
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
          var result = await window.__luminaSendMorphoTransactions(data.transactions);
          var hash = (result && result.userOpHash) || (result && result.data && result.data.userOpHash) || "submitted";
          toast("Transaction submitted: " + String(hash).slice(0, 18));
          pollMorphoPositions();
        } catch(e) {
          toast(e && e.message ? e.message : "Deposit failed");
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
          var hash = (result && result.userOpHash) || (result && result.data && result.data.userOpHash) || "submitted";
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

      loadMorphoData(false);
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance Earn prototype");
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
        return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });
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
      function registerImportedToken(token){
        var key = token.symbol;
        if (prices[key] && token.address) key = token.symbol + "_" + token.address.slice(-4).toUpperCase();
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
            if (meta.risk === "high") return;
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
        (assets || []).forEach(function(asset){
          if (["WLD","USDC","USDT","ETH"].indexOf(asset.sym) >= 0) asset.logo = iconFor(asset.sym, asset.logo);
        });
      }
      function registerMarketToken(market){
        var sym = market.symbol;
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
      function renderGainersFromMarkets(markets){
        var box = document.getElementById("gainersList");
        if (!box) return;
        if (!markets.length) {
          box.innerHTML = '<div class="import-load">World Chain 暂无满足流动性条件的 24h 涨幅数据</div>';
          return;
        }
        box.innerHTML = markets.map(function(g, i){
          registerMarketToken(g);
          var rankCls = i < 3 ? "rank top" : "rank";
          var bg = g.symbol === "WLD" ? "#fff" : "linear-gradient(135deg,#1b231e,#26362b)";
          var color = g.symbol === "WLD" ? "#000" : "#fff";
          var pctClass = Number(g.change24h || 0) >= 0 ? "pct" : "pct down";
          return '<div class="gainer" onclick="openMarketDetail(\\'' + g.symbol + '\\')">' +
            '<div class="' + rankCls + '">' + (i + 1) + '</div>' +
            '<div class="ic" style="background:' + bg + ';color:' + color + '">' + iconFor(g.symbol, g.symbol.slice(0, 3)) + '</div>' +
            '<div class="mid"><div class="s">' + g.symbol + '</div><div class="p">' + formatMarketPrice(g.priceUsd) + '</div></div>' +
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
        renderGainers = function(){
          var box = document.getElementById("gainersList");
          if (box) box.innerHTML = '<div class="import-load">读取 GeckoTerminal 行情...</div>';
          Promise.all([
            fetch("/api/tokens/top", { cache: "no-store" }).then(function(res){ return res.ok ? res.json() : []; }).catch(function(){ return []; }),
            fetch("/api/prices/market", { cache: "no-store" }).then(function(res){ return res.ok ? res.json() : null; }).catch(function(){ return null; })
          ])
            .then(function(results){
              registerMarketsFromPriceMeta(results[1]);
              var cg = marketsFromCoinGecko(results[1]);
              var poolMarkets = Array.isArray(results[0]) ? results[0] : [];
              var merged = cg.concat(poolMarkets.filter(function(item){
                return !cg.some(function(existing){ return existing.symbol === item.symbol; });
              }));
              renderGainersFromMarkets(merged);
            })
            .catch(function(){ renderGainersFromMarkets([]); });
        };
        renderGainers();
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
      function setSwapButtonPending(){
        var btn = document.getElementById("swapBtn");
        if (!btn) return;
        btn.classList.add("quote-only");
        btn.disabled = false;
        btn.onclick = function(){ toast("真实兑换交易即将上线"); };
      }
      function setQuoteState(message, impactClass){
        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        if (buy) buy.value = "—";
        if (rate) rate.textContent = message;
        if (impact) { impact.textContent = "—"; impact.className = impactClass || "impact-mid"; }
        if (gas) gas.textContent = "—";
      }
      function applyQuote(data){
        var buy = document.getElementById("buyAmt");
        var rate = document.getElementById("rateTxt");
        var impact = document.getElementById("impactTxt");
        var gas = feeEl();
        var amountIn = Number(data.fromAmount);
        var amountOut = Number(data.toAmount);
        if (buy) buy.value = shortAmount(data.toAmount);
        if (rate && amountIn > 0 && amountOut > 0) {
          rate.textContent = "1 " + data.fromToken + " ≈ " + shortAmount(amountOut / amountIn) + " " + data.toToken + " · " + data.route.join(" → ");
        }
        if (impact) {
          var p = Number(data.priceImpact || 0);
          impact.textContent = p < 0.01 ? "<0.01%" : p.toFixed(2) + "%";
          impact.className = p < 1 ? "impact-low" : (p < 3 ? "impact-mid" : "impact-high");
        }
        if (gas) gas.textContent = data.gasLabel || (data.gas ? "~" + Number(data.gas).toLocaleString() + " gas" : "—");
      }
      async function requestQuote(){
        setSwapButtonPending();
        var sell = document.getElementById("sellAmt");
        var amount = sell ? String(sell.value || "").trim() : "";
        if (!amount || Number(amount) <= 0) {
          setQuoteState("输入卖出数量获取报价");
          return;
        }
        if (customTokens && (customTokens[swapState.sell] || customTokens[swapState.buy])) {
          setQuoteState("导入代币暂不支持报价,需要先验证池子和 approve 风险", "impact-high");
          return;
        }
        var seq = ++quoteSeq;
        setQuoteState("正在读取真实 DEX 报价...");
        try {
          var res = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fromToken: swapState.sell,
              toToken: swapState.buy,
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
          setQuoteState(e && e.message ? e.message : "报价失败", "impact-high");
        }
      }
      function scheduleQuote(){
        clearTimeout(quoteTimer);
        quoteTimer = setTimeout(requestQuote, 280);
      }
      var previousRefresh = typeof refreshSwapLabels === "function" ? refreshSwapLabels : null;
      if (previousRefresh && !window.__luminaQuoteRefreshWrapped) {
        window.__luminaQuoteRefreshWrapped = true;
        refreshSwapLabels = function(){
          previousRefresh();
          scheduleQuote();
        };
      }
      recalc = scheduleQuote;
      confirmSwap = function(){ toast("功能即将上线: 当前只显示报价,不会发起交易"); };
      document.querySelectorAll(".slip-opt").forEach(function(el){
        el.addEventListener("click", scheduleQuote);
      });
      var customSlip = document.querySelector(".slip-custom");
      if (customSlip) customSlip.addEventListener("input", scheduleQuote);
      setSwapButtonPending();
      scheduleQuote();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance swap quote");
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
      function itemHtml(a){
        var plus = a.type === "in" ? " plus" : "";
        return '<div class="act-item" onclick="openExplorer(\\'' + a.hash + '\\')" style="cursor:pointer;">' +
          '<div class="act-ic ' + a.type + '">' + actIcon(a.type) + '</div>' +
          '<div class="act-mid"><div class="t">' + a.title + ' <span style="color:var(--text-mute);font-size:11px;">↗</span></div><div class="s">' + a.subtitle + '</div></div>' +
          '<div class="act-amt"><div class="v' + plus + '">' + a.amount + '</div><div class="st">' + (a.status || "Completed") + '</div></div>' +
        '</div>';
      }
      renderActivity = function(){
        var box = document.getElementById("actList");
        if (!box) return;
        var items = activityItems.filter(function(item){ return actFilter === "all" || item.type === actFilter; });
        box.innerHTML = items.length ? items.map(itemHtml).join("") : emptyActivity("暂无真实链上活动");
      };
      window.__luminaRefreshActivity = function(){
        var box = document.getElementById("actList");
        if (box) box.innerHTML = emptyActivity("读取 World Chain 链上活动...");
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
      }, 20000);
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
      function ensureFeedbackModal(){
        if (document.getElementById("feedbackModal")) return;
        var modal = document.createElement("div");
        modal.className = "modal-mask";
        modal.id = "feedbackModal";
        modal.onclick = function(event){ if(event.target === modal) closeFeedback(); };
        modal.innerHTML =
          '<div class="modal feedback-sheet"><div class="modal-grip"></div><h3>在线反馈</h3>' +
          '<p class="feedback-hint">Tell us what went wrong or what you want improved. Feedback is saved for the Lumina team.</p>' +
          '<textarea id="feedbackText" maxlength="1200" placeholder="请输入你的反馈..."></textarea>' +
          '<input id="feedbackContact" maxlength="120" placeholder="联系方式 / Telegram / email (optional)" />' +
          '<button id="feedbackSendBtn" onclick="sendFeedback()">发送反馈</button></div>';
        document.body.appendChild(modal);
      }
      window.openFeedback = function(){
        ensureFeedbackModal();
        document.getElementById("feedbackText").value = "";
        document.getElementById("feedbackContact").value = "";
        document.getElementById("feedbackModal").classList.add("open");
      };
      window.closeFeedback = function(){
        var modal = document.getElementById("feedbackModal");
        if (modal) modal.classList.remove("open");
      };
      window.sendFeedback = async function(){
        var text = (document.getElementById("feedbackText").value || "").trim();
        var contact = (document.getElementById("feedbackContact").value || "").trim();
        if (text.length < 3) { toast("请输入反馈内容"); return; }
        var btn = document.getElementById("feedbackSendBtn");
        btn.disabled = true;
        btn.textContent = "发送中...";
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
          if (!res.ok) throw new Error("failed");
          closeFeedback();
          toast("反馈已发送");
        } catch(e) {
          toast("发送失败,请稍后重试");
        } finally {
          btn.disabled = false;
          btn.textContent = "发送反馈";
        }
      };
      function renderMe(){
        var view = document.getElementById("view-me");
        if (!view) return;
        var address = window.__luminaUserAddress || "";
        var short = address ? address.slice(0, 6) + "..." + address.slice(-4) : "Not connected";
        var name = window.__luminaUsername || short;
        view.innerHTML =
          '<div class="subhead" style="padding-bottom:14px"><h1>Me</h1></div>' +
          '<div class="me-card"><div class="me-avatar"></div><div class="me-info"><div class="me-name">' + name + ' <span class="v"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.4 1.7 2.9-.3 1.2 2.7 2.7 1.2-.3 2.9L23 12l-1.7 2.4.3 2.9-2.7 1.2-1.2 2.7-2.9-.3L12 23l-2.4-1.7-2.9.3-1.2-2.7-2.7-1.2.3-2.9L1 12l1.7-2.4-.3-2.9 2.7-1.2L6.3 2.7l2.9.3z"/><path d="M10.5 15.2l-2.7-2.7 1.4-1.4 1.3 1.3 4-4 1.4 1.4z" fill="#000"/></svg></span></div><div class="me-addr">' + short + '</div><span class="me-orb">World App connected</span></div></div>' +
          '<div class="me-group-label">Support</div><div class="me-group">' +
            row("feedback", "在线反馈", "", "openFeedback()") +
          '</div>' +
          '<div class="me-group-label">Preferences</div><div class="me-group">' +
            row("language", "Language", (document.getElementById("langVal") && document.getElementById("langVal").textContent) || "English", "openLangModal()") +
            row("currency", "Display currency", (document.getElementById("currencyVal") && document.getElementById("currencyVal").textContent) || "USD", "openCurrencyModal()") +
            row("bell", "Notifications", "", "", toggleHtml()) +
          '</div>' +
          '<div class="me-group-label">Legal</div><div class="me-group">' +
            row("privacy", "Privacy Policy", "", "window.location.href=\\'/privacy\\'") +
            row("terms", "Terms of Service", "", "window.location.href=\\'/terms\\'") +
            row("version", "Version", "Lumina v1.0.0", "", "") +
          '</div>';
        ensureFeedbackModal();
      }
      window.__luminaRenderMe = renderMe;
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
        "1D": [35,40,39,43,38,41,47,54,57,66,65,71,58,54,48,44,39,42,51,56,64,62,71,77,77,69,65,65],
        "1W": [40,44,47,43,52,59,63,61,67,71,69,74,78,73,80,84,82],
        "1M": [62,65,63,55,51,57,66,73,74,62,54,48,39,41,53,61,67,58],
        "1Y": [28,35,41,38,47,55,62,59,66,74,70,78,82,76,86,90,87],
        "ALL": [22,25,29,34,32,39,45,44,51,57,63,60,66,72,76,73,80,84,82]
      };

      function chartSvg(range) {
        var values = seriesByRange[range] || seriesByRange["1D"];
        var width = 430;
        var height = 230;
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var span = Math.max(1, max - min);
        var points = values.map(function(v, i) {
          var x = 18 + (i / (values.length - 1)) * (width - 36);
          var y = 82 + ((max - v) / span) * 88;
          return [x, y];
        });
        var line = points.map(function(p, i) {
          return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
        }).join(" ");
        var last = points[points.length - 1];
        var area = line + " L " + last[0].toFixed(1) + " 190 L 18 190 Z";
        return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs><linearGradient id="luminaDetailArea" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#4ade80" stop-opacity="0.46"/>' +
          '<stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<path d="'+area+'" fill="url(#luminaDetailArea)"/>' +
          '<path d="'+line+'" fill="none" stroke="#4ade80" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6" fill="#4ade80"/>' +
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
          chart.innerHTML = '<div class="market-detail-state"><strong>无行情数据</strong><span>该代币在 World Chain 上没有满足流动性条件的价格池,不展示模拟走势图。</span></div>';
          return;
        }
        renderMarketChart(asset, "1D");
      }
      function renderMarketChart(asset, range) {
        var market = marketForAsset(asset);
        var chart = document.getElementById("detChart");
        if (!chart || !market || !market.poolAddress) return;
        chart.innerHTML = '<div class="market-detail-state">读取 K 线...</div>';
        fetch("/api/market/ohlcv?pool=" + encodeURIComponent(market.poolAddress) + "&range=" + encodeURIComponent(range || "1D"), { cache: "no-store" })
          .then(function(res){ return res.ok ? res.json() : { candles: [] }; })
          .then(function(data){
            var candles = Array.isArray(data.candles) ? data.candles : [];
            chart.innerHTML = trendSvg(candles);
            updateRangeChange(candles, range || "1D", asset);
          })
          .catch(function(){ chart.innerHTML = trendSvg([]); });
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
          pill.textContent = "无行情";
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
        return "$" + n.toPrecision(3);
      }
      function trendSvg(candles){
        if (!candles.length) return '<div class="market-detail-state"><strong>暂无 K 线</strong><span>GeckoTerminal 暂无该池子的 OHLCV 数据。</span></div>';
        var width = 420, height = 214, padX = 16, padY = 24;
        var closes = candles.map(function(c){ return Number(c.close || c[4] || 0); }).filter(function(v){ return Number.isFinite(v) && v > 0; });
        if (closes.length < 2) return '<div class="market-detail-state"><strong>暂无 K 线</strong></div>';
        var max = Math.max.apply(null, closes), min = Math.min.apply(null, closes);
        if (!Number.isFinite(max) || !Number.isFinite(min) || max <= min) return '<div class="market-detail-state"><strong>暂无 K 线</strong></div>';
        function y(v){ return padY + (max - v) / (max - min) * (height - padY * 2); }
        var points = closes.map(function(v, i){
          var x = padX + (i / Math.max(1, closes.length - 1)) * (width - padX * 2);
          return [x, y(v)];
        });
        var line = points.map(function(p, i){ return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
        var last = points[points.length - 1];
        var firstClose = closes[0];
        var lastClose = closes[closes.length - 1];
        var up = lastClose >= firstClose;
        var color = up ? "#4ade80" : "#f87171";
        var area = line + " L " + last[0].toFixed(1) + " " + (height - 10) + " L " + padX + " " + (height - 10) + " Z";
        var labelX = Math.min(width - 88, Math.max(18, last[0] - 72));
        var labelY = Math.max(16, Math.min(height - 42, last[1] - 32));
        return '<svg class="market-candles market-trend" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
          '<defs><linearGradient id="trendFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.22"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
          '<text x="' + (width - 12) + '" y="25" text-anchor="end" fill="#98a09a" font-size="13">' + formatChartPrice(max) + '</text>' +
          '<text x="' + (width - 12) + '" y="' + (height - 16) + '" text-anchor="end" fill="#626862" font-size="13">' + formatChartPrice(min) + '</text>' +
          '<path d="' + area + '" fill="url(#trendFade)"/>' +
          '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<rect x="' + labelX.toFixed(1) + '" y="' + labelY.toFixed(1) + '" width="82" height="26" rx="13" fill="rgba(4,7,4,0.84)" stroke="' + color + '" stroke-opacity="0.28"/>' +
          '<text x="' + (labelX + 41).toFixed(1) + '" y="' + (labelY + 17).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="12" font-weight="800">' + formatChartPrice(lastClose) + '</text>' +
          '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="5.5" fill="' + color + '"/>' +
          '</svg>';
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
            '<div class="range-row detail-v2-ranges"><div class="range">1H</div><div class="range sel">1D</div><div class="range">1W</div><div class="range">1Y</div></div>' +
          '</section>' +
          '<div class="detail-actions detail-v2-actions">' +
            '<button class="btn-ghost" onclick="window.location.href=\\'/receive\\'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v15"/><path d="M6 12l6 6 6-6"/><path d="M5 21h14"/></svg>Receive</button>' +
            '<button class="btn-primary" onclick="goSend(assets[currentDetailIdx].sym)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V6"/><path d="M6 12l6-6 6 6"/></svg>Send</button>' +
          '</div>' +
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
        if (change === null || change === undefined || !Number.isFinite(Number(change))) {
          pill.className = "none";
          pill.textContent = "无行情";
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
