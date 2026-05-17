import type { Metadata } from "next"
import "./globals.css"
import { Providers } from "./providers"

// Skip static generation — layout wraps browser-only provider (SessionProvider)
// and must only be resolved at request time
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Hex-YT-Intel",
  description: "YouTube synthesis engine",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
