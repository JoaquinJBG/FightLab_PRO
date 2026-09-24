import { TabBar } from "@/components/tab-bar";
import { OnboardingGate } from "@/components/onboarding-gate";
import { ServerWarmup } from "@/components/server-warmup";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <ServerWarmup />
      <main className="safe-top flex-1 px-4 pb-28">
        <OnboardingGate>{children}</OnboardingGate>
      </main>
      <TabBar />
    </div>
  );
}
