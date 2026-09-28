"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/** Ends the session and returns to the login page. */
export function useSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.logout();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign out.");
      setSigningOut(false);
    }
  }, [router]);

  return { signOut, signingOut };
}
