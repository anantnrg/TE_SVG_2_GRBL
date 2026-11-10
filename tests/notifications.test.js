import test from "node:test";
import assert from "node:assert/strict";
import { NotificationHistory } from "../src/ui/notification-history.js";

test("notification history records errors and tracks unread entries", () => {
  const history = new NotificationHistory();
  history.add("Imported drawing", false, new Date("2026-01-01T10:00:00Z"));
  history.add("Unsupported SVG text was excluded.", true, new Date("2026-01-01T10:01:00Z"));

  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].error, true);
  assert.equal(history.unreadCount, 2);
  history.markAllRead();
  assert.equal(history.unreadCount, 0);
});

test("notification history keeps only the configured number of recent entries", () => {
  const history = new NotificationHistory(2);
  history.add("First");
  history.add("Second");
  history.add("Third");

  assert.deepEqual(history.items.map(({ message }) => message), ["Third", "Second"]);
});

test("clearing notifications removes history and unread count", () => {
  const history = new NotificationHistory();
  history.add("Export ready");
  history.clear();

  assert.equal(history.items.length, 0);
  assert.equal(history.unreadCount, 0);
});
