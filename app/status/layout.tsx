import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "System Status — Parley",
  description: "Current uptime and status of Parley services.",
  alternates: { canonical: "/status" },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
