import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Lumina Wallet",
  description: "Lumina Wallet privacy policy for World Mini App users.",
};

/**
 * Public Privacy Policy route for app store and World Developer Portal review.
 */
export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
