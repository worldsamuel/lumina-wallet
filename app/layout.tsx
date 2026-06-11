import type { Metadata, Viewport } from "next";
import "./globals.css";
import MiniKitProvider from "@/components/minikit-provider";
import dynamic from "next/dynamic";
import { CurrencyProvider } from "@/lib/currency-provider";
import { LanguageProvider } from "@/lib/i18n/language-provider";

export const metadata: Metadata = {
  title: "Lumina Wallet",
  description: "Lumina Wallet v22 and admin v7 production build for World Mini App.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <MiniKitProvider>
      <LanguageProvider>
        <CurrencyProvider>{children}</CurrencyProvider>
      </LanguageProvider>
    </MiniKitProvider>
  );
  const debugEnabled = process.env.NEXT_PUBLIC_ENABLE_ERUDA === "true";
  const body = debugEnabled ? (
    <ErudaProvider>{content}</ErudaProvider>
  ) : (
    content
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-black text-white">
        {body}
      </body>
    </html>
  );
}

const ErudaProvider = dynamic(
  () => import("../components/Eruda").then((c) => c.ErudaProvider),
  {
    ssr: false,
  },
);
