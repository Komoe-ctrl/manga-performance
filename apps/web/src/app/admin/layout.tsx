import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Back-office", template: "%s | Back-office" } };

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
