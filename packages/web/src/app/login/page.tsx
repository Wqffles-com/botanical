"use client";

import { BotanicalApiError } from "@botanical/core";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Mark, Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passcode, setPasscode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.login(passcode);
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof BotanicalApiError ? cause.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden px-4">
      <div className="login-orb -top-24 left-1/2 -translate-x-1/2" />
      <Vines />
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Mark className="size-12" />
          <Wordmark className="mt-4 text-[2.4rem]" />
          <p className="mt-2 text-sm text-muted-foreground">Personal agent server. Any brain.</p>
        </div>
        <Card className="hairline bg-card/90 backdrop-blur-sm">
          <CardContent className="px-5">
            <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="passcode">Passcode</Label>
                <div className="relative">
                  <Input
                    id="passcode"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    value={passcode}
                    onChange={(event) => setPasscode(event.target.value)}
                    placeholder="Server passcode"
                    className="pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={show ? "Hide passcode" : "Show passcode"}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending || passcode.trim().length < 4} className="w-full">
                {pending ? "Checking…" : "Continue"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Web → server only. Model keys never leave the host.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Vines() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.22]"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g fill="none" stroke="#8fca7a" strokeLinecap="round">
        <path d="M90 800C110 560 40 480 120 300c70-160-20-240 40-300" strokeWidth="1.1" />
        <path d="M1110 800c-40-220 70-300-20-470-80-150 30-230-10-330" strokeWidth="1.1" />
        <path d="M90 420c-50 10-70 70-40 90" strokeWidth="0.9" />
        <path d="M120 300c40-8 62 40 28 58" strokeWidth="0.9" />
        <path d="M1110 430c48 12 70 64 30 86" strokeWidth="0.9" />
        <path d="M1088 280c-44-10-60 38-24 56" strokeWidth="0.9" />
      </g>
    </svg>
  );
}
