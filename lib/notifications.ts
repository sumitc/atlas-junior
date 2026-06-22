export type AppNotification = {
  id: string;
  clientId: string;
  kind: string;
  title: string;
  body: string;
  targetUrl: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationInbox = {
  notifications: AppNotification[];
  unreadCount: number;
};
