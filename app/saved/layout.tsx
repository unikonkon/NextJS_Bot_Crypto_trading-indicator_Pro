import type { Metadata } from "next";

export const metadata: Metadata = { title: "ที่บันทึกไว้" };

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
