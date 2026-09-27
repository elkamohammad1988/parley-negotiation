import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings — Parley",
  description: "Manage your Parley account settings.",
  robots: { index: false, follow: false },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
