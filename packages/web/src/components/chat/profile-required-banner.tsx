import { AlertTriangle } from "lucide-react";
import { profileRequiredMessage } from "@/lib/errors";

export function ProfileRequiredBanner({ message, title }: { message?: string; title?: string }) {
  return (
    <div
      role="alert"
      data-testid="profile-required"
      className="mx-auto flex w-full max-w-[760px] items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{title ?? "Model profile required"}</p>
        <p className="text-muted-foreground">{message || profileRequiredMessage()}</p>
      </div>
    </div>
  );
}
