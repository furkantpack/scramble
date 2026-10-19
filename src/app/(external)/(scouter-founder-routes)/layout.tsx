import type { ReactNode } from "react";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scramble - Founder Intelligence",
  description: "Founder context, investor matches, introductions, and conversation preparation.",
};

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
