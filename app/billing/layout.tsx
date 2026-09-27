import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing — Parley",
  description: "Manage your Parley subscription, payment method, and invoices.",
  // Every other private surface carries this; billing was the one that did not,
  // which left a page showing a named plan and a renewal date indexable.
  robots: { index: false, follow: false },
};

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
