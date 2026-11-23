from django.core.management.base import BaseCommand, CommandError

from coaching import translation
from coaching.translation_loader import TRANSLATIONS_DIR, TranslationError, load_translations


class Command(BaseCommand):
    help = (
        "Carga las traducciones de las reglas desde knowledge_translations/<lang>/ en la BD. "
        "Idempotente y sin llamadas a ninguna API. Va después de load_knowledge (las reglas "
        "deben estar cargadas): las entradas cuyo source_hash ya no es el de la regla quedan stale."
    )

    def add_arguments(self, parser):
        parser.add_argument("--lang", required=True, help="Idioma (por ahora: es).")
        parser.add_argument("--dir", default=None, help="Carpeta raíz de las traducciones (por defecto, knowledge_translations/).")
        parser.add_argument("--dry-run", action="store_true", help="Informa sin guardar nada.")

    def handle(self, *args, **opts):
        lang = opts["lang"]
        if lang not in translation.LANGUAGES:
            raise CommandError(f"idioma no soportado: {lang} (disponibles: {', '.join(translation.LANGUAGES)})")
        try:
            r = load_translations(opts["dir"] or TRANSLATIONS_DIR, lang, dry_run=opts["dry_run"])
        except TranslationError as exc:
            raise CommandError(str(exc)) from exc
        prefix = "(dry-run, sin guardar) " if opts["dry_run"] else ""
        self.stdout.write(f"{prefix}traducciones ({lang}): {r.created} altas, {r.updated} cambios ({r.unchanged} sin cambios)")
        if r.stale_keys:
            self.stdout.write(self.style.WARNING(
                f"obsoletas (la regla cambió desde que se tradujo): {len(r.stale_keys)}: {', '.join(r.stale_keys[:5])}"
            ))
        if r.unknown_keys:
            self.stdout.write(self.style.WARNING(f"entradas sin regla: {', '.join(r.unknown_keys[:5])}"))
        if r.missing:
            self.stdout.write(self.style.WARNING(f"reglas vigentes sin traducción al día: {r.missing}"))
