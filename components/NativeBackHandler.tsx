"use client";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const HOME_PATH = "/";

export function NativeBackHandler() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (Capacitor.getPlatform() === "web") {
      return;
    }

    const subscription = App.addListener("backButton", () => {
      if (pathname !== HOME_PATH) {
        router.replace(HOME_PATH);
        return;
      }

      App.exitApp();
    });

    return () => {
      void subscription.then((handle) => handle.remove());
    };
  }, [pathname, router]);

  return null;
}
