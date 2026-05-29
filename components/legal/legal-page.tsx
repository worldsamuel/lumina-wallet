"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { legalContent, normalizeLegalLanguage, type LegalLanguage, type LegalPageKind } from "@/lib/legal-content";

type LegalPageProps = {
  kind: LegalPageKind;
};

/**
 * Renders the public legal document pages with local language switching.
 */
export function LegalPage({ kind }: LegalPageProps) {
  const [language, setLanguage] = useState<LegalLanguage>("en");

  useEffect(() => {
    setLanguage(normalizeLegalLanguage(window.localStorage.getItem("ww_lang")));
  }, []);

  const document = legalContent[kind][language];
  const alternateLanguage: LegalLanguage = language === "en" ? "zh-CN" : "en";

  function switchLanguage(nextLanguage: LegalLanguage) {
    setLanguage(nextLanguage);
    window.localStorage.setItem("ww_lang", nextLanguage);
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/me/about";
  }

  return (
    <main className="legal-page">
      <div className="legal-phone">
        <header className="legal-topbar">
          <button className="legal-back" onClick={goBack} aria-label={language === "en" ? "Back" : "返回"}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>{language === "en" ? "Back" : "返回"}</span>
          </button>
          <Link className="legal-logo" href="/" aria-label="Lumina home">
            L
          </Link>
        </header>

        <section className="legal-hero">
          <p>{document.subtitle}</p>
          <h1>{document.title}</h1>
          <div className="legal-lang" aria-label="Language selector">
            <button className={language === "en" ? "active" : ""} onClick={() => switchLanguage("en")}>
              English
            </button>
            <button className={language === "zh-CN" ? "active" : ""} onClick={() => switchLanguage("zh-CN")}>
              中文
            </button>
          </div>
        </section>

        <article className="legal-article">
          <div className="legal-effective">
            {language === "en" ? "Effective date" : "生效日期"}: {document.effectiveDate}
          </div>
          {document.sections.map((section) => (
            <section className="legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <footer className="legal-updated">
            {language === "en" ? "Last updated" : "最后更新"}: {document.lastUpdated}
            <button onClick={() => switchLanguage(alternateLanguage)}>
              {language === "en" ? "阅读中文版" : "Read in English"}
            </button>
          </footer>
        </article>
      </div>
    </main>
  );
}
