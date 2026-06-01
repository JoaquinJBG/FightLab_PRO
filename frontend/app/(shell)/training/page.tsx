import { ModulePlaceholder } from "@/components/placeholder";
import { TrainingIcon } from "@/components/icons";

export default function TrainingPage() {
  return (
    <ModulePlaceholder
      tag="Módulo 2"
      title="Entrenamiento"
      icon={<TrainingIcon className="h-8 w-8" />}
      description="Registra sparring, fuerza y cardio. El motor calculará tu carga (sRPE), monotonía y ACWR automáticamente."
    />
  );
}
