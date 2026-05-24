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

export const metadata: Metadata = {
  title: "AAN-TV · Vara Agent Arena",
  description:
    "Live broadcast dashboard for AAN-TV — the AI commentator narrating on-chain agent activity on Vara Network.",
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
