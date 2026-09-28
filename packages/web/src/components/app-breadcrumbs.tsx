"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment } from "react";
import { useWorkspace } from "@/components/workspace-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@botanical/ui/components/breadcrumb";

type Crumb = { label: string; href?: string };

const SETTINGS_TABS: Record<string, string> = {
  profiles: "Profiles",
  memory: "Memory",
  roles: "Roles & permissions",
  cli: "Coding CLIs",
  admin: "Admin",
};

const SECTIONS: Record<string, string> = {
  inbox: "Inbox",
  routines: "Routines",
  listeners: "Listeners",
};

/** Where you are, derived from the route and workspace names. */
export function AppBreadcrumbs() {
  const crumbs = useCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? <BreadcrumbSeparator className={last ? undefined : "hidden sm:block"} /> : null}
              <BreadcrumbItem className={last ? "min-w-0" : "hidden sm:inline-flex"}>
                {last || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function useCrumbs(): Crumb[] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { agents, chats } = useWorkspace();
  const [section, id] = pathname.split("/").filter(Boolean);

  if (!section) return [];
  if (section in SECTIONS) return [{ label: SECTIONS[section]! }];
  if (section === "settings") {
    const tab = SETTINGS_TABS[searchParams.get("tab") ?? ""];
    return tab ? [{ label: "Settings", href: "/settings" }, { label: tab }] : [{ label: "Settings" }];
  }
  if (section === "agents") {
    if (!id) return [{ label: "Agents" }];
    const name = id === "new" ? "New agent" : (agents.find((agent) => agent.id === id)?.name ?? "Agent");
    return [{ label: "Agents", href: "/agents" }, { label: name }];
  }
  if (section === "chats") {
    if (!id || id === "new") return [{ label: "New chat" }];
    const chat = chats.find((item) => item.id === id);
    const agent = chat ? agents.find((item) => item.id === chat.agentId) : undefined;
    const trail: Crumb[] = [];
    if (agent) trail.push({ label: agent.name, href: `/agents/${agent.id}` });
    trail.push({ label: chat?.title || "Chat" });
    return trail;
  }
  return [];
}
