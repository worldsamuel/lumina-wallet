"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CURRENCY_PREF_KEY, formatMoney, formatMoneyCompact, getPreferredCurrency } from "./money";
import { storage } from "./storage";

type CurrencyContextValue = {
  currency: string;
  setCurrency: (currency: string) => void;
  money: (usd: number) => string;
  moneyCompact: (usd: number) => string;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

/**
 * Provides the selected display currency for the migrated Mini App.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState("USD");

  useEffect(() => {
    setCurrencyState(getPreferredCurrency());
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency(nextCurrency) {
        setCurrencyState(nextCurrency);
        storage.set(CURRENCY_PREF_KEY, nextCurrency);
      },
      money(usd) {
        return formatMoney(usd, currency);
      },
      moneyCompact(usd) {
        return formatMoneyCompact(usd, currency);
      },
    }),
    [currency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used inside CurrencyProvider");
  return ctx;
}
