import { ModulePlaceholder } from "@/components/placeholder";
import { ProfileIcon } from "@/components/icons";

export default function ProfilePage() {
  return (
    <ModulePlaceholder
      tag="Módulo 1"
      title="Perfil"
      icon={<ProfileIcon className="h-8 w-8" />}
      description="Tus datos antropométricos, stance, unidades y preferencias. Conectado a la API de auth (M1)."
    />
  );
}
