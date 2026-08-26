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
  // 浏览器翻译、密码管理器等扩展可能在 React 接管前修改 html/body，
  // 这不会影响业务数据，但在本地运行时会触发无意义的 hydration 覆盖层。
  // 首屏业务内容本身已在客户端挂载后才读取本机账套数据，因此仅忽略根节点
  // 的第三方属性差异，不放宽页面内的真实渲染和校验错误。
  return <html lang="zh-CN" suppressHydrationWarning><body suppressHydrationWarning>{children}</body></html>;
}
