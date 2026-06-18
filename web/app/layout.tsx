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
const PRELOAD_ICONS = [
  "solar:copy-linear",
  "solar:refresh-linear",
  "solar:close-circle-linear",
  "solar:alt-arrow-down-linear",
  "solar:alt-arrow-up-linear",
  "solar:alt-arrow-right-linear",
  "solar:arrow-right-linear",
  "solar:arrow-up-linear",
  "solar:trash-bin-trash-linear",
  "solar:trash-bin-minimalistic-linear",
  "solar:download-linear",
  "solar:download-minimalistic-linear",
  "solar:magnifer-linear",
  "solar:user-linear",
  "solar:graph-up-linear",
  "solar:bolt-linear",
  "solar:link-round-angle-linear",
  "solar:check-read-linear",
  "solar:danger-circle-linear",
  "solar:folder-open-linear",
  "solar:folder-with-files-linear",
  "solar:pen-new-square-linear",
  "solar:chat-round-dots-bold",
  "solar:chat-round-dots-linear",
  "solar:crown-minimalistic-linear",
  "solar:logout-3-linear",
  "solar:maximize-square-minimalistic-linear",
  "solar:double-alt-arrow-left-linear",
  "solar:scale-linear",
  "solar:stop-circle-linear",
  "solar:share-linear",
  "solar:eye-linear",
  "solar:calendar-linear",
  "solar:file-text-linear",
  "solar:document-text-linear",
  "solar:bolt-circle-linear",
  "solar:arrow-right-up-linear",
  "solar:danger-triangle-linear",
  "solar:heart-linear",
  "solar:clock-circle-linear",
  "solar:chat-square-like-linear",
  "solar:globus-linear",
  "solar:alt-arrow-left-linear",
  "solar:folder-error-linear",
  "solar:magnifer-linear",
  "solar:sun-bold-duotone",
  "solar:letter-linear",
  "solar:check-circle-linear",
  "solar:check-circle-bold",
  "solar:close-circle-linear",
];

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
        <Script
          id="iconify-preload"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `if(typeof Iconify!=="undefined"){Iconify.loadIcons(${JSON.stringify(PRELOAD_ICONS)});}`,
          }}
        />
      </body>
    </html>
  );
}
