"use client";

import { create } from "zustand";

type AuthState = {
  address: string | null;
  isAuthenticated: boolean;
  setAddress: (address: string) => void;
  clear: () => void;
};

/**
 * Client-side wallet auth state mirrored from MiniKit walletAuth.
 */
export const useAuthStore = create<AuthState>((set) => ({
  address: null,
  isAuthenticated: false,
  setAddress: (address) => set({ address, isAuthenticated: true }),
  clear: () => set({ address: null, isAuthenticated: false }),
}));

export function shortenAddress(address: string | null) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
