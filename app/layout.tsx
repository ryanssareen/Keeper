import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import {
  THEME_COOKIE,
  ACCENT_COOKIE,
  isTheme,
  isAccent,
} from "@/lib/preferences/preferences";
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
  description: "Your whole trip in one calm place — plan your days, keep every booking and document together, and stay ahead of your flight.",
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

  // Theme + accent are read from cookies and stamped on <html> server-side, so the first paint is
  // already in the user's chosen theme — no flash, and no inline bootstrap script to reconcile with the
  // strict (nonce-only) CSP. The client toggle updates these attributes optimistically and persists via
  // savePreferences (which rewrites the cookie). suppressHydrationWarning covers that optimistic write.
  const jar = await cookies();
  const themeCookie = jar.get(THEME_COOKIE)?.value;
  const accentCookie = jar.get(ACCENT_COOKIE)?.value;
  const theme = isTheme(themeCookie) ? themeCookie : "light";
  const accent = isAccent(accentCookie) ? accentCookie : "emerald";

  return (
    <html
      lang="en"
      data-theme={theme}
      data-accent={accent}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
