"use client";

import type { Health } from "@botanical/core";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Mark, Wordmark } from "@/components/logo";
import { DeploymentBadge } from "@/components/settings/deployment-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { Label } from "@botanical/ui/components/label";
import { api } from "@/lib/api";
import { loginErrorText, passwordClientError } from "@/lib/login-errors";
import { fetchHealth } from "@/lib/mvp-api";

type AuthConfig = { signupMode: "open" | "invite" | "closed"; hasUsers: boolean; canSignup: boolean };

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Mark className="size-10 animate-pulse" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite") ?? "";
  const reset = searchParams.get("reset") ?? "";
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((meta) => {
      if (!cancelled) setHealth(meta);
    });
    fetch("/api/auth/config")
      .then((response) => response.json())
      .then((body: AuthConfig) => {
        if (cancelled) return;
        setConfig(body);
        setMode(body.hasUsers ? "login" : "signup");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const signupOpen = config ? config.signupMode !== "closed" && (config.canSignup || Boolean(invite)) : true;
  const signingUp = mode === "signup" && !reset;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reset && !email.trim()) {
      setError("Enter your email.");
      return;
    }
    const clientError = passwordClientError(password, signingUp || Boolean(reset));
    if (clientError) {
      setError(clientError);
      return;
    }
    if (signingUp && !displayName.trim()) {
      setError("Enter a display name.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      if (reset) {
        const response = await fetch("/api/auth/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: reset, password }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? "Could not reset the password.");
        }
      } else if (signingUp) {
        await api.signup({
          email,
          password,
          displayName,
          ...(invite ? { inviteToken: invite } : {}),
        });
      } else {
        await api.login({ email, password });
      }
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (cause) {
      setError(loginErrorText(cause));
    } finally {
      setPending(false);
    }
  }

  const brand = health?.brandName ?? "Botanical";

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-background px-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Mark className="size-12" />
          <Wordmark className="mt-4 text-4xl" />
          <p className="mt-2 text-sm text-muted-foreground">Always-on agent server. Any model.</p>
        </div>
        <Card className="bg-card">
          <CardContent className="px-5">
            <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3" data-testid="login-form">
              {signingUp ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="display-name">Name</Label>
                  <Input
                    id="display-name"
                    data-testid="display-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    autoFocus
                  />
                </div>
              ) : null}
              {reset ? (
                <p className="text-sm text-muted-foreground" data-testid="reset-notice">
                  Choose a new password. You will be signed out of every other device.
                </p>
              ) : null}
              {reset ? null : (
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  data-testid="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError(null);
                  }}
                  autoFocus={!signingUp}
                />
              </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="password">{reset ? "New password" : "Password"}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    data-testid="password"
                    type={show ? "text" : "password"}
                    autoComplete={signingUp || reset ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError(null);
                    }}
                    className="pr-10"
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              {error ? (
                <p id="login-error" role="alert" data-testid="login-error" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {!reset && config && !signupOpen && signingUp ? (
                <p className="text-sm text-muted-foreground">Signup is closed.</p>
              ) : null}
              <Button type="submit" disabled={pending || (signingUp && !signupOpen)} className="w-full" data-testid="submit-auth">
                {pending ? "Checking…" : reset ? "Set new password" : signingUp ? (config?.hasUsers ? "Create account" : "Create admin account") : "Sign in"}
              </Button>
              {!reset && config?.hasUsers && signupOpen ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => {
                    setMode(signingUp ? "login" : "signup");
                    setError(null);
                  }}
                >
                  {signingUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
                </button>
              ) : null}
              {!reset && config?.hasUsers && !signupOpen ? (
                <p className="text-xs text-muted-foreground" data-testid="signup-closed">
                  {config.signupMode === "invite"
                    ? "Signup is invite-only. Use the link an admin sent you."
                    : "Signup is closed."}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <DeploymentBadge mode={health?.mode ?? null} />
          <span>{brand}</span>
        </div>
      </div>
    </div>
  );
}
