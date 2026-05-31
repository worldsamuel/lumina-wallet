"use client";

import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAuthStore, useUserAddress } from "@/lib/auth/store";
import { useWalletAuth } from "@/lib/auth/use-wallet-auth";

/**
 * Receive screen backed by the authenticated World App wallet address.
 */
export function ReceivePage() {
  const address = useUserAddress();
  const username = useAuthStore((state) => state.username);
  const { error, login, status } = useWalletAuth();
  const [copied, setCopied] = useState(false);
  const qrCode = useMemo(
    () => address ? <QRCodeSVG value={address} size={196} bgColor="#ffffff" fgColor="#000000" level="M" /> : null,
    [address],
  );

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (status === "checking" || status === "authenticating") {
    return (
      <main className="receive-screen">
        <Link className="receive-back" href="/">
          <span aria-hidden="true">‹</span>
          返回
        </Link>
        <div className="receive-card receive-state">
          <div className="mini-auth-logo">L</div>
          <h1>Connecting wallet</h1>
          <p>Confirm login in World App to show your receive address.</p>
        </div>
      </main>
    );
  }

  if (!address) {
    return (
      <main className="receive-screen">
        <Link className="receive-back" href="/">
          <span aria-hidden="true">‹</span>
          返回
        </Link>
        <div className="receive-card receive-state">
          <div className="mini-auth-logo">L</div>
          <h1>请先登录</h1>
          <p>{error ?? "Login with World App to receive assets."}</p>
          <button onClick={login}>登录</button>
        </div>
      </main>
    );
  }

  return (
    <main className="receive-screen">
      <Link className="receive-back" href="/">
        <span aria-hidden="true">‹</span>
        返回
      </Link>
      <section className="receive-card">
        <strong className="receive-chain">World Chain</strong>
        {username ? <div className="receive-username">@{username}</div> : null}
        <div className="receive-qr" aria-label="Wallet address QR code">
          {qrCode}
        </div>
        <code className="receive-address">{address}</code>
      </section>
      <p className="receive-note-live">
        Only send World Chain assets to this address. Sending assets from other networks may cause
        permanent loss.
      </p>
      <button className="receive-copy" onClick={copyAddress}>
        {copied ? "已复制" : "复制地址"}
      </button>
    </main>
  );
}
