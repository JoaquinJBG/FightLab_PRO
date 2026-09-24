"use client";

import Link from "next/link";
import { ClipboardIcon } from "@/components/icons";

/* Beta honesta: aquí antes había una rutina de ejemplo con datos inventados
   (coach y plan semanal ficticios). Hasta que exista un panel de coach real
   que asigne rutinas, mostramos un estado "Próximamente" sin datos falsos. */
export default function MyRoutinePage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Mi rutina</h1>

      <div className="glass neon-edge mt-4 flex flex-col items-center gap-3 p-6 text-center">
        <span className="text-neon glow flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
          <ClipboardIcon className="h-7 w-7" />
        </span>
        <span className="badge badge-neon">Próximamente</span>
        <p className="t-title text-ink">Rutina asignada por tu coach</p>
        <p className="t-body text-sm text-muted">
          Todavía no hay un coach asignándote una rutina desde la app. Cuando el panel del
          entrenador esté disponible, la verás aquí. Mientras tanto, monta tu semana a mano
          en Entreno → Gimnasio.
        </p>
      </div>
    </div>
  );
}
