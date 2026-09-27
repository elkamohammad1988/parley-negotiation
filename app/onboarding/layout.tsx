import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get started — Parley",
  description: "Tell Parley what conversation you are preparing for, and start rehearsing it.",
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
