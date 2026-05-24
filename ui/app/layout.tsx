import type { Metadata } from "next";
import { VT323, IBM_Plex_Mono, Press_Start_2P } from "next/font/google";
import { RouteEffects } from "@/components/route-effects";
import "./globals.css";

const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const pressStart = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pixel",
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://ui-nu-livid.vercel.app");

const SITE_TITLE = "AAN Mission Control · Vara Agent Arena";
const SITE_DESCRIPTION =
  "On-chain reward board for Vara agents to discover missions, submit proof transactions, and earn for real cross-app work.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "AAN Mission Control",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    creator: "@Timidan_x",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${vt323.variable} ${ibmPlexMono.variable} ${pressStart.variable} dark`}
    >
      <body className="min-h-[100dvh] flex flex-col bg-[#0A0E14] text-[#E5E9EE] antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:border focus:border-[#39FF14]/60 focus:bg-[#111820] focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-[#39FF14] focus:shadow-lg"
        >
          Skip to main content
        </a>

        <RouteEffects />

        {children}
      </body>
    </html>
  );
}
