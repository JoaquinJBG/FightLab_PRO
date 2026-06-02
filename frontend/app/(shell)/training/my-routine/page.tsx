import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { ClipboardIcon } from "@/components/icons";

export default function MyRoutinePage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Mi rutina"
        icon={<ClipboardIcon className="h-8 w-8" />}
        description="La rutina que te asigna tu entrenador, dentro de la app."
      />
    </div>
  );
}
