"""Herramientas de evidencia del chat y validación de citas (spec §7.4).

El modelo busca reglas con `search_rules` / `get_rule` y las cita en el texto como
`[[regla:clave]]`. El backend solo deja pasar las claves que existen, están vigentes y han
salido en alguna herramienta de ese turno; las demás se quitan y se registran.
"""
import json
import logging
import re

from .models import KnowledgeRule

logger = logging.getLogger(__name__)

CITATION_RE = re.compile(r"[ \t]*\[\[regla:\s*([^\]\s]+)\s*\]\]")
SEARCH_LIMIT = 8

TOOLS = [
    {
        "name": "search_rules",
        "description": (
            "Search the evidence base for rules by keyword (matches the rule title and its "
            "section, in English). Returns keys, titles and evidence grades. Use it before "
            "making any claim about training, nutrition, recovery or health."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Keywords, e.g. 'protein'."}},
            "required": ["query"],
        },
    },
    {
        "name": "get_rule",
        "description": (
            "Get one rule of the evidence base by key: its text, evidence grade, who it applies "
            "to and where the evidence is unclear. Cite it as [[regla:key]]."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"key": {"type": "string", "description": "Rule key, e.g. 'nutrition/…'."}},
            "required": ["key"],
        },
    },
]


def run_tool(name: str, tool_input: dict, retrieved: set[str]) -> str:
    """Ejecuta una herramienta y devuelve su resultado como JSON. Anota en `retrieved` las
    claves de regla que ha entregado al modelo."""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if name == "search_rules":
        return json.dumps(_search(str(tool_input.get("query", "")), retrieved), ensure_ascii=False)
    if name == "get_rule":
        return json.dumps(_get(str(tool_input.get("key", "")), retrieved), ensure_ascii=False)
    return json.dumps({"error": f"unknown tool: {name}"})


def _search(query: str, retrieved: set[str]) -> dict:
    query = query.strip()
    if not query:
        return {"results": []}
    rules = KnowledgeRule.objects.filter(retired=False, heading__icontains=query)[:SEARCH_LIMIT]
    found = list(rules)
    if len(found) < SEARCH_LIMIT:
        seen = {r.pk for r in found}
        extra = KnowledgeRule.objects.filter(retired=False, section__icontains=query).exclude(pk__in=seen)
        found += list(extra[: SEARCH_LIMIT - len(found)])
    retrieved.update(r.key for r in found)
    return {
        "results": [{"key": r.key, "title": r.heading, "grade": r.grade, "section": r.section} for r in found]
    }


def _get(key: str, retrieved: set[str]) -> dict:
    rule = KnowledgeRule.objects.filter(key=key.strip(), retired=False).first()
    if rule is None:
        return {"error": f"no rule with key {key!r}; use search_rules to find the right key"}
    retrieved.add(rule.key)
    return {
        "key": rule.key,
        "title": rule.heading,
        "grade": rule.grade,
        "rule_text": rule.rule_text,
        "applies_to": rule.applies_to,
        "unclear": rule.conflicts,
    }


def validate_citations(text: str, retrieved: set[str]) -> tuple[str, list[dict]]:
    """Quita las citas inválidas del texto y devuelve las válidas como chips.

    Una cita es válida si la regla existe y está vigente, y salió en una herramienta de este
    turno. Devuelve `(texto limpio, [{key, grade, title}])`, sin repetidos y en orden de aparición.
    """
    cited = list(dict.fromkeys(CITATION_RE.findall(text)))
    rules = {r.key: r for r in KnowledgeRule.objects.filter(key__in=cited, retired=False)}
    valid = {key for key in cited if key in rules and key in retrieved}
    for key in cited:
        if key not in valid:
            logger.warning("cita del chat sin fuente, se quita: %s", key)

    def keep_or_drop(match: re.Match) -> str:
        key = match.group(1)
        if key not in valid:
            return ""
        lead = match.group(0)[: len(match.group(0)) - len(match.group(0).lstrip(" 	"))]
        return f"{lead}[[regla:{key}]]"

    cleaned = CITATION_RE.sub(keep_or_drop, text)
    cleaned = re.sub(r"[ \t]+([.,;:!?])", r"\1", cleaned).strip()
    citations = [
        {"key": key, "grade": rules[key].grade, "title": rules[key].heading} for key in cited if key in valid
    ]
    return cleaned, citations
