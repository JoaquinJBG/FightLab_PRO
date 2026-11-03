"""Carga `knowledge/*.md` y `sources.md` en la BD (spec §6.7).

Parsea con `coach.knowledge.iter_rules` y no guarda la línea `Supports:` de las fuentes
(son citas textuales de las editoriales, que no están bajo CC BY).
"""
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from coach import knowledge as coach_knowledge
from django.db import transaction

from .engine import ENGINE_SHA
from .keys import rule_key
from .models import KnowledgeRule, KnowledgeSource, RuleTranslation

LABEL_RE = re.compile(r"^\*\*([^*]+):\*\*\s*(.*)$")
FIELDS = {
    "Rule": "rule_text",
    "Evidence": "evidence",
    "Applies to": "applies_to",
    "Individual variation / conflicts": "conflicts",
}
TEXT_FIELDS = ("heading", "rule_text", "evidence", "applies_to", "conflicts")
SOURCE_HEAD_RE = re.compile(r"^### (\S+)\s*$")
# `coach.knowledge.CITE_RE` solo lee `[Sxxx]`; el anexo de combate cita `[Fxxx]` (E.4).
CITE_RE = re.compile(r"\[([SF]\d+)\]")
# No son archivos de reglas: el cargador del coach ya salta `sources.md` e `index.md`.
NOT_RULE_FILES = {"dropped-claims.md"}
DOI_RE = re.compile(r"DOI:\s*(?:\[([^\]]+)\]\([^)]*\)|([^\s·]+))")
TYPE_RE = re.compile(r"Type:\s*(.*?)\s*(?:·|$)")
URL_RE = re.compile(r"^URL:\s*<?([^>\s]+)>?")


class KnowledgeError(Exception):
    pass


@dataclass
class Report:
    rules_created: int = 0
    rules_updated: int = 0
    rules_retired: int = 0
    rules_unchanged: int = 0
    sources_created: int = 0
    sources_updated: int = 0
    stale_translations: int = 0
    missing_sources: list[str] = field(default_factory=list)


def parse_rule_fields(rule: coach_knowledge.Rule) -> dict[str, str]:
    """`**Rule:** …` etc. del cuerpo de una regla (admite varias líneas por campo)."""
    out: dict[str, list[str]] = {}
    current = None
    for line in rule.body:
        m = LABEL_RE.match(line)
        if m:
            current = FIELDS.get(m.group(1))
            if current:
                out[current] = [m.group(2)]
        elif current:
            out[current].append(line)
    return {name: "\n".join(lines).strip() for name, lines in out.items()}


def parse_sources(text: str) -> dict[str, dict[str, str]]:
    """`sources.md` → {sid: {citation, type, doi, url}}. Descarta `Supports:` y `Opened:`."""
    sources: dict[str, dict[str, str]] = {}
    sid = None
    for line in text.splitlines():
        head = SOURCE_HEAD_RE.match(line)
        if head:
            sid = head.group(1)
            sources[sid] = {"citation": "", "type": "", "doi": "", "url": ""}
            continue
        if line.startswith("## "):
            sid = None
            continue
        if sid is None or not line.strip():
            continue
        data = sources[sid]
        if not data["citation"]:
            data["citation"] = line.strip()
        elif line.startswith("Type:"):
            if m := TYPE_RE.match(line):
                data["type"] = m.group(1)
            if m := DOI_RE.search(line):
                doi = m.group(1) or m.group(2)
                data["doi"] = "" if doi.lower() == "none" else doi
        elif m := URL_RE.match(line):
            data["url"] = m.group(1)
    return sources


def content_hash(values: dict[str, str]) -> str:
    blob = "\x1f".join(values.get(f, "") for f in TEXT_FIELDS)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def source_ids_of(rule: coach_knowledge.Rule) -> list[str]:
    """Los `[Sxxx]` y `[Fxxx]` que cita una regla, sin repetidos y en orden de aparición."""
    return list(dict.fromkeys(CITE_RE.findall("\n".join(rule.body))))


def _collect_rules(directory: Path, origin: str) -> dict[str, dict]:
    collected: dict[str, dict] = {}
    for path in coach_knowledge.rule_files(directory):
        if path.name in NOT_RULE_FILES:
            continue
        text = coach_knowledge.read(path)
        checked = coach_knowledge.checked_date(text)
        for rule in coach_knowledge.iter_rules(text):
            key = rule_key(path.name, rule.heading)
            if key in collected:
                raise KnowledgeError(f"claves duplicadas: {key}")
            values = {"heading": rule.heading, **parse_rule_fields(rule)}
            grade = rule.grade if rule.grade in coach_knowledge.GRADES else ""
            collected[key] = {
                "file": path.stem,
                "section": rule.section,
                "grade": grade,
                "source_ids": source_ids_of(rule),
                "checked_on": checked,
                "origin": origin,
                "engine_sha": ENGINE_SHA if origin == KnowledgeRule.Origin.UPSTREAM else "",
                "source_hash": content_hash(values),
                "retired": False,
                **{f: values.get(f, "") for f in TEXT_FIELDS},
            }
    return collected


@transaction.atomic
def load_knowledge(directory: Path, origin: str = KnowledgeRule.Origin.UPSTREAM) -> Report:
    directory = Path(directory)
    if not directory.is_dir():
        raise KnowledgeError(f"no existe el directorio {directory}")
    report = Report()
    wanted = _collect_rules(directory, origin)

    existing = {r.key: r for r in KnowledgeRule.objects.filter(origin=origin)}
    foreign = set(KnowledgeRule.objects.exclude(origin=origin).values_list("key", flat=True))
    clash = foreign & wanted.keys()
    if clash:
        raise KnowledgeError(f"claves duplicadas con otro origen: {sorted(clash)[:3]}")

    to_create, to_update, hash_changed = [], [], []
    for key, values in wanted.items():
        rule = existing.get(key)
        if rule is None:
            to_create.append(KnowledgeRule(key=key, **values))
            report.rules_created += 1
            continue
        changed = [f for f, v in values.items() if getattr(rule, f) != v]
        if not changed:
            report.rules_unchanged += 1
            continue
        if "source_hash" in changed:
            hash_changed.append(rule.pk)
        for f, v in values.items():
            setattr(rule, f, v)
        to_update.append(rule)
        report.rules_updated += 1
    KnowledgeRule.objects.bulk_create(to_create)
    if to_update:
        KnowledgeRule.objects.bulk_update(to_update, list(next(iter(wanted.values())).keys()))
    if hash_changed:
        for tr in RuleTranslation.objects.filter(rule_id__in=hash_changed).select_related("rule"):
            if tr.source_hash != tr.rule.source_hash and tr.status != RuleTranslation.Status.STALE:
                tr.status = RuleTranslation.Status.STALE
                tr.save(update_fields=["status"])
                report.stale_translations += 1

    gone = [r for k, r in existing.items() if k not in wanted and not r.retired]
    for rule in gone:
        rule.retired = True
    if gone:
        KnowledgeRule.objects.bulk_update(gone, ["retired"])
    report.rules_retired = len(gone)

    _load_sources(directory, origin, wanted, report)
    return report


def _load_sources(directory: Path, origin: str, rules: dict[str, dict], report: Report) -> None:
    path = directory / "sources.md"
    parsed = parse_sources(coach_knowledge.read(path)) if path.is_file() else {}
    existing = {s.sid: s for s in KnowledgeSource.objects.filter(sid__in=parsed)}
    to_create, to_update = [], []
    for sid, values in parsed.items():
        src = existing.get(sid)
        if src is None:
            to_create.append(KnowledgeSource(sid=sid, origin=origin, **values))
            report.sources_created += 1
        elif src.origin == origin and any(getattr(src, f) != v for f, v in values.items()):
            for f, v in values.items():
                setattr(src, f, v)
            to_update.append(src)
            report.sources_updated += 1
    KnowledgeSource.objects.bulk_create(to_create)
    if to_update:
        KnowledgeSource.objects.bulk_update(to_update, ["citation", "type", "doi", "url"])
    known = set(parsed) | set(KnowledgeSource.objects.values_list("sid", flat=True))
    cited = {sid for r in rules.values() for sid in r["source_ids"]}
    report.missing_sources = sorted(cited - known)
