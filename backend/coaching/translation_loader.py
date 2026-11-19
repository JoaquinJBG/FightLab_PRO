"""Carga las traducciones de las reglas desde los archivos del repo (`knowledge_translations/`).

Un archivo YAML por archivo de reglas de origen: `<lang>/<origin>/<file>.yaml`, con una entrada
por regla (`key`, `source_hash`, `status` y los campos traducidos). `source_hash` es el
`KnowledgeRule.source_hash` del texto en inglés que se tradujo: si la regla ha cambiado desde
entonces, la traducción se guarda como `stale` y la app muestra el original (spec §7.2).

Los archivos mandan: una traducción que sale de ellos sobrescribe la de la BD. Las traducciones
de la BD sin entrada en los archivos no se tocan.
"""
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from django.conf import settings
from django.db import transaction

from .knowledge_loader import TEXT_FIELDS
from .models import KnowledgeRule, RuleTranslation

TRANSLATIONS_DIR = Path(settings.BASE_DIR) / "knowledge_translations"
FILE_STATUSES = {RuleTranslation.Status.MACHINE, RuleTranslation.Status.REVIEWED}


class TranslationError(Exception):
    pass


@dataclass
class TranslationReport:
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    stale_keys: list[str] = field(default_factory=list)  # su `source_hash` ya no es el de la regla
    unknown_keys: list[str] = field(default_factory=list)  # entradas sin regla en la BD
    missing: int = 0  # reglas vigentes sin traducción al día tras la carga


def translation_files(directory: Path, lang: str) -> list[Path]:
    return sorted((Path(directory) / lang).rglob("*.yaml"))


def read_entries(path: Path, lang: str) -> list[dict]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise TranslationError(f"{path.name}: YAML inválido ({exc})") from exc
    if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
        raise TranslationError(f"{path.name}: se esperaba un mapa con la lista `rules`")
    if data.get("lang") != lang:
        raise TranslationError(f"{path.name}: `lang` es {data.get('lang')!r}, no {lang!r}")
    entries = []
    for i, entry in enumerate(data["rules"]):
        where = f"{path.name}[{i}]"
        if not isinstance(entry, dict) or not entry.get("key") or not entry.get("source_hash"):
            raise TranslationError(f"{where}: faltan `key` o `source_hash`")
        if entry.get("status", RuleTranslation.Status.MACHINE) not in FILE_STATUSES:
            raise TranslationError(f"{where}: `status` debe ser machine o reviewed")
        if not entry.get("heading") or not entry.get("rule_text"):
            raise TranslationError(f"{where}: faltan el título o el texto de la regla")
        entries.append(entry)
    return entries


def up_to_date(tr: RuleTranslation | None, rule: KnowledgeRule) -> bool:
    return tr is not None and tr.status != RuleTranslation.Status.STALE and tr.source_hash == rule.source_hash


@transaction.atomic
def load_translations(directory: Path, lang: str, dry_run: bool = False) -> TranslationReport:
    files = translation_files(directory, lang)
    if not files:
        raise TranslationError(f"no hay archivos de traducción en {Path(directory) / lang}")
    report = TranslationReport()
    rules = {r.key: r for r in KnowledgeRule.objects.all()}
    existing = {t.rule_id: t for t in RuleTranslation.objects.filter(lang=lang)}
    seen: set[str] = set()
    to_create, to_update = [], []
    for path in files:
        for entry in read_entries(path, lang):
            key = entry["key"]
            if key in seen:
                raise TranslationError(f"{path.name}: clave repetida {key}")
            seen.add(key)
            rule = rules.get(key)
            if rule is None:
                report.unknown_keys.append(key)
                continue
            status = entry.get("status", RuleTranslation.Status.MACHINE)
            if entry["source_hash"] != rule.source_hash:
                status = RuleTranslation.Status.STALE
                report.stale_keys.append(key)
            values = {
                **{f: str(entry.get(f) or "").strip() for f in TEXT_FIELDS},
                "status": status,
                "source_hash": entry["source_hash"],
            }
            tr = existing.get(rule.pk)
            if tr is None:
                tr = RuleTranslation(rule=rule, lang=lang, **values)
                to_create.append(tr)
                existing[rule.pk] = tr
                report.created += 1
            elif any(getattr(tr, f) != v for f, v in values.items()):
                for f, v in values.items():
                    setattr(tr, f, v)
                to_update.append(tr)
                report.updated += 1
            else:
                report.unchanged += 1
    RuleTranslation.objects.bulk_create(to_create)
    if to_update:
        RuleTranslation.objects.bulk_update(to_update, [*TEXT_FIELDS, "status", "source_hash"])
    report.missing = sum(
        not up_to_date(existing.get(r.pk), r) for r in rules.values() if not r.retired
    )
    if dry_run:
        transaction.set_rollback(True)
    return report
