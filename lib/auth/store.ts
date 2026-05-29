"use client";

import { create } from "zustand";

type AuthState = {
  address: string | null;
  username: string | null;
  isAuthenticated: boolean;
  setAddress: (address: string) => void;
  setUser: (user: { address: string; username?: string | null }) => void;
  clear: () => void;
};

/**
 * Client-side wallet auth state mirrored from MiniKit walletAuth.
 */
export const useAuthStore = create<AuthState>((set) => ({
  address: null,
  username: null,
  isAuthenticated: false,
  setAddress: (address) => set({ address, isAuthenticated: true }),
  setUser: ({ address, username }) => set({ address, username: username ?? null, isAuthenticated: true }),
  clear: () => set({ address: null, username: null, isAuthenticated: false }),
}));

export function shortenAddress(address: string | null) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function useUserAddress() {
  return useAuthStore((state) => state.address);
}
