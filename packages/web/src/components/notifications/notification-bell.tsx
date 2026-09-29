"use client";

import type { AppNotification } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@botanical/ui/components/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@botanical/ui/components/popover";
import { Switch } from "@botanical/ui/components/switch";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { formatWhen } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "botanical.browser-notifications";
const POLL_MS = 20_000;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [browserOn, setBrowserOn] = useState(false);
  const browserOnRef = useRef(false);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);

  const load = useCallback(async () => {
    try {
      const page = await api.listNotifications({ limit: 20 });
      if (
        primed.current &&
        browserOnRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        for (const item of page.notifications) {
          if (item.readAt || seen.current.has(item.id)) continue;
          const notice = new Notification(item.title, { body: item.body });
          notice.onclick = () => {
            window.focus();
            if (item.chatId) router.push(`/chats/${item.chatId}`);
          };
        }
      }
      for (const item of page.notifications) seen.current.add(item.id);
      primed.current = true;
      setItems(page.notifications);
      setUnread(page.unreadCount);
      setError(null);
    } catch (err) {
      if (isUnauthorized(err)) return;
      setError(errorText(err));
    }
  }, [router]);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === "1";
    browserOnRef.current = stored;
    const paint = window.setTimeout(() => {
      setBrowserOn(stored);
      void load();
    }, 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(paint);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function enableBrowser(next: boolean) {
    if (!next) {
      browserOnRef.current = false;
      setBrowserOn(false);
      window.localStorage.setItem(STORAGE_KEY, "0");
      return;
    }
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    const granted = permission === "granted";
    browserOnRef.current = granted;
    setBrowserOn(granted);
    window.localStorage.setItem(STORAGE_KEY, granted ? "1" : "0");
  }

  async function openItem(item: AppNotification) {
    try {
      if (!item.readAt) await api.markNotificationRead(item.id);
    } catch (err) {
      if (!isUnauthorized(err)) setError(errorText(err));
    }
    setOpen(false);
    if (item.chatId) router.push(`/chats/${item.chatId}`);
    void load();
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      await load();
    } catch (err) {
      if (!isUnauthorized(err)) setError(errorText(err));
    }
  }

  const badge = unread > 9 ? "9+" : String(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative overflow-visible rounded-full text-muted-foreground hover:text-foreground"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        }
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs leading-none font-medium text-primary-foreground ring-2 ring-background">
            {badge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <PopoverHeader className="flex-row items-center justify-between gap-2 border-b px-3 py-2">
          <PopoverTitle>Notifications</PopoverTitle>
          <Button variant="ghost" size="sm" onClick={() => void markAll()} disabled={unread === 0}>
            Mark all read
          </Button>
        </PopoverHeader>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
          <span>Browser notifications</span>
          <Switch
            size="sm"
            checked={browserOn}
            aria-label="Browser notifications"
            onCheckedChange={(checked) => void enableBrowser(checked === true)}
          />
        </div>
        <div className="max-h-80 overflow-auto">
          {error ? <p className="px-3 py-2 text-xs text-destructive">{error}</p> : null}
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted",
                      !item.readAt && "bg-muted/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      {!item.readAt ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
                    </span>
                    {item.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span> : null}
                    <span className="text-2xs text-muted-foreground">{formatWhen(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
