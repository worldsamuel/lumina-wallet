"use client";

import { MiniKit } from "@worldcoin/minikit-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "./store";
import type { WalletAuthPayload } from "./wallet-auth-types";

const STATEMENT = "Sign in to Lumina";
const MOCK_ADDRESS = "0x4a3a000000000000000000000000000000006F2d";

type WalletAuthStatus = "checking" | "not-installed" | "authenticating" | "authenticated" | "error";

function shouldUseMockWorldApp() {
  if (process.env.NEXT_PUBLIC_MINIKIT_MOCK === "true") return true;
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return url.searchParams.get("mockWorld") === "1";
}

async function requestNonce() {
  const response = await fetch("/api/auth/nonce", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to create walletAuth nonce.");
  return (await response.json()) as { nonce: string };
}

async function verifyWalletAuth(nonce: string, payload: WalletAuthPayload) {
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, payload }),
  });
  if (!response.ok) throw new Error("Wallet signature verification failed.");
  return (await response.json()) as { address: string };
}

/**
 * Runs the World MiniKit walletAuth login flow and stores the authenticated wallet address.
 */
export function useWalletAuth() {
  const { address, setAddress, clear } = useAuthStore();
  const [status, setStatus] = useState<WalletAuthStatus>("checking");
  const [error, setError] = useState<string | null>(null);

  const mockMode = useMemo(shouldUseMockWorldApp, []);

  const login = useCallback(async () => {
    setError(null);

    if (mockMode) {
      setAddress(MOCK_ADDRESS);
      setStatus("authenticated");
      return;
    }

    MiniKit.install(process.env.NEXT_PUBLIC_WORLD_APP_ID);

    if (!MiniKit.isInstalled()) {
      setStatus("not-installed");
      return;
    }

    try {
      setStatus("authenticating");
      const { nonce } = await requestNonce();
      const result = await MiniKit.walletAuth({ nonce, statement: STATEMENT });
      const payload = result.data as WalletAuthPayload;
      const verified = await verifyWalletAuth(nonce, payload);
      setAddress(verified.address);
      setStatus("authenticated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet authentication failed.");
      setStatus("error");
    }
  }, [mockMode, setAddress]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clear();
    setStatus(mockMode ? "authenticated" : "not-installed");
  }, [clear, mockMode]);

  useEffect(() => {
    if (address) {
      setStatus("authenticated");
      return;
    }
    void login();
  }, [address, login]);

  return {
    address,
    error,
    isInstalled: mockMode || status !== "not-installed",
    login,
    logout,
    status,
  };
}
