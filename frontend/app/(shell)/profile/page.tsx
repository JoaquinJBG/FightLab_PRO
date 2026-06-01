"use client";

import { useRouter } from "next/navigation";
import { useMe, useLogout } from "@/lib/hooks";
import { ProfileForm } from "@/components/profile-form";

export default function ProfilePage() {
  const router = useRouter();
  const { data: me } = useMe();
  const logout = useLogout();

  async function onLogout() {
    await logout.mutateAsync();
    router.push("/login");
  }

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">Perfil</h1>

      <section className="glass rise mt-5 p-5" style={{ animationDelay: "40ms" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full glass font-display text-neon">
            {me?.email ? me.email[0].toUpperCase() : "?"}
          </div>
          <div>
            <p className="t-body text-ink">{me?.email ?? "—"}</p>
            <span className="badge badge-neon mt-1">{me?.role ?? "—"}</span>
          </div>
        </div>
      </section>

      <section className="rise mt-5" style={{ animationDelay: "100ms" }}>
        <p className="t-eyebrow mb-2 text-muted">Datos personales</p>
        <ProfileForm submitLabel="Guardar cambios" onSaved={() => {}} />
      </section>

      <button onClick={onLogout} className="btn btn-outline mt-6 w-full">
        Cerrar sesión
      </button>
    </div>
  );
}
