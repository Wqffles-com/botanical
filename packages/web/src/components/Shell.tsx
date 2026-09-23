import type { DeploymentMode } from "@botanical/core";
import type { ReactNode } from "react";
import { Mark } from "./Mark";
import { SettingsBadge } from "./SettingsBadge";

export function Shell({
  mode,
  navOpen,
  onToggleNav,
  onLogout,
  sidebar,
  children,
}: {
  mode: DeploymentMode | null;
  navOpen: boolean;
  onToggleNav: () => void;
  onLogout: () => void;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={navOpen ? "bc-shell is-nav-open" : "bc-shell"}>
      <header className="bc-topbar">
        <button type="button" className="bc-nav-toggle" aria-expanded={navOpen} onClick={onToggleNav}>
          Chats
        </button>
        <span className="bc-brand">
          <Mark size={22} />
          Botanical
        </span>
        <span className="bc-topbar-spacer" />
        {mode ? <SettingsBadge mode={mode} /> : null}
        <button type="button" className="bc-button bc-button--quiet" data-testid="logout" onClick={onLogout}>
          Log out
        </button>
      </header>
      <div className="bc-body">
        <aside className="bc-sidebar">{sidebar}</aside>
        {navOpen ? (
          <button type="button" className="bc-scrim" aria-label="Close chats" onClick={onToggleNav} />
        ) : null}
        <section className="bc-main">{children}</section>
      </div>
    </div>
  );
}
