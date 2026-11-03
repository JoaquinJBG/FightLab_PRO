"""Carga de la base de evidencia al arrancar, solo si cambió su contenido.

Cada conjunto (`KnowledgeSet`) es una carpeta de archivos y la función que la carga. Su huella
es el sha256 de los archivos (ruta relativa + bytes) y de `LOADER_VERSION`; se guarda en
`KnowledgeSync` tras cargarlo bien. Con la misma huella no se toca la base de datos más que
para leerla, así que un arranque sin cambios tarda una fracción de segundo.

Para añadir otro conjunto basta con otra entrada en `knowledge_sets()` con su carpeta, sus
patrones y su cargador. Los conjuntos se cargan en orden: uno que dependa de otro (las
traducciones, de las reglas) va después y lleva `reload_after_previous`: se vuelve a cargar si se
cargó alguno de los anteriores, aunque sus archivos no hayan cambiado (el estado de una
traducción, al día o desfasada, depende del texto de la regla).
"""
import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from coach import knowledge as coach_knowledge
from django.conf import settings

from .knowledge_loader import load_knowledge
from .models import KnowledgeRule, KnowledgeSync
from .translation_loader import TRANSLATIONS_DIR, load_translations

logger = logging.getLogger(__name__)

# Súbelo si cambia la forma de cargar (no los archivos): fuerza una recarga en el próximo arranque.
LOADER_VERSION = "1"


@dataclass(frozen=True)
class KnowledgeSet:
    name: str
    directory: Path
    load: Callable[[Path], object]
    patterns: tuple[str, ...] = ("*.md",)
    reload_after_previous: bool = False

    def files(self) -> list[Path]:
        found = {p for pattern in self.patterns for p in self.directory.glob(pattern) if p.is_file()}
        return sorted(found)

    def content_hash(self) -> str:
        digest = hashlib.sha256(f"loader:{LOADER_VERSION}\n".encode())
        for path in self.files():
            digest.update(path.relative_to(self.directory).as_posix().encode("utf-8") + b"\0")
            digest.update(path.read_bytes() + b"\0")
        return digest.hexdigest()


def knowledge_sets() -> list[KnowledgeSet]:
    return [
        KnowledgeSet(
            "upstream",
            Path(coach_knowledge.KNOWLEDGE_DIR),
            lambda d: load_knowledge(d, origin=KnowledgeRule.Origin.UPSTREAM),
        ),
        KnowledgeSet(
            "fightlab",
            Path(settings.BASE_DIR) / "knowledge_fightlab",
            lambda d: load_knowledge(d, origin=KnowledgeRule.Origin.FIGHTLAB),
        ),
        # Traducciones al español de las reglas de los dos conjuntos anteriores (archivos, sin API)
        KnowledgeSet(
            "translations-es",
            TRANSLATIONS_DIR,
            lambda d: load_translations(d, "es"),
            patterns=("es/**/*.yaml",),
            reload_after_previous=True,
        ),
    ]


@dataclass
class SyncResult:
    name: str
    status: str  # "unchanged" | "loaded" | "failed"
    report: object = None
    error: str = ""


def sync_knowledge(sets: list[KnowledgeSet] | None = None, *, force: bool = False) -> list[SyncResult]:
    """Carga los conjuntos cuya huella cambió. Un fallo se registra en el log y no para el resto
    (salvo los que van detrás, que podrían depender de él) ni lanza: el arranque debe seguir."""
    results: list[SyncResult] = []
    for kset in sets if sets is not None else knowledge_sets():
        if any(r.status == "failed" for r in results):
            results.append(SyncResult(kset.name, "failed", error="no se carga: falló un conjunto anterior"))
            continue
        try:
            new_hash = kset.content_hash()
            saved = KnowledgeSync.objects.filter(name=kset.name).values_list("content_hash", flat=True).first()
            previous_loaded = any(r.status == "loaded" for r in results)
            if saved == new_hash and not force and not (kset.reload_after_previous and previous_loaded):
                results.append(SyncResult(kset.name, "unchanged"))
                continue
            report = kset.load(kset.directory)
            KnowledgeSync.objects.update_or_create(name=kset.name, defaults={"content_hash": new_hash})
            results.append(SyncResult(kset.name, "loaded", report=report))
        except Exception as exc:  # el arranque no se cae por la evidencia
            logger.exception("No se pudo cargar la base de evidencia '%s'", kset.name)
            results.append(SyncResult(kset.name, "failed", error=f"{type(exc).__name__}: {exc}"))
    return results


def summary(report) -> str:
    """Una línea con lo que cambió, para el informe de reglas (`Report`) o el de traducciones."""
    if hasattr(report, "rules_created"):
        return (
            f"{report.rules_created} altas, {report.rules_updated} cambios, "
            f"{report.rules_retired} bajas de reglas"
        )
    return (
        f"{report.created} altas, {report.updated} cambios, {len(report.stale_keys)} desfasadas, "
        f"{report.missing} reglas sin traducción al día"
    )
