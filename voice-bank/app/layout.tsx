import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./theme.css";
import "./card-viz.css";

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content' };

export const metadata: Metadata = {
  title: "鹅豆 · 财富鹅 — 说一句，开始办理",
  description: "一个可打断的语音银行原型。说出目标，在需要时用卡片完成选择与确认。全部账户与交易均为演示。",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    shortcut: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
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
