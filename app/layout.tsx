import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "季度对账复核",
  description: "公司内部季度对账、差额核验与财务复核平台。",
  openGraph: {
    title: "季度对账复核",
    description: "按区域填写、自动核验、财务复核。",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
