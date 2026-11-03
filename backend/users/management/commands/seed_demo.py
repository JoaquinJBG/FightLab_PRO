from django.core.management.base import BaseCommand

from users.demo import seed_demo


class Command(BaseCommand):
    help = (
        "Crea o actualiza el usuario de demostración de un entorno de prueba (DEMO_USER_EMAIL y "
        "DEMO_USER_PASSWORD) con datos inventados. Sin esas variables no hace nada. Nunca en producción."
    )

    def handle(self, *args, **opts):
        result = seed_demo()
        line = f"seed_demo: {result.message}"
        if result.sections:
            line += " (" + ", ".join(f"{k}: {v}" for k, v in result.sections.items()) + ")"
        if result.status == "refused":
            self.stderr.write(line)
        else:
            self.stdout.write(line)
