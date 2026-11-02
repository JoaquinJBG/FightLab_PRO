import { TabBar } from "@/components/tab-bar";
import { OnboardingGate } from "@/components/onboarding-gate";
import { WeighMigrate } from "@/components/weigh-migrate";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="safe-top flex-1 px-4 pb-28">
        <OnboardingGate>{children}</OnboardingGate>
      </main>
      <WeighMigrate />
      <TabBar />
    </div>
  );
}
