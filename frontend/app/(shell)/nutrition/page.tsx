import { ModulePlaceholder } from "@/components/placeholder";
import { NutritionIcon } from "@/components/icons";

export default function NutritionPage() {
  return (
    <ModulePlaceholder
      tag="Módulo 3"
      title="Nutrición"
      icon={<NutritionIcon className="h-8 w-8" />}
      description="Macros periodizados por bloque, registro de comidas y conteo de kcal a partir de una foto del plato."
    />
  );
}
