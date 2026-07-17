"use client";

import { useEffect, useState } from "react";

/**
 * Runtime lg-breakpoint check (matches Tailwind's `lg` = 1024px). Used to
 * render EITHER a mobile bottom-sheet Drawer OR a desktop side-panel for
 * the map overlays — rendering both would double-mount their nested
 * base-ui Select/Popover portals.
 *
 * Safe against hydration flash here because the consumers (map detail /
 * search panels) mount on user interaction, long after hydration, so
 * `window` is defined and the lazy initializer returns the correct value
 * on the very first render.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
