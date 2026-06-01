"use client";

import eruda from "eruda";
import { ReactNode, useEffect } from "react";

export const Eruda = (props: { children: ReactNode }) => {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const enabled =
      process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true" ||
      params.get("debug") === "eruda" ||
      window.localStorage.getItem("lumina-debug-eruda") === "1";

    if (!enabled) return;
    window.localStorage.setItem("lumina-debug-eruda", "1");

    try {
      eruda.init();
      installErudaFallbackButton();
    } catch (error) {
      console.log("Eruda failed to initialize", error);
    }
  }, []);

  return <>{props.children}</>;
};

function installErudaFallbackButton() {
  if (document.getElementById("lumina-eruda-fallback")) return;
  const button = document.createElement("button");
  button.id = "lumina-eruda-fallback";
  button.type = "button";
  button.textContent = "Debug";
  button.setAttribute(
    "style",
    [
      "position:fixed",
      "right:10px",
      "bottom:82px",
      "z-index:2147483647",
      "height:34px",
      "padding:0 12px",
      "border-radius:999px",
      "border:1px solid rgba(255,255,255,.35)",
      "background:rgba(0,0,0,.72)",
      "color:#fff",
      "font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.28)",
    ].join(";"),
  );
  button.onclick = () => {
    try {
      eruda.show();
    } catch (error) {
      console.log("Eruda show failed", error);
    }
  };
  document.body.appendChild(button);
}
