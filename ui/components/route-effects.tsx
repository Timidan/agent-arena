"use client";

import { usePathname } from "next/navigation";

export function RouteEffects() {
  const pathname = usePathname();
  if (pathname.startsWith("/missions")) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.03,
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\'/></filter><rect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/></svg>")',
        }}
      />
    </div>
  );
}
