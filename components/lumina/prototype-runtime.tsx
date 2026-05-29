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
    balances = {};
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
    <main className="mini-auth-screen">
      <div className="mini-auth-logo">L</div>
      <h1>Connecting Lumina</h1>
      <p>Confirm wallet authentication in World App.</p>
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
        symbol = String(symbol || "?").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
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
        "1H": [44,48,51,49,54,58,55,62,65,63,68,71,69],
        "1D": [48,54,58,56,49,45,52,60,67,68,57,50,43,45,54,62,66,57,51],
        "1W": [38,42,47,52,49,55,61,58,64,69,66,72,75,70,77,80,76],
        "1M": [62,65,63,55,51,57,66,73,74,62,54,48,39,41,53,61,67,58],
        "1Y": [28,35,41,38,47,55,62,59,66,74,70,78,82,76,86,90,87]
      };

      function chartSvg(range) {
        var values = seriesByRange[range] || seriesByRange["1D"];
        var width = 430;
        var height = 178;
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var span = Math.max(1, max - min);
        var points = values.map(function(v, i) {
          var x = (i / (values.length - 1)) * width;
          var y = 28 + ((max - v) / span) * 86;
          return [x, y];
        });
        var line = points.map(function(p, i) {
          return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
        }).join(" ");
        var area = line + " L " + width + " " + height + " L 0 " + height + " Z";
        return '<svg viewBox="0 0 '+width+' '+height+'" preserveAspectRatio="none" aria-hidden="true">' +
          '<defs><linearGradient id="luminaDetailArea" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#4ade80" stop-opacity="0.42"/>' +
          '<stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<path d="'+area+'" fill="url(#luminaDetailArea)"/>' +
          '<path d="'+line+'" fill="none" stroke="#4ade80" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
      }

      function renderRange(range) {
        var chart = document.getElementById("detChart");
        if (chart) chart.innerHTML = chartSvg(range);
        document.querySelectorAll("#view-detail .range").forEach(function(el) {
          el.classList.toggle("sel", el.textContent.trim() === range);
        });
      }

      function ensureExplorer() {
        var actions = document.querySelector("#view-detail .detail-actions");
        if (!actions || document.getElementById("detExplorer")) return;
        var link = document.createElement("a");
        link.id = "detExplorer";
        link.className = "explorer-link";
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "View on Worldscan";
        actions.insertAdjacentElement("afterend", link);
      }

      function updateExplorer() {
        ensureExplorer();
        var link = document.getElementById("detExplorer");
        if (!link) return;
        var sym = "";
        try {
          sym = assets && assets[currentDetailIdx] ? assets[currentDetailIdx].sym : "";
        } catch(e) {}
        var contract = contracts[sym];
        if (contract) {
          link.href = "https://worldscan.org/token/" + contract;
          link.textContent = sym + " on Worldscan";
          return;
        }
        var address = window.__luminaUserAddress || "";
        link.href = address ? "https://worldscan.org/address/" + address : "https://worldscan.org";
        link.textContent = "View wallet on Worldscan";
      }

      var previousOpenDetail = typeof openDetail === "function" ? openDetail : null;
      if (previousOpenDetail) {
        openDetail = function(index) {
          previousOpenDetail(index);
          renderRange("1D");
          updateExplorer();
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
