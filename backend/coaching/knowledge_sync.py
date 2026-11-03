"""Carga de la base de evidencia al arrancar, solo si cambió su contenido.

Cada conjunto (`KnowledgeSet`) es una carpeta de archivos y la función que la carga. Su huella
es el sha256 de los archivos (ruta relativa + bytes) y de `LOADER_VERSION`; se guarda en
`KnowledgeSync` tras cargarlo bien. Con la misma huella no se toca la base de datos más que
para leerla, así que un arranque sin cambios tarda una fracción de segundo.

Para añadir otro conjunto (p. ej. los archivos de traducción de las reglas, cuando existan),
basta con otra entrada en `knowledge_sets()` con su carpeta, sus patrones y su cargador.
Los conjuntos se cargan en orden: uno que dependa de otro (las traducciones, de las reglas) va
después.
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

logger = logging.getLogger(__name__)

# Súbelo si cambia la forma de cargar (no los archivos): fuerza una recarga en el próximo arranque.
LOADER_VERSION = "1"


@dataclass(frozen=True)
class KnowledgeSet:
    name: str
    directory: Path
    load: Callable[[Path], object]
    patterns: tuple[str, ...] = ("*.md",)

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
            if saved == new_hash and not force:
                results.append(SyncResult(kset.name, "unchanged"))
                continue
            report = kset.load(kset.directory)
            KnowledgeSync.objects.update_or_create(name=kset.name, defaults={"content_hash": new_hash})
            results.append(SyncResult(kset.name, "loaded", report=report))
        except Exception as exc:  # el arranque no se cae por la evidencia
            logger.exception("No se pudo cargar la base de evidencia '%s'", kset.name)
            results.append(SyncResult(kset.name, "failed", error=f"{type(exc).__name__}: {exc}"))
    return results
