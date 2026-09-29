"use client";

import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAppDialogs } from "@/components/app-dialogs";
import { useWorkspace } from "@/components/workspace-provider";
import { Avatar, AvatarFallback } from "@botanical/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@botanical/ui/components/dropdown-menu";
import { useSignOut } from "@/hooks/use-sign-out";
import { initials } from "@/lib/format";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Signed-in account as a round avatar in the sidebar footer: settings, theme, and sign out. */
export function NavUser() {
  const { me } = useWorkspace();
  const { openSettings } = useAppDialogs();
  const { theme, setTheme } = useTheme();
  const { signOut, signingOut } = useSignOut();

  const name = me?.user?.displayName || me?.brandName || "Botanical";
  const detail = me?.user?.email ?? (me?.mode === "SAAS" ? "Hosted" : "Self-host");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="nav-user"
        aria-label={`Account: ${name}`}
        title={name}
        className="flex size-9 shrink-0 items-center justify-center rounded-full outline-none ring-sidebar-ring transition-shadow hover:ring-2 focus-visible:ring-2 data-popup-open:ring-2"
      >
        <Avatar className="size-9">
          <AvatarFallback className="bg-sidebar-accent text-xs font-medium">{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-60" side="top" align="start" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2 px-1.5 py-1.5 font-normal">
            <Avatar className="size-8 rounded-lg after:rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-medium">{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium text-foreground">{name}</span>
              <span className="truncate text-xs">{detail}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openSettings()}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={signingOut} onClick={() => void signOut()}>
          <LogOut />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
