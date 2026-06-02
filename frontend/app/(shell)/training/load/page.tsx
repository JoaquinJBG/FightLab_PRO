import Link from "next/link";
import { ModulePlaceholder } from "@/components/placeholder";
import { BoltIcon } from "@/components/icons";

export default function LoadPage() {
  return (
    <div className="pt-4">
      <Link href="/training" className="t-label text-muted">← Entreno</Link>
      <ModulePlaceholder
        tag="Entreno"
        title="Carga y estado"
        icon={<BoltIcon className="h-8 w-8" />}
        description="Carga semanal (sRPE), ACWR, monotonía/tensión y readiness."
      />
    </div>
  );
}
