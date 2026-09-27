import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Skeleton className="h-8 w-40" />
        </div>
      }
    >
      <SettingsView />
    </Suspense>
  );
}
