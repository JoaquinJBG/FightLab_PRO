import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { RunIcon } from "@/components/icons";

export default function SportsPage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Deportes predefinidos"
        icon={<RunIcon className="h-8 w-8" />}
        description="Elige tu deporte y registra la sesión con estimación de kcal quemadas."
      />
    </div>
  );
}
