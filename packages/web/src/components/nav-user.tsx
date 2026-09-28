"use client";

import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@botanical/ui/components/sidebar";
import { useSignOut } from "@/hooks/use-sign-out";
import { initials } from "@/lib/format";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Signed-in account in the sidebar footer: settings, theme, and sign out. */
export function NavUser() {
  const { me } = useWorkspace();
  const { isMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const { signOut, signingOut } = useSignOut();

  const name = me?.user?.displayName || me?.brandName || "Botanical";
  const detail = me?.user?.email ?? (me?.mode === "SAAS" ? "Hosted" : "Self-host");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                data-testid="nav-user"
              />
            }
          >
            <Avatar className="size-8 rounded-lg after:rounded-lg">
              <AvatarFallback className="rounded-lg text-xs font-medium">{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{detail}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
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
            <DropdownMenuItem render={<Link href="/settings" />}>
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
