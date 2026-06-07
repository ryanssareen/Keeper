import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Keeper",
  description: "Watch a flight against one commitment and catch the cascade before you do.",
  // Links <link rel="manifest" href="/manifest.webmanifest"> so the app is installable (the iOS
  // standalone-PWA path web push requires). appleWebApp emits the apple-mobile-web-app meta tags.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Keeper",
    statusBarStyle: "black-translucent",
  },
};

// themeColor lives on the viewport export (deprecated on `metadata` as of Next 14).
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce-based CSP requires dynamic rendering: the proxy mints a fresh script nonce per request, so
  // pages cannot be prerendered at build time (their inline scripts would carry no/stale nonce and be
  // blocked). `connection()` opts the whole tree into request-time rendering. See lib/security/headers.
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
