"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";

export default function ProfileEditPage() {
  const router = useRouter();
  return (
    <div className="pt-4">
      <Link href="/profile" className="t-label text-muted">
        ← Perfil
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">
        Editar <span className="neon-text">perfil</span>
      </h1>
      <div className="mt-5">
        <ProfileForm submitLabel="Guardar cambios" onSaved={() => router.push("/profile")} />
      </div>
    </div>
  );
}
