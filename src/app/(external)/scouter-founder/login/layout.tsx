import type { ReactNode } from "react";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scramble — Sign in",
  description: "Find it. Apply. Move on.",
};

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
