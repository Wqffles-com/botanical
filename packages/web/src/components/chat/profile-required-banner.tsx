import { AlertTriangle } from "lucide-react";
import { profileRequiredMessage } from "@/lib/errors";

export function ProfileRequiredBanner({ message }: { message?: string }) {
  return (
    <div
      role="alert"
      data-testid="profile-required"
      className="mx-auto flex w-full max-w-[760px] items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">Model profile required</p>
        <p className="text-destructive/90">{message || profileRequiredMessage()}</p>
      </div>
    </div>
  );
}
