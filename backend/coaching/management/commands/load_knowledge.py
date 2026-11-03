from coach import knowledge as coach_knowledge
from django.core.management.base import BaseCommand, CommandError

from coaching.knowledge_loader import KnowledgeError, load_knowledge
from coaching.models import KnowledgeRule


class Command(BaseCommand):
    help = (
        "Carga la base de evidencia (reglas y fuentes) en la BD. Idempotente: informa de "
        "altas, cambios y bajas; las reglas que desaparecen se marcan como retiradas."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dir", default=None, help="Carpeta con *.md y sources.md (por defecto, la del motor).")
        parser.add_argument(
            "--origin",
            choices=[c for c, _ in KnowledgeRule.Origin.choices],
            default=KnowledgeRule.Origin.UPSTREAM,
            help="`upstream` (coach) o `fightlab` (anexo propio).",
        )

    def handle(self, *args, **opts):
        directory = opts["dir"] or coach_knowledge.KNOWLEDGE_DIR
        try:
            r = load_knowledge(directory, origin=opts["origin"])
        except KnowledgeError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            f"reglas: {r.rules_created} altas, {r.rules_updated} cambios, {r.rules_retired} bajas "
            f"({r.rules_unchanged} sin cambios)"
        )
        self.stdout.write(f"fuentes: {r.sources_created} altas, {r.sources_updated} cambios")
        if r.stale_translations:
            self.stdout.write(f"traducciones obsoletas: {r.stale_translations}")
        if r.missing_sources:
            self.stdout.write(self.style.WARNING(f"fuentes citadas que no existen: {', '.join(r.missing_sources)}"))
