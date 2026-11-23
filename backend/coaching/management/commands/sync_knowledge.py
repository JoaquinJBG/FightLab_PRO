from django.conf import settings
from django.core.management.base import BaseCommand

from coaching.knowledge_sync import summary, sync_knowledge


class Command(BaseCommand):
    help = (
        "Carga la base de evidencia (coach, anexo de combate y traducciones) solo si sus archivos cambiaron "
        "desde la última carga. Nunca falla: los errores van al log. Lo lanza el arranque del "
        "contenedor (backend/Dockerfile)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Carga aunque la huella no haya cambiado.")
        parser.add_argument(
            "--on-start",
            action="store_true",
            help="Modo arranque: no hace nada si KNOWLEDGE_SYNC_ON_START=False.",
        )

    def handle(self, *args, **opts):
        if opts["on_start"] and not settings.KNOWLEDGE_SYNC_ON_START:
            self.stdout.write("base de evidencia: carga al arrancar desactivada (KNOWLEDGE_SYNC_ON_START)")
            return
        for r in sync_knowledge(force=opts["force"]):
            if r.status == "unchanged":
                self.stdout.write(f"base de evidencia '{r.name}': sin cambios")
            elif r.status == "loaded":
                self.stdout.write(f"base de evidencia '{r.name}': cargada ({summary(r.report)})")
            else:
                self.stderr.write(f"base de evidencia '{r.name}': NO cargada ({r.error})")
