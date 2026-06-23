let firebasePromise = null;

function getServiceAccountConfig() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  };
}

async function getFirebaseMessaging() {
  if (firebasePromise) {
    return firebasePromise;
  }

  const serviceAccount = getServiceAccountConfig();
  if (!serviceAccount) {
    return null;
  }

  firebasePromise = (async () => {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      });
    }

    return getMessaging();
  })();

  return firebasePromise;
}

export async function sendMulticastPush({ tokens, title, body, data = {} }) {
  const messaging = await getFirebaseMessaging();
  if (!messaging || !Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  return messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    android: {
      priority: "high",
      notification: {
        channelId: "atlas-updates",
      },
    },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [String(key), String(value)]),
    ),
  });
}
