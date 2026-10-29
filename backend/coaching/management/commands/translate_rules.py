import anthropic
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from ai.services import AIBadResponse, AIUnavailable, _client
from coaching import translation


class Command(BaseCommand):
    help = (
        "Traduce las reglas de evidencia con el LLM (status=machine). Llama a la API de "
        "Anthropic y cuesta dinero: usa --dry-run para ver cuántas reglas faltan sin llamar. "
        "Las reglas que citan el motor (safety, energy, macros, zones, trend) van primero."
    )

    def add_arguments(self, parser):
        parser.add_argument("--lang", required=True, help="Idioma destino (por ahora: es).")
        parser.add_argument("--limit", type=int, default=None, help="Máximo de reglas a traducir.")
        parser.add_argument("--priority-only", action="store_true", help="Solo las reglas que cita el motor.")
        parser.add_argument("--force", action="store_true", help="Volver a traducir también las que están al día.")
        parser.add_argument("--dry-run", action="store_true", help="Cuenta lo pendiente sin llamar a la API.")

    def handle(self, *args, **opts):
        lang = opts["lang"]
        if lang not in translation.LANGUAGES:
            raise CommandError(f"idioma no soportado: {lang} (disponibles: {', '.join(translation.LANGUAGES)})")
        todo = translation.pending_rules(lang, force=opts["force"], priority_only=opts["priority_only"])
        if opts["limit"] is not None:
            todo = todo[: opts["limit"]]
        if opts["dry_run"]:
            self.stdout.write(f"{len(todo)} reglas pendientes de traducir al {lang} (dry-run: no se llama a la API)")
            return
        if not settings.ANTHROPIC_API_KEY:
            raise CommandError("falta ANTHROPIC_API_KEY: la traducción usa la API de Anthropic")

        client = _client(timeout=60.0)
        done, failed = 0, []
        for rule in todo:
            try:
                fields = translation.translate_rule(rule, lang, client=client)
            except (AIBadResponse, AIUnavailable, anthropic.APIError) as exc:
                failed.append(rule.key)
                self.stderr.write(f"{rule.key}: {exc}")
                continue
            translation.save_translation(rule, lang, fields)
            done += 1
        self.stdout.write(f"traducidas: {done}")
        self.stdout.write(f"fallidas: {len(failed)}")
        if failed:
            self.stdout.write("Vuelve a lanzar el comando para reintentar las fallidas.")
