import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "申报通 · 竞赛知识库", description: "查阅竞赛资料，带着出处回答问题。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
