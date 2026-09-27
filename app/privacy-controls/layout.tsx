import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Controls — Parley",
  description: "Export or delete your Parley rehearsal transcripts, debriefs and playbook.",
  robots: { index: false, follow: false },
};

export default function PrivacyControlsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
