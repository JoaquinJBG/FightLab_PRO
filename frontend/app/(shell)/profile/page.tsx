"use client";

import { useRouter } from "next/navigation";
import { useMe, useProfile, useLogout } from "@/lib/hooks";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[rgba(150,190,255,0.08)] py-3 last:border-0">
      <span className="t-label text-muted">{label}</span>
      <span className="t-body text-ink">{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: profile, isLoading } = useProfile();
  const logout = useLogout();

  async function onLogout() {
    await logout.mutateAsync();
    router.push("/login");
  }

  const v = (x: string | number | null | undefined, suffix = "") =>
    x === null || x === undefined || x === "" ? "—" : `${x}${suffix}`;

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">Perfil</h1>

      <section className="glass rise mt-5 p-5" style={{ animationDelay: "60ms" }}>
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

      <section className="glass rise mt-4 px-5 py-2" style={{ animationDelay: "120ms" }}>
        {isLoading ? (
          <p className="t-body py-4 text-muted">Cargando…</p>
        ) : (
          <>
            <Row label="Altura" value={v(profile?.height_cm, " cm")} />
            <Row label="Stance" value={v(profile?.dominant_stance)} />
            <Row label="Género" value={v(profile?.gender)} />
            <Row label="Nacimiento" value={v(profile?.date_of_birth)} />
            <Row label="Unidades" value={v(profile?.preferred_units)} />
            <Row label="Zona horaria" value={v(profile?.timezone)} />
          </>
        )}
      </section>

      <button onClick={onLogout} className="btn btn-outline mt-6 w-full">
        Cerrar sesión
      </button>
    </div>
  );
}
