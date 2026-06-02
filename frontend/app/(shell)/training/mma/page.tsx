import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { GloveIcon } from "@/components/icons";

export default function MmaPage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Entrenamiento MMA"
        icon={<GloveIcon className="h-8 w-8" />}
        description="Elige arte marcial, técnica o intensidad, y habla con tu coach IA."
      />
    </div>
  );
}
