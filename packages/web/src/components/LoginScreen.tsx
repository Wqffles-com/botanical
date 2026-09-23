import type { DeploymentMode } from "@botanical/core";
import { useState } from "react";
import { Mark } from "./Mark";
import { SettingsBadge } from "./SettingsBadge";

export function BootScreen() {
  return (
    <main className="bc-login">
      <p className="bc-boot">Opening Botanical…</p>
    </main>
  );
}

export function LoginScreen({
  mode,
  error,
  pending,
  onSubmit,
}: {
  mode: DeploymentMode | null;
  error: string | null;
  pending: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <main className="bc-login">
      <form
        data-testid="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && password.trim()) onSubmit(password);
        }}
      >
        <div className="bc-login-mark">
          <Mark size={36} />
        </div>
        <div>
          <h1>Botanical</h1>
          <p className="bc-lede">Unlock the server to reach your agents.</p>
        </div>
        {mode ? <SettingsBadge mode={mode} /> : null}
        <label className="bc-field">
          <span>Passcode</span>
          <input
            data-testid="passcode"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? (
          <p role="alert" data-testid="login-error" className="bc-banner">
            {error}
          </p>
        ) : null}
        <button className="bc-button" type="submit" disabled={pending || password.trim().length === 0}>
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
