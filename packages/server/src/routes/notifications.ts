import { HttpError, json } from "../http.ts";
import { authed, type Router } from "../router.ts";
import { requireParam } from "../validate.ts";
import { readPage } from "./routines.ts";

export function registerNotifications(router: Router): void {
  router.add(
    "GET",
    "/api/notifications",
    authed(async (ctx) => {
      const page = readPage(ctx.url);
      const [notifications, unreadCount] = await Promise.all([
        ctx.store.notifications.list(page),
        ctx.store.notifications.unreadCount(),
      ]);
      return json(200, { notifications, unreadCount });
    }),
  );

  router.add(
    "POST",
    "/api/notifications/read-all",
    authed(async (ctx) => {
      const updated = await ctx.store.notifications.markAllRead(ctx.now);
      return json(200, { updated });
    }),
  );

  router.add(
    "POST",
    "/api/notifications/:id/read",
    authed(async (ctx) => {
      const notification = await ctx.store.notifications.markRead(requireParam(ctx.params, "id"), ctx.now);
      if (!notification) throw new HttpError(404, "not_found", "Notification not found");
      return json(200, { notification });
    }),
  );
}
