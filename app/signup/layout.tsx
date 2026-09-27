import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up — Parley",
  description: "Create your free Parley account and rehearse your next hard conversation.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
