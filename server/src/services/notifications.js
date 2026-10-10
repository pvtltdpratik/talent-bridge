import { notifications } from '../repositories/system.js';
import { notFound } from '../utils/errors.js';
import { pageResult } from '../utils/helpers.js';

export const notificationService = {
  async list(user, { unreadOnly }, paging) {
    const [{ items, total }, unread] = await Promise.all([
      notifications.list(user.id, { unreadOnly, limit: paging.limit, offset: paging.offset }),
      notifications.unreadCount(user.id),
    ]);
    return { ...pageResult(items, total, paging), unreadCount: unread };
  },
  unreadCount: async (user) => ({ unreadCount: await notifications.unreadCount(user.id) }),
  async markRead(user, id) {
    if (!(await notifications.markRead(user.id, id))) throw notFound('Notification not found or already read');
    return { id, read: true };
  },
  async markAllRead(user) {
    await notifications.markAllRead(user.id);
    return { ok: true };
  },
};
