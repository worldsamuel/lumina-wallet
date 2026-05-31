"use client";

import Link from "next/link";
import { legalContent, type LegalPageKind } from "@/lib/legal-content";

type LegalPageProps = {
  kind: LegalPageKind;
};

export function LegalPage({ kind }: LegalPageProps) {
  const document = legalContent[kind].en;
  const label = kind === "privacy" ? "Privacy" : "Terms";

  function goBack() {
    window.location.replace("/me/about");
  }

  return (
    <main className="legal-page">
      <div className="legal-phone">
        <header className="legal-topbar">
          <button className="legal-back" onClick={goBack} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Back</span>
          </button>
          <Link className="legal-logo" href="/" aria-label="Lumina home">
            L
          </Link>
        </header>

        <section className="legal-hero">
          <span className="legal-kicker">{label}</span>
          <p>{document.subtitle}</p>
          <h1>{document.title}</h1>
        </section>

        <article className="legal-article">
          <div className="legal-effective">
            Effective date: {document.effectiveDate}
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
            Last updated: {document.lastUpdated}
          </footer>
        </article>
      </div>
    </main>
  );
}
