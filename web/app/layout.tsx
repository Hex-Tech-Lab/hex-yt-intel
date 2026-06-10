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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-bg text-primary antialiased font-sans">
        <Providers>{children}</Providers>
        <Script
          src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
