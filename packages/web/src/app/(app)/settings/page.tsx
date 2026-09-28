import { pageContainerVariants } from "@botanical/ui/components/page-container";
import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";
import { Skeleton } from "@botanical/ui/components/skeleton";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className={pageContainerVariants()}>
          <Skeleton className="h-8 w-40" />
        </div>
      }
    >
      <SettingsView />
    </Suspense>
  );
}
