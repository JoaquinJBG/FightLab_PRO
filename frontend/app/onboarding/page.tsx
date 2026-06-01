"use client";

import { useRouter } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";

export default function OnboardingPage() {
  const router = useRouter();
  return (
    <div className="mx-auto w-full max-w-md px-6 safe-top pb-16">
      <header className="pt-8">
        <p className="t-eyebrow text-neon">Bienvenido a FightLab</p>
        <h1 className="t-display mt-2 text-3xl text-ink">
          Cuéntanos <span className="neon-text">sobre ti</span>
        </h1>
        <p className="t-body mt-2 text-muted">
          Estos datos personalizan tus métricas (zonas, objetivos). Puedes cambiarlos cuando quieras.
        </p>
      </header>
      <div className="mt-6">
        <ProfileForm submitLabel="Continuar" onSaved={() => router.push("/dashboard")} />
      </div>
    </div>
  );
}
