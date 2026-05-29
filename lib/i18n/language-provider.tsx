"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dict, type TranslationKey } from "./dict";
import { storage } from "../storage";

const LANGUAGE_KEY = "ww_lang";

type LanguageContextValue = {
  lang: string;
  setLang: (lang: string) => void;
  t: (key: TranslationKey | string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Provides the selected prototype language and translation helper.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState("en");

  useEffect(() => {
    setLangState(storage.get(LANGUAGE_KEY, "en"));
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang(nextLang) {
        setLangState(nextLang);
        storage.set(LANGUAGE_KEY, nextLang);
      },
      t(key) {
        const entry = dict[key as TranslationKey] as Record<string, string> | undefined;
        return entry?.[lang] ?? entry?.en ?? key;
      },
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useT must be used inside LanguageProvider");
  return ctx.t;
}

export function T({ k }: { k: TranslationKey }) {
  const t = useT();
  return <>{t(k)}</>;
}
