import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { TrainingIcon } from "@/components/icons";

export default function GymPage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Gimnasio"
        icon={<TrainingIcon className="h-8 w-8" />}
        description="Calendario semanal y creador de rutinas con IA."
      />
    </div>
  );
}
