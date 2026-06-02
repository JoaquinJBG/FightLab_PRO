import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { TimerIcon } from "@/components/icons";

export default function ToolsPage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Herramientas"
        icon={<TimerIcon className="h-8 w-8" />}
        description="Cronómetro y temporizador de rounds (round / descanso)."
      />
    </div>
  );
}
