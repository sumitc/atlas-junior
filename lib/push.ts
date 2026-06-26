import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getClientId } from "@/lib/client-id";
import { registerDeviceToken } from "@/lib/api";
import { resolveNotificationTargetUrl } from "@/lib/notifications";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function setupAndroidPushNotifications(onTap?: (url: string) => void) {
  if (typeof window === "undefined" || Capacitor.getPlatform() === "web") {
    return () => {};
  }

  if (process.env.NEXT_PUBLIC_ENABLE_PUSH_NOTIFICATIONS !== "true") {
    return () => {};
  }

  try {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") {
      return () => {};
    }

    await PushNotifications.createChannel({
      id: "atlas-updates",
      name: "Atlas updates",
      description: "Notifications for Atlas gameplay updates",
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: "#c026d3",
    });

    const listeners = [
      await PushNotifications.addListener("registration", (token) => {
        const clientId = getClientId();
        if (!clientId) {
          return;
        }

        void (async () => {
          const payload = {
            clientId,
            token: token.value,
            platform: Capacitor.getPlatform(),
          };

          for (const delayMs of [0, 500, 1500]) {
            if (delayMs > 0) {
              await sleep(delayMs);
            }

            try {
              await registerDeviceToken(payload);
              return;
            } catch (error) {
              console.error("device token registration failed", error);
            }
          }
        })();
      }),
      await PushNotifications.addListener("registrationError", (error) => {
        console.error("push registration error", error);
      }),
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const targetUrl = resolveNotificationTargetUrl({
          kind: String(action.notification.data?.kind ?? action.notification.data?.sourceType ?? ""),
          targetUrl: String(action.notification.data?.targetUrl ?? ""),
        });
        if (targetUrl && onTap) {
          onTap(targetUrl);
        }
      }),
      await PushNotifications.addListener("pushNotificationReceived", () => {
        window.dispatchEvent(new Event("atlas:notifications-refresh"));
      }),
    ];

    await PushNotifications.register();

    return async () => {
      await Promise.all(listeners.map((listener) => listener.remove()));
    };
  } catch (error) {
    console.error("push setup failed", error);
    return () => {};
  }
}
