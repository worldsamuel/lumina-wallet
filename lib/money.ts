import { defaultCurrencies } from "./money-data";
import { storage } from "./storage";

export const CURRENCY_RATES_KEY = "ww_currency_rates";
export const CURRENCY_PREF_KEY = "ww_currency_pref";

export type CurrencyCode = (typeof defaultCurrencies)[number]["code"];

/**
 * Reads prototype currency rates from localStorage and formats USD-denominated values.
 */
export function getCurrencies() {
  // TODO 第 3 步改为后端 API
  const saved = storage.getJson<Record<string, number> | null>(CURRENCY_RATES_KEY, null);
  return defaultCurrencies.map((currency) => ({
    ...currency,
    rate: saved?.[currency.code] ?? currency.rate,
  }));
}

export function getPreferredCurrency() {
  // TODO 第 3 步改为后端 API
  return storage.get(CURRENCY_PREF_KEY, "USD");
}

export function formatMoney(usd: number, code = getPreferredCurrency()) {
  if (Number.isNaN(usd)) return "—";
  const currencies = getCurrencies();
  const currency = currencies.find((item) => item.code === code) ?? currencies[0];
  const value = usd * currency.rate;
  const noDecimals = ["JPY", "KRW", "NGN", "TWD"].includes(currency.code);
  const formatted = noDecimals
    ? Math.round(value).toLocaleString()
    : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency.symbol}${formatted}`;
}

export function formatMoneyCompact(usd: number, code = getPreferredCurrency()) {
  if (Number.isNaN(usd)) return "—";
  const currencies = getCurrencies();
  const currency = currencies.find((item) => item.code === code) ?? currencies[0];
  const value = usd * currency.rate;
  const suffix = value >= 1e9 ? "B" : value >= 1e6 ? "M" : value >= 1e3 ? "K" : "";
  const divisor = suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : suffix === "K" ? 1e3 : 1;
  const compact = value / divisor;
  const text = suffix ? compact.toFixed(compact >= 100 ? 0 : 1) : Math.round(compact).toLocaleString();
  return `${currency.symbol}${text}${suffix}`;
}
