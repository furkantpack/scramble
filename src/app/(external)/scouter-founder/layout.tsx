import type { ReactNode } from "react";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scramble - Founder intelligence",
  description:
    "Give Scouter enough context to research your company, then continue through a focused founder conversation.",
};

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
