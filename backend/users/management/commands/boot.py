"""`manage.py boot`: lo que hace el contenedor antes de gunicorn, en un solo proceso (fix G1-6).

Antes eran cuatro `python manage.py …` encadenados en el CMD del Dockerfile: cada uno cargaba
Django y el motor del coach de nuevo. Aquí van con `call_command`:

1. `migrate` y `createcachetable`: si fallan, el arranque se para (como antes con `&&`).
2. `sync_knowledge --on-start` y, solo con `DEMO_USER_EMAIL`, `seed_demo`: si fallan, se registra
   el error y gunicorn arranca igual.
"""
import logging
import os

from django.core.management import call_command
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)

OPTIONAL = {
    "sync_knowledge": "se arranca sin recargar la base de evidencia",
    "seed_demo": "se arranca sin usuario de demostración",
}


class Command(BaseCommand):
    help = (
        "Arranque del contenedor en un proceso: migrate, createcachetable, sync_knowledge --on-start y, "
        "con DEMO_USER_EMAIL, seed_demo. Los dos últimos no paran el arranque si fallan."
    )

    def handle(self, *args, **opts):
        out = {"stdout": self.stdout, "stderr": self.stderr}
        call_command("migrate", interactive=False, **out)
        call_command("createcachetable", **out)
        self._optional("sync_knowledge", on_start=True)
        if (os.environ.get("DEMO_USER_EMAIL") or "").strip():
            self._optional("seed_demo")

    def _optional(self, name: str, **kwargs) -> None:
        try:
            call_command(name, stdout=self.stdout, stderr=self.stderr, **kwargs)
        except Exception:  # noqa: BLE001 - un paso opcional roto no tumba el arranque
            logger.exception("boot: %s ha fallado", name)
            self.stderr.write(f"{name} ha fallado: {OPTIONAL[name]}")
