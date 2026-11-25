"use client";

import { Capacitor } from "@capacitor/core";

/** Height reserved for the bottom banner. Keep in sync with the native ad height. */
export const AD_BANNER_HEIGHT_PX = 50;

/**
 * Bottom ad placement, rendered BELOW the fixed navigation footer.
 *
 * Premium users never render this component, so the footer drops back down
 * to the bottom of the screen.
 *
 * TODO(AdMob): once an AdMob App ID + banner Ad Unit ID are configured, load a
 * real adaptive banner here (e.g. `@capacitor-community/admob`). Keep the
 * wrapper height in sync with the native banner height so the footer never
 * overlaps it.
 */
export function AdBanner({ hidden = false }: { hidden?: boolean }) {
  if (hidden) {
    return null;
  }

  const isNative =
    typeof window !== "undefined" && Capacitor.getPlatform() !== "web";

  return (
    <div
      data-testid="ad-banner"
      data-platform={isNative ? "native" : "web"}
      style={{ height: AD_BANNER_HEIGHT_PX }}
      className="fixed bottom-0 left-0 right-0 z-30 flex w-full items-center justify-center border-t border-slate-200/70 bg-slate-100/90 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 backdrop-blur"
    >
      {isNative ? "AdMob banner" : "Sponsored"}
    </div>
  );
}
