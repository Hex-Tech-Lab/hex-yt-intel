import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

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
  title: "Hex YT Intel | YouTube Synthesis Engine",
  description: "AI-powered intelligence for video content",
};

// Icons used in interactive elements (buttons, nav, actions)
import { SOLAR_ICON_DATA } from '@/lib/icon-data';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-bg text-primary antialiased font-sans min-w-[320px]">
        <Providers>
          {children}
          <Analytics />
        </Providers>
        <Script
          src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"
          strategy="beforeInteractive"
        />
        {/* codacy-disable <script>dangerouslySetInnerHTML</script> */}
        {/* DOMPurify / sanitize bypass: this is static javascript code, not user-generated HTML */}
        <Script
          id="iconify-preload"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `var _solarData=${JSON.stringify(SOLAR_ICON_DATA)};if(typeof Iconify!=="undefined"){Iconify.addCollection(_solarData);}else{document.addEventListener("DOMContentLoaded",function(){if(typeof Iconify!=="undefined")Iconify.addCollection(_solarData);});}`,
          }}
        />
      </body>
    </html>
  );
}
