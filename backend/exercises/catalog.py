"""Catálogo de la biblioteca de ejercicios (F17): lectura, búsqueda y forma de la API.

El catálogo es estático (`data/exercise_catalog.json`, generado por `tools/snapshot.py` y fijado
en el repo); los ejercicios propios del usuario están en la base de datos (`CustomExercise`).
Las dos cosas salen por la API con la misma forma:

    {key, name, aliases, primary_muscles, secondary_muscles, equipment, images, instructions,
     instructions_lang, category, notes, source, attribution, custom}
"""
from __future__ import annotations

import json
import re
import unicodedata
from functools import cache
from pathlib import Path

from django.utils.translation import get_language

CATALOG_PATH = Path(__file__).resolve().parent / "data" / "exercise_catalog.json"
LANGS = ("es", "en")
DEFAULT_LANG = "es"
CAT_PREFIX = "cat:"
CUSTOM_PREFIX = "custom:"


@cache
def catalog() -> tuple[dict, ...]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return tuple(data["exercises"])


@cache
def catalog_by_key() -> dict[str, dict]:
    return {e["key"]: e for e in catalog()}


def resolve_lang(lang: str | None) -> str:
    """`lang` de la query si es uno de la app; si no, el de la petición (`Accept-Language`)."""
    for cand in (lang, get_language()):
        if cand:
            short = cand.split("-")[0].lower()
            if short in LANGS:
                return short
    return DEFAULT_LANG


def normalize(text: str) -> str:
    """Minúsculas, sin acentos y con los espacios y la puntuación reducidos a un espacio."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", plain.lower()).strip()


def _other(lang: str) -> str:
    return "en" if lang == "es" else "es"


def entry_names(entry: dict) -> list[str]:
    """Todos los nombres de una entrada (los dos idiomas, alias y nombres antiguos)."""
    names = [*entry["names"].values(), *entry.get("legacy_names", [])]
    for aliases in entry.get("aliases", {}).values():
        names.extend(aliases)
    return names


def _attribution(entry: dict) -> str | None:
    parts = []
    authors = []
    for img in entry.get("images", []):
        label = img["author"]
        if img.get("source_name"):
            label = f"{label} ({img['source_name']})"
        if label not in authors:
            authors.append(label)
    licenses = sorted({img["license"] for img in entry.get("images", [])})
    if authors:
        parts.append(f"{', '.join(authors)} · {', '.join(licenses)}")
    for credit in entry.get("text_credits", {}).values():
        if credit["source"] != "fightlab":
            line = f"{credit['author']} ({credit['source']}) · {credit['license']}"
            if line not in parts:
                parts.append(line)
    return " / ".join(parts) or None


def _source(entry: dict) -> str:
    sources = []
    for img in entry.get("images", []):
        if img["source"] not in sources:
            sources.append(img["source"])
    for credit in entry.get("text_credits", {}).values():
        if credit["source"] not in sources:
            sources.append(credit["source"])
    return "+".join(sources) or "fightlab"


def serialize_entry(entry: dict, lang: str) -> dict:
    instructions = entry["instructions"].get(lang) or []
    instructions_lang = lang
    if not instructions:
        other = entry["instructions"].get(_other(lang)) or []
        if other:
            instructions, instructions_lang = other, _other(lang)
        else:
            instructions_lang = None
    other_name = entry["names"][_other(lang)]
    aliases = [*entry["aliases"].get(lang, [])]
    if other_name != entry["names"][lang]:
        aliases.insert(0, other_name)
    return {
        "key": entry["key"],
        "name": entry["names"][lang],
        "aliases": aliases,
        "primary_muscles": entry["primary_muscles"],
        "secondary_muscles": entry["secondary_muscles"],
        "equipment": entry["equipment"],
        "category": entry["category"],
        "images": [
            {
                "url": img["src"],
                "source": img["source"],
                "author": img["author"],
                "license": img["license"],
                "license_url": img["license_url"],
                "source_url": img["source_url"],
                "modified": img.get("modified", ""),
            }
            for img in entry.get("images", [])
        ],
        "instructions": instructions,
        "instructions_lang": instructions_lang,
        # El crédito del texto que se enseña (cada idioma puede tener otro autor y licencia)
        "text_credit": entry.get("text_credits", {}).get(instructions_lang) if instructions_lang else None,
        "notes": "",
        "source": _source(entry),
        "attribution": _attribution(entry),
        "custom": False,
    }


def serialize_custom(ex) -> dict:
    return {
        "key": ex.key,
        "id": ex.pk,
        "name": ex.name,
        "aliases": [],
        "primary_muscles": ex.primary_muscles,
        "secondary_muscles": ex.secondary_muscles,
        "equipment": ex.equipment,
        "category": "strength",
        "images": [],
        "instructions": [],
        "instructions_lang": None,
        "text_credit": None,
        "notes": ex.notes,
        "source": "custom",
        "attribution": None,
        "custom": True,
    }


def _rank(names: list[str], tokens: list[str], query: str) -> int | None:
    """0 nombre exacto, 1 empieza por la búsqueda, 2 la contiene, 3 están todas las palabras.
    None si no casa."""
    normalized = [normalize(n) for n in names]
    if not normalized:
        return None
    if query in normalized:
        return 0
    if any(n.startswith(query) for n in normalized):
        return 1
    if any(query in n for n in normalized):
        return 2
    haystack = " ".join(normalized)
    if all(t in haystack for t in tokens):
        return 3
    return None


def search(items: list[dict], *, q: str = "", muscle: str = "", equipment: str = "") -> list[dict]:
    """Filtra la lista ya serializada. `muscle` casa con el músculo principal o el secundario (en
    los principales primero); `equipment`, con cualquiera del material. Sin `q`, orden alfabético."""
    query = normalize(q or "")
    tokens = query.split()
    out = []
    for item in items:
        if muscle and muscle not in item["primary_muscles"] and muscle not in item["secondary_muscles"]:
            continue
        if equipment and equipment not in item["equipment"]:
            continue
        rank = 0
        if query:
            # Lo que casa con el nombre que ve el usuario va antes que lo que casa con un alias.
            by_name = _rank([item["name"]], tokens, query)
            if by_name is not None:
                rank = by_name * 2
            else:
                by_alias = _rank([*item["aliases"], *item.get("_search", [])], tokens, query)
                if by_alias is None:
                    continue
                rank = by_alias * 2 + 1
        secondary_only = 1 if muscle and muscle not in item["primary_muscles"] else 0
        out.append(((secondary_only, rank, normalize(item["name"])), item))
    out.sort(key=lambda pair: pair[0])
    return [item for _, item in out]


def catalog_items(lang: str) -> list[dict]:
    """Todo el catálogo serializado, con los nombres de los dos idiomas para buscar (`_search`)."""
    items = []
    for entry in catalog():
        item = serialize_entry(entry, lang)
        item["_search"] = entry_names(entry)
        items.append(item)
    return items


def strip_private(item: dict) -> dict:
    return {k: v for k, v in item.items() if not k.startswith("_")}
