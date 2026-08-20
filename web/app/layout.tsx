import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics as DubAnalytics } from "@dub/analytics/react";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Dub conversion-tracking widget. Needs a real publishable key generated in
// the Dub dashboard (user-only action, not something CC/an agent can do) --
// NEXT_PUBLIC_ (client-exposed) so it must never carry a secret. Renders
// nothing at all when unset rather than crashing or shipping an empty key.
const dubAnalyticsPublishableKey = process.env.NEXT_PUBLIC_DUB_ANALYTICS_KEY;

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--inter-font",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--mono-font",
});

export const metadata: Metadata = {
  title: "vIntel | YouTube Synthesis Engine",
  description: "AI-powered intelligence for video content",
  other: {
    "theme-color": "#0B0E14",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${jetbrainsMono.variable}`} style={{ colorScheme: 'dark' }}>
      <body className="bg-bg text-primary antialiased font-sans min-w-[320px]">
        <Providers>
          {children}
          <Analytics />
          <SpeedInsights />
          {dubAnalyticsPublishableKey && <DubAnalytics publishableKey={dubAnalyticsPublishableKey} />}
        </Providers>
      </body>
    </html>
  );
}
