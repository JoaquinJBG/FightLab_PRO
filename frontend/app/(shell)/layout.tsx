import { TabBar } from "@/components/tab-bar";
import { OnboardingGate } from "@/components/onboarding-gate";
import { ServerWarmup } from "@/components/server-warmup";
import { StateRejectedNotice } from "@/components/state-rejected-notice";
import { OfflineNotice } from "@/components/offline-notice";
import { WeighMigrate } from "@/components/weigh-migrate";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <ServerWarmup />
      <StateRejectedNotice />
      <OfflineNotice />
      <main className="safe-top flex-1 px-4 pb-28 [@media(orientation:landscape)_and_(max-height:500px)]:pb-16">
        <OnboardingGate>{children}</OnboardingGate>
      </main>
      <WeighMigrate />
      <TabBar />
    </div>
  );
}
