import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { getClientId } from "@/lib/client-id";
import { registerDeviceToken } from "@/lib/api";

export async function setupAndroidPushNotifications(onTap?: (url: string) => void) {
  if (typeof window === "undefined" || Capacitor.getPlatform() === "web") {
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

    await PushNotifications.register();

    const listeners = [
      await PushNotifications.addListener("registration", (token) => {
        const clientId = getClientId();
        if (!clientId) {
          return;
        }

        void registerDeviceToken({
          clientId,
          token: token.value,
          platform: Capacitor.getPlatform(),
        }).catch(() => {});
      }),
      await PushNotifications.addListener("registrationError", (error) => {
        console.error("push registration error", error);
      }),
      await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const targetUrl = String(action.notification.data?.targetUrl ?? "").trim();
        if (targetUrl && onTap) {
          onTap(targetUrl);
        }
      }),
      await PushNotifications.addListener("pushNotificationReceived", () => {
        // The in-app bell will refresh from the backend poller.
      }),
    ];

    return async () => {
      await Promise.all(listeners.map((listener) => listener.remove()));
    };
  } catch (error) {
    console.error("push setup failed", error);
    return () => {};
  }
}
