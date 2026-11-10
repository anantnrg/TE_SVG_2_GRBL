export class NotificationHistory {
  constructor(limit = 50) {
    this.limit = limit;
    this.items = [];
  }

  add(message, error = false, createdAt = new Date()) {
    const notification = {
      id: crypto.randomUUID(),
      message,
      error,
      createdAt,
      read: false
    };
    this.items.unshift(notification);
    this.items.length = Math.min(this.items.length, this.limit);
    return notification;
  }

  markAllRead() {
    for (const notification of this.items) notification.read = true;
  }

  clear() {
    this.items.length = 0;
  }

  get unreadCount() {
    return this.items.reduce((count, notification) => count + Number(!notification.read), 0);
  }
}
