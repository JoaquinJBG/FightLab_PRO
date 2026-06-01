"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMe, useProfile, useLogout } from "@/lib/hooks";

const GENDER: Record<string, string> = { MALE: "Hombre", FEMALE: "Mujer", OTHER: "Otro" };
const STANCE: Record<string, string> = { ORTHODOX: "Ortodoxo", SOUTHPAW: "Zurdo", SWITCH: "Switch" };
const UNITS: Record<string, string> = { METRIC: "Métrico", IMPERIAL: "Imperial" };

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
  const { data: profile } = useProfile();
  const logout = useLogout();

  async function onLogout() {
    await logout.mutateAsync();
    router.push("/login");
  }

  const dash = (x?: string | number | null) => (x === null || x === undefined || x === "" ? "—" : String(x));

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

      <section className="glass rise mt-4 px-5 py-2" style={{ animationDelay: "100ms" }}>
        <Row label="Fecha de nacimiento" value={dash(profile?.date_of_birth)} />
        <Row label="Sexo" value={dash(profile?.gender ? GENDER[profile.gender] : null)} />
        <Row label="Altura" value={profile?.height_cm != null ? `${profile.height_cm} cm` : "—"} />
        <Row label="Guardia" value={dash(profile?.dominant_stance ? STANCE[profile.dominant_stance] : null)} />
        <Row label="Unidades" value={dash(profile?.preferred_units ? UNITS[profile.preferred_units] : null)} />
      </section>

      <Link href="/profile/edit" className="btn btn-tonal mt-4 w-full">
        Editar perfil
      </Link>
      <button onClick={onLogout} className="btn btn-outline mt-3 w-full">
        Cerrar sesión
      </button>
    </div>
  );
}
