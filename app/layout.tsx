import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小馆雷达 V5 · 评论辅助发现版",
  description: "使用真实地图、真实 POI、候选分筛选与人工评论证据发现附近小馆。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
