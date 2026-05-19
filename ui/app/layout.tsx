import type { Metadata } from "next";
import { VT323, IBM_Plex_Mono, Press_Start_2P } from "next/font/google";
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
        {/* CRT scanline + VHS grain overlay — fixed, pointer-events-none, z-50 */}
        <div className="pointer-events-none fixed inset-0 z-50" aria-hidden>
          {/* Scanline overlay */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 3px)",
            }}
          />
          {/* VHS grain */}
          <div
            className="absolute inset-0"
            style={{
              opacity: 0.03,
              backgroundImage:
                'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\'/></filter><rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")',
            }}
          />
        </div>

        {children}
      </body>
    </html>
  );
}
