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
    __luminaConfirmEarnAction?: (input: EarnConfirmInput) => Promise<boolean>;
  }
}

type EarnConfirmInput = {
  action: "deposit" | "withdraw";
  amount: string;
  product: string;
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
  const { address, error, login, logout, status } = useWalletAuth();
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

    requestAnimationFrame(() => {
      updatePrototypeAddress(host, address);
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
  }, [address, initialView, login, logout, status]);

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
      commandsAsync?: { signMessage?: (input: { message: string }) => Promise<unknown> };
      signMessage?: (input: { message: string }) => Promise<unknown>;
    };
    const signMessage = miniKit.commandsAsync?.signMessage ?? miniKit.signMessage;
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
      <div className="mini-auth-orb" aria-hidden="true">
        <span />
        <i />
      </div>
      <div className="mini-auth-logo mini-auth-logo-live">L</div>
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

function updatePrototypeAddress(host: HTMLDivElement, address: string | null) {
  window.__luminaUserAddress = address ?? "";
  const label = shortenAddress(address);
  const chipLabel = host.querySelector(".addr-chip span:nth-child(2)");
  if (chipLabel) chipLabel.textContent = label;
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
      function mark(symbol){
        var sym = String(symbol || "").toUpperCase();
        if (sym === "WLD") return '<svg class="lumina-token-mark wld-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="3"/><path d="M5 16h22M16 5c5 5.5 5 16.5 0 22M16 5c-5 5.5-5 16.5 0 22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
        if (sym === "USDC") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 7v18M20.2 10.8c-1-.9-2.4-1.5-4.2-1.5-2.7 0-4.7 1.4-4.7 3.6 0 2.4 2.3 3.1 4.8 3.7 2.4.6 3.9 1 3.9 2.9 0 2-1.8 3.3-4.3 3.3-1.9 0-3.6-.7-5-2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>';
        if (sym === "USDT") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 9h16v4H8zM14 13h4v9h-4z" fill="#fff"/><ellipse cx="16" cy="14" rx="8" ry="2.5" fill="none" stroke="#fff" stroke-width="1.8"/></svg>';
        if (sym === "ETH") return '<svg class="lumina-token-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l8 13-8 4.6L8 16 16 3z" fill="#8aa3d8"/><path d="M16 22.4L8 17.7 16 29l8-11.3-8 4.7z" fill="#b8c8ff"/><path d="M16 20.6V3l8 13-8 4.6z" fill="#dfe6ff" opacity=".38"/></svg>';
        return "";
      }
      window.__luminaTokenLogoHtml = function(symbol, fallback){
        return mark(symbol) || fallback || String(symbol || "?").slice(0, 3).toUpperCase();
      };
      tokenFull.USDT = tokenFull.USDT || "Tether USD";
      tokenLogo.WLD = mark("WLD");
      tokenLogo.USDC = mark("USDC");
      tokenLogo.USDT = mark("USDT");
      tokenLogo.ETH = mark("ETH");
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

/**
 * Replaces prototype Earn demo balances with a zero-starting position flow.
 */
function enhancePrototypeEarn() {
  const source = `
    (function(){
      var storeKey = "lumina_earn_positions_v1";
      var activeEarnIndex = 0;
      var earnTimer = null;

      function readStore(){
        try { return JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch(e) { return {}; }
      }
      function writeStore(value){
        try { localStorage.setItem(storeKey, JSON.stringify(value)); } catch(e) {}
      }
      function apyNum(product){
        return (parseFloat(String(product.apy).replace("%", "")) || 0) / 100;
      }
      function tokenFromMin(product){
        var parts = String(product.min || "").trim().split(/\\s+/);
        return parts[1] || "TOKEN";
      }
      function minAmount(product){
        return parseFloat(String(product.min || "0").replace(/,/g, "")) || 0;
      }
      function earnedFor(product, position){
        if (!position || !position.amount || !position.startedAt) return 0;
        var elapsed = Math.max(0, Date.now() - position.startedAt) / 1000;
        return position.amount * apyNum(product) * (elapsed / (365 * 24 * 60 * 60));
      }
      function fmtEarn(value){
        var n = Number(value) || 0;
        if (n === 0) return "0";
        return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });
      }
      function totalEarned(){
        var store = readStore();
        return products.reduce(function(sum, p){
          return sum + earnedFor(p, store[p.id]);
        }, 0);
      }
      function updateEarnHero(){
        var total = totalEarned();
        var totalEl = document.getElementById("earnTotal");
        if (totalEl) totalEl.textContent = fmtEarn(total);
        var sub = document.querySelector(".earn-hero .sub");
        if (sub) sub.textContent = total > 0 ? "Earning live from active positions" : "No active positions yet";
        var claim = document.querySelector(".earn-hero .claim");
        if (claim) claim.disabled = total <= 0;
      }
      function positionMeta(product){
        var store = readStore();
        var pos = store[product.id] || { amount: 0 };
        var token = tokenFromMin(product);
        var earned = earnedFor(product, pos);
        return { pos: pos, token: token, earned: earned };
      }

      products.forEach(function(product){ product.mine = "0 " + tokenFromMin(product); });

      renderProducts = function(){
        var box = document.getElementById("prodList");
        if (!box) return;
        box.innerHTML = products.map(function(p, i){
          var border = p.icBorder ? ("border:" + p.icBorder + ";") : "";
          var meta = positionMeta(p);
          return '<div class="prod" onclick="openEarn(' + i + ')">' +
            '<div class="top">' +
              '<div class="ic" style="background:' + p.icBg + ';color:' + p.icColor + ';' + border + '">' + p.ic + '</div>' +
              '<div class="nm"><div class="t">' + t(p.tKey) + '</div><div class="d">' + t(p.dKey) + '</div></div>' +
              '<div class="apy"><div class="v">' + p.apy + '</div><div class="l">APY</div></div>' +
            '</div>' +
            '<div class="meta">' +
              '<div class="m"><div class="k">' + t("risk") + '</div><div class="val"><span class="risk ' + p.risk + '">' + t(riskKey[p.risk]) + '</span></div></div>' +
              '<div class="m"><div class="k">Deposit</div><div class="val">' + fmtEarn(meta.pos.amount || 0) + ' ' + meta.token + '</div></div>' +
              '<div class="m"><div class="k">Earned</div><div class="val">' + fmtEarn(meta.earned) + ' ' + meta.token + '</div></div>' +
            '</div></div>';
        }).join('');
        updateEarnHero();
      };

      function renderEarnDetail(product){
        var meta = positionMeta(product);
        var token = meta.token;
        var amount = fmtEarn(meta.pos.amount || 0);
        document.getElementById("edMine").textContent = amount + " " + token + " · Earned " + fmtEarn(meta.earned) + " " + token;
        var card = document.getElementById("earnActionCard");
        if (!card) {
          card = document.createElement("div");
          card.id = "earnActionCard";
          card.className = "earn-action-card";
          var desc = document.getElementById("edDesc");
          desc.insertAdjacentElement("afterend", card);
        }
        var min = minAmount(product);
        card.innerHTML =
          '<label>Amount</label>' +
          '<div class="earn-amount-row"><input id="earnAmountInput" inputmode="decimal" value="' + min + '" /><span>' + token + '</span></div>' +
          '<div class="earn-action-row">' +
            '<button class="btn-primary" onclick="luminaEarnAction(\\'deposit\\')">Deposit</button>' +
            '<button class="btn-ghost" onclick="luminaEarnAction(\\'withdraw\\')">Withdraw</button>' +
          '</div>';
      }

      openEarn = function(i){
        activeEarnIndex = i;
        var p = products[i];
        document.getElementById("edTitle").textContent = t(p.tKey);
        var ic = document.getElementById("edIc");
        ic.textContent = p.ic;
        ic.style.background = p.icBg; ic.style.color = p.icColor;
        ic.style.border = p.icBorder || "none";
        document.getElementById("edApy").textContent = p.apy;
        document.getElementById("edRisk").innerHTML = '<span class="risk ' + p.risk + '">' + t(riskKey[p.risk]) + '</span>';
        document.getElementById("edLock").textContent = t(p.lockKey);
        document.getElementById("edTvl").textContent = formatMoneyCompact(p.tvlNum);
        document.getElementById("edMin").textContent = p.min;
        document.getElementById("edDesc").textContent = t(p.descKey);
        renderEarnDetail(p);
        go("earn-detail"); setTabByName("Earn");
      };

      window.luminaEarnAction = async function(action){
        var product = products[activeEarnIndex];
        var input = document.getElementById("earnAmountInput");
        var amount = Math.max(0, parseFloat(String(input && input.value || "0").replace(/,/g, "")) || 0);
        if (!amount) { toast("Enter amount"); return; }
        var token = tokenFromMin(product);
        var ok = true;
        if (window.__luminaConfirmEarnAction) {
          ok = await window.__luminaConfirmEarnAction({ action: action, amount: amount + " " + token, product: t(product.tKey) });
        }
        if (!ok) { toast("Cancelled"); return; }
        var store = readStore();
        var pos = store[product.id] || { amount: 0, startedAt: 0 };
        if (action === "deposit") {
          pos.amount = (Number(pos.amount) || 0) + amount;
          pos.startedAt = Date.now();
          store[product.id] = pos;
          toast("Deposit confirmed");
        } else {
          pos.amount = Math.max(0, (Number(pos.amount) || 0) - amount);
          pos.startedAt = pos.amount > 0 ? Date.now() : 0;
          if (pos.amount > 0) store[product.id] = pos;
          else delete store[product.id];
          toast("Withdraw confirmed");
        }
        writeStore(store);
        renderProducts();
        go("earn"); setTabByName("Earn");
      };

      openClaimModal = function(){
        if (totalEarned() <= 0) { toast("No yield yet"); return; }
        toast("Claim comes after Earn contracts are live");
      };

      if (earnTimer) clearInterval(earnTimer);
      earnTimer = setInterval(function(){
        updateEarnHero();
        if (document.getElementById("view-earn").classList.contains("active")) renderProducts();
        if (document.getElementById("view-earn-detail").classList.contains("active")) renderEarnDetail(products[activeEarnIndex]);
      }, 5000);
      renderProducts();
      updateEarnHero();
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
          '<div class="vals"><div class="amt">' + asset.amt + '</div><div class="usd">' + (typeof formatMoney === "function" ? formatMoney(asset.usdNum || 0) : "$0.00") + '</div></div>' +
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
      function registerMarketsFromPriceMeta(payload){
        try {
          var markets = payload && payload.meta && Array.isArray(payload.meta.markets) ? payload.meta.markets : [];
          markets.forEach(registerMarketToken);
        } catch(e) {}
      }
      applyTokenLogos();
      if (typeof renderGainers === "function") {
        renderGainers = function(){
          var box = document.getElementById("gainersList");
          if (box) box.innerHTML = '<div class="import-load">读取 GeckoTerminal 行情...</div>';
          Promise.all([
            fetch("/api/tokens/top", { cache: "no-store" }).then(function(res){ return res.ok ? res.json() : []; }).catch(function(){ return []; }),
            fetch("/api/prices", { cache: "no-store" }).then(function(res){ return res.ok ? res.json() : null; }).catch(function(){ return null; })
          ])
            .then(function(results){
              registerMarketsFromPriceMeta(results[1]);
              renderGainersFromMarkets(Array.isArray(results[0]) ? results[0] : []);
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
      window.__luminaRefreshActivity();
    })();
  `;
  runInPrototypeScope(source, "Failed to enhance real activity");
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
          .then(function(data){ chart.innerHTML = candleSvg(Array.isArray(data.candles) ? data.candles : []); })
          .catch(function(){ chart.innerHTML = candleSvg([]); });
      }
      function candleSvg(candles){
        if (!candles.length) return '<div class="market-detail-state"><strong>暂无 K 线</strong><span>GeckoTerminal 暂无该池子的 OHLCV 数据。</span></div>';
        var width = 420, height = 190, pad = 16;
        var highs = candles.map(function(c){ return Number(c.high || c[2] || 0); });
        var lows = candles.map(function(c){ return Number(c.low || c[3] || 0); });
        var max = Math.max.apply(null, highs), min = Math.min.apply(null, lows);
        if (!Number.isFinite(max) || !Number.isFinite(min) || max <= min) return '<div class="market-detail-state"><strong>暂无 K 线</strong></div>';
        function y(v){ return pad + (max - v) / (max - min) * (height - pad * 2); }
        var step = (width - pad * 2) / candles.length;
        var body = candles.map(function(c, i){
          var open = Number(c.open || c[1] || 0), high = Number(c.high || c[2] || 0), low = Number(c.low || c[3] || 0), close = Number(c.close || c[4] || 0);
          var x = pad + i * step + step / 2;
          var up = close >= open;
          var color = up ? "#4ade80" : "#f87171";
          var top = y(Math.max(open, close));
          var h = Math.max(2, Math.abs(y(open) - y(close)));
          return '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + y(high).toFixed(1) + '" y2="' + y(low).toFixed(1) + '" stroke="' + color + '" stroke-width="1.5"/>' +
            '<rect x="' + (x - Math.max(2, step * 0.3)).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + Math.max(3, step * 0.6).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.2" fill="' + color + '"/>';
        }).join("");
        return '<svg class="market-candles" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none">' +
          '<defs><linearGradient id="chartFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(74,222,128,0.12)"/><stop offset="100%" stop-color="rgba(74,222,128,0)"/></linearGradient></defs>' +
          '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="url(#chartFade)"/>' + body + '</svg>';
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
            '<div class="detail-v2-change"><span id="detChangePill">+0.00%</span><em>Today</em></div>' +
          '</section>' +
          '<section class="detail-v2-chart-card">' +
            '<div class="range-row detail-v2-ranges"><div class="range sel">1D</div><div class="range">1W</div><div class="range">1M</div><div class="range">1Y</div><div class="range">ALL</div></div>' +
            '<div class="detail-chart" id="detChart"></div>' +
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
