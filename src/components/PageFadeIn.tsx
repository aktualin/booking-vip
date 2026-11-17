"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * Wraps page content and re-triggers a subtle fade-in animation
 * whenever the route changes.
 */
export default function PageFadeIn({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [key, setKey] = useState(0);

  useEffect(() => {
    setKey((k) => k + 1);
  }, [pathname]);

  return (
    <div key={key} className="animate-fade-in">
      {children}
    </div>
  );
}
