import { ModulePlaceholder } from "@/components/placeholder";
import { CoachIcon } from "@/components/icons";

export default function CoachPage() {
  return (
    <ModulePlaceholder
      tag="Módulo 4"
      title="Coach IA"
      icon={<CoachIcon className="h-8 w-8" />}
      description="Tu coach genera rutinas y dietas, lee tu contexto (fatiga, ACWR) y propone ajustes proactivos. Chat con Claude."
    />
  );
}
