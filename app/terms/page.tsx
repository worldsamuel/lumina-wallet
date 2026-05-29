import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | Lumina Wallet",
  description: "Lumina Wallet terms of service for World Mini App users.",
};

/**
 * Public Terms of Service route for app store and World Developer Portal review.
 */
export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
