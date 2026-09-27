import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade — Parley",
  description: "Upgrade your Parley plan.",
  robots: { index: false, follow: false },
};

export default function UpgradeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
