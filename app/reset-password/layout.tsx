import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password — Parley",
  description: "Reset the password for your Parley account.",
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
