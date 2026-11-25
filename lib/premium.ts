const PREMIUM_STORAGE_KEY = "atlas-premium";
const PREMIUM_CHANGE_EVENT = "atlas-premium-changed";

/** Subscribe to premium changes (same-tab toggles and cross-tab storage events). */
export function subscribeToPremium(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(PREMIUM_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREMIUM_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** True when the user has unlocked the ad-free one-time premium mode. */
export function getIsPremium(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(PREMIUM_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist the premium unlock locally (survives app restarts). */
export function savePremiumUnlocked(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value) {
      window.localStorage.setItem(PREMIUM_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(PREMIUM_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing — premium stays session-only.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PREMIUM_CHANGE_EVENT));
  }
}

export type PurchaseResult = {
  success: boolean;
  message: string;
};

/**
 * One-time premium purchase hook.
 *
 * TODO: connect this to the chosen payment provider:
 *  - Android: Google Play Billing one-time product (e.g. `premium_ad_free`)
 *  - Web: Stripe Checkout one-time payment + webhook verification
 *
 * Until a provider is configured, purchases are intentionally disabled so no
 * user is charged by a placeholder flow. Debug builds can toggle premium from
 * the debug panel to test the ad-free layout.
 */
export async function purchasePremium(): Promise<PurchaseResult> {
  return {
    success: false,
    message:
      "Premium checkout isn't connected yet. Ads can be removed once payments are enabled.",
  };
}

/** Restore an existing one-time purchase from the payment provider. */
export async function restorePremiumPurchase(): Promise<PurchaseResult> {
  const active = getIsPremium();
  return {
    success: active,
    message: active
      ? "Premium is already active on this device."
      : "No previous premium purchase found on this device.",
  };
}
