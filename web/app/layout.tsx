import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

// Self-hosted Inter (Next.js inlines the woff2 at build — no runtime CDN dependency).
// Replaces the prior huly.io @font-face remnants in page.module.css.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

export const metadata: Metadata = {
  title: "Hex YT Intel | YouTube Synthesis Engine",
  description: "AI-powered intelligence for video content",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-surface text-primary antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
