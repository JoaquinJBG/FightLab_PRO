"""Traducción de las reglas de evidencia con el LLM (spec §7.3).

Se traduce una vez (`status=machine`) y se revisa a mano (`reviewed`). Las reglas que cambian
en origen pasan a `stale` y se vuelven a traducir. Los campos que se traducen son los que
muestra la hoja de evidencia; `evidence` (el resumen de los estudios) no se traduce.
"""
import json
import re
from pathlib import Path

import coach
from django.conf import settings

from ai.services import AIBadResponse, _client

from .bridge.reasons import REFERENCE_RE
from .keys import rule_key
from .models import KnowledgeRule, RuleTranslation

LANGUAGES = {"es": "Spanish"}
TRANSLATED_FIELDS = ("heading", "rule_text", "applies_to", "conflicts")
# Reglas que citan los cálculos del motor: se traducen primero.
PRIORITY_MODULES = ("safety", "energy", "macros", "zones", "trend")
SOURCE_TAG_RE = re.compile(r"\[S\d+\]")

SYSTEM = """You translate rules from an evidence base on exercise, nutrition and health \
into {language} for a fitness app. The reader is an athlete or coach; be precise and plain.

Rules:
- Translate faithfully. Do not add, drop, soften or strengthen any claim, number, range, \
unit, dose or threshold. Keep numbers and units exactly as written.
- Keep source tags such as [S123] exactly as they are.
- Keep standard abbreviations (RMR, TDEE, RPE, RIR, HRmax, BMI, PAR-Q+, VO2max...) and \
names of equations, studies and authors untranslated.
- If a field mentions another rule by its title in quotes, translate the title the way \
you would translate that heading.
- The input is a JSON object. Reply with ONLY a JSON object with the same keys, translated. \
No markdown, no commentary."""


def priority_keys() -> set[str]:
    """Claves de las reglas que citan `safety`, `energy`, `macros`, `zones` y `trend`."""
    engine_dir = Path(coach.__file__).resolve().parent
    keys = set()
    for name in PRIORITY_MODULES:
        text = (engine_dir / f"{name}.py").read_text(encoding="utf-8")
        for m in REFERENCE_RE.finditer(text):
            heading = m.group("heading")
            if "{" in heading or heading.endswith("..."):
                continue  # plantilla de f-string o referencia abreviada
            keys.add(rule_key(m.group("file"), heading))
    return keys


def pending_rules(lang: str, force: bool = False, priority_only: bool = False) -> list[KnowledgeRule]:
    """Reglas vigentes sin traducción al día, las prioritarias primero."""
    translations = {t.rule_id: t for t in RuleTranslation.objects.filter(lang=lang)}
    priority = priority_keys()
    todo = []
    for rule in KnowledgeRule.objects.filter(retired=False).order_by("file", "key"):
        tr = translations.get(rule.pk)
        done = tr is not None and tr.status != RuleTranslation.Status.STALE and tr.source_hash == rule.source_hash
        if done and not force:
            continue
        if priority_only and rule.key not in priority:
            continue
        todo.append(rule)
    todo.sort(key=lambda r: r.key not in priority)  # estable: respeta el orden por archivo y clave
    return todo


def parse_reply(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise AIBadResponse("la respuesta no es JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIBadResponse("JSON inválido") from exc
    if not isinstance(data, dict):
        raise AIBadResponse("se esperaba un objeto JSON")
    return data


def translate_rule(rule: KnowledgeRule, lang: str, client=None) -> dict[str, str]:
    """Pide la traducción de una regla. Lanza `AIBadResponse` si no es utilizable."""
    client = client or _client(timeout=60.0)
    source = {f: getattr(rule, f) for f in TRANSLATED_FIELDS if getattr(rule, f)}
    resp = client.messages.create(
        model=settings.AI_MODEL_TRANSLATE,
        max_tokens=2000,
        system=SYSTEM.format(language=LANGUAGES[lang]),
        messages=[{"role": "user", "content": json.dumps(source, ensure_ascii=False)}],
    )
    data = parse_reply(("".join(b.text for b in resp.content if b.type == "text")).strip())
    out = {f: str(data.get(f) or "").strip() for f in source}
    if not out.get("heading") or not out.get("rule_text"):
        raise AIBadResponse("faltan el título o el texto de la regla")
    for f, original in source.items():
        if sorted(SOURCE_TAG_RE.findall(original)) != sorted(SOURCE_TAG_RE.findall(out[f])):
            raise AIBadResponse(f"se han perdido o cambiado etiquetas de fuente en {f}")
    return out


def save_translation(rule: KnowledgeRule, lang: str, fields: dict[str, str]) -> RuleTranslation:
    values = {f: fields.get(f, "") for f in (*TRANSLATED_FIELDS, "evidence")}
    tr, _ = RuleTranslation.objects.update_or_create(
        rule=rule,
        lang=lang,
        defaults={**values, "status": RuleTranslation.Status.MACHINE, "source_hash": rule.source_hash},
    )
    return tr
