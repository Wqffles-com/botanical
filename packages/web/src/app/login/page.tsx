"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { errorText } from "@/lib/errors";
import { Sprout } from "lucide-react";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const { login, error: bootError, mode } = useWorkspace();
  const [passcode, setPasscode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(passcode);
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Sprout className="size-5 text-primary" />
            <span className="font-heading text-xl">Botanical</span>
          </div>
          <CardTitle>Enter passcode</CardTitle>
          <CardDescription>
            Unlock this {mode === "SAAS" ? "hosted" : "self-hosted"} server. The session is a cookie; there is no default model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="passcode">Passcode</Label>
              <Input
                id="passcode"
                type="password"
                autoFocus
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error || bootError ? (
              <p role="alert" className="text-sm text-destructive">
                {error || bootError}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending || !passcode.trim()}>
              {pending ? "Unlocking…" : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
