"""Lista de la compra de un menú (fase 12): por sección del súper, con formato, semana y casillas.

- Un menú importado trae su lista (`MealPlan.shopping.items`: `section`, `pack`, `when`,
  `grams_two`...): se enseña tal cual.
- Un menú generado no la trae: sale de `coach.mealplan.shopping` (por cadena), como en la F8.

En los dos casos cada línea puede llevar el producto y el formato de la cadena con su valoración
(`chain_product`). Es el enganche con la fase 13 (catálogo privado de la cadena y su valoración):
llama a la función de `settings.SHOPPING_CHAIN_PROVIDER` (ruta con puntos; la pone la F13 en
settings, p. ej. `coaching.chain_catalogue.chain_product`). Sin ella, no hay producto.

Si el menú es de más de 7 días, cada línea lleva lo de cada semana (`by_week`), calculado por el
motor con los platos de cada día (una tanda cuenta en la semana en que se cocina), y la semana en
que hace falta (`when`) si el menú no la trae (R3-2). La sección: la de la cadena, la del menú y, si
no hay ninguna, la de `knowledge_fightlab/shopping-sections.yaml` (convención de FightLab).

Lo tachado se guarda en `ShoppingCheck` por el nombre del alimento sin mayúsculas ni tildes, así
sobrevive a una reimportación del menú.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import yaml
from coach import foods, mealplan
from coach.tastes import matches
from coach.text import fold
from django.conf import settings
from django.utils.module_loading import import_string

from .models import MealPlan, ShoppingCheck

OTHER_SECTION = ""  # sin sección: va al final
KEY_MAX = ShoppingCheck._meta.get_field("item_key").max_length


RATINGS = ("bueno", "regular", "evitar", "sin_datos", "no_aplica")
PRODUCT_FIELDS = ("chain", "product", "pack", "pack_grams", "packs", "section", "rating", "review", "price", "price_per_kg")


def chain_product(user, food_key: str, grams: float) -> dict | None:
    """Producto de la cadena para un alimento genérico (enganche de la fase 13).

    `food_key` es la clave del alimento en el motor: su nombre en inglés de la tabla
    (`foods.Food.name_en`), el mismo en cualquier idioma. Devuelve
    `{"chain", "product", "pack", "pack_grams", "packs", "section", "rating", "review", "price",
    "price_per_kg"}` o `None`. `price` es lo que cuestan los `packs` envases; `review` dice que las
    kcal de la etiqueta no cuadran (más de un 15 %); `rating` es uno de `RATINGS` o `None`. La
    implementación es de la F13 (`settings.SHOPPING_CHAIN_PROVIDER`); sin ella, `None`."""
    path = getattr(settings, "SHOPPING_CHAIN_PROVIDER", None)
    if not path or not food_key:
        return None
    found = import_string(path)(user, food_key, grams)
    if not found:
        return None
    out = {name: found.get(name) for name in PRODUCT_FIELDS}
    if out["rating"] not in RATINGS:
        out["rating"] = None
    out["review"] = bool(out["review"])
    return out


def _food_key(name: str, table) -> str | None:
    food = foods.find(name, table)
    return food.name_en if food else None


# ---------------------------------------------------------------- secciones por defecto

SECTIONS_FILE = Path(settings.BASE_DIR) / "knowledge_fightlab" / "shopping-sections.yaml"


@lru_cache(maxsize=1)
def _sections() -> list[dict]:
    return yaml.safe_load(SECTIONS_FILE.read_text(encoding="utf-8"))["sections"]


def section_of(*names: str) -> str | None:
    """La clave de la sección del súper que nombra alguno de `names`, o `None`."""
    names = tuple(n for n in names if n)
    for section in _sections():
        if any(matches(word, *names) for word in section["words"]):
            return section["key"]
    return None


def default_section(name: str, table, lang: str) -> str:
    """La sección del súper por el nombre del alimento (en los dos idiomas si está en la tabla), o
    `OTHER_SECTION`. convention (FightLab): lista de palabras del anexo, no completa."""
    food = foods.find(name, table)
    key = section_of(name, food.name_es, food.name_en) if food else section_of(name)
    label = "en" if lang == "en" else "es"
    return next((s[label] for s in _sections() if s["key"] == key), OTHER_SECTION)


# ---------------------------------------------------------------- por semana


def _line_key(name: str, table) -> str:
    food = foods.find(name, table)
    return fold(food.name_en) if food else fold(name)


def week_amounts(plan: MealPlan, table) -> dict[str, dict[int, float]]:
    """Gramos (o ml) de cada alimento por semana del menú (1: los 7 primeros días; 2: el resto),
    como `mealplan.shopping`: una tanda se compra una vez, a sus raciones, en la semana en que se
    cocina (la de su primer día). Vacío si el menú es de 7 días o menos."""
    from . import menus

    if not plan.days:
        return {}
    first = date.fromisoformat(plan.days[0]["date"])
    if (date.fromisoformat(plan.days[-1]["date"]) - first).days < 7:
        return {}
    _, days = mealplan.parse(menus._with_dates(plan.days))
    out: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for group in mealplan.batches(days):
        week = 1 if group.dates[0] < first + timedelta(days=7) else 2
        times = group.servings if group.servings > 1 else 1
        for name, amount in group.items:
            out[_line_key(name, table)][week] += float(amount) * times
    return {k: {w: round(v, 2) for w, v in weeks.items()} for k, weeks in out.items()}


def _by_week(name: str, table, weeks: dict) -> tuple[dict | None, list[int]]:
    found = weeks.get(_line_key(name, table))
    if not found:
        return None, []
    return {str(w): found.get(w, 0.0) for w in (1, 2)}, [w for w in (1, 2) if found.get(w)]


def item_key(name: str) -> str:
    return fold(name).strip()[:KEY_MAX]


def _weeks(plan: MealPlan) -> list[int]:
    if not plan.days:
        return []
    first = date.fromisoformat(plan.days[0]["date"])
    last = date.fromisoformat(plan.days[-1]["date"])
    return [1, 2] if (last - first).days >= 7 else [1]


def _imported_lines(plan: MealPlan, user, lang: str) -> list[dict]:
    from . import menus

    table = menus.menu_table(user)
    weeks = week_amounts(plan, table)
    lines = []
    for item in plan.shopping.get("items") or []:
        unit = "ml" if "ml" in item and "grams" not in item else "g"
        amount = item.get("grams") if unit == "g" else item.get("ml")
        two = item.get("grams_two") if unit == "g" else item.get("ml_two")
        product = chain_product(user, _food_key(item["name"], table), amount or 0)
        by_week, computed_when = _by_week(item["name"], table, weeks)
        lines.append({
            "key": item_key(item["name"]),
            "name": item["name"],
            "amount": amount,
            "amount_two": two,
            "unit": unit,
            # La sección de la cadena manda; si no la hay, la del menú; si no, la de por defecto.
            "section": (product or {}).get("section") or item.get("section") or default_section(item["name"], table, lang),
            "pack": item.get("pack"),
            "chain": item.get("chain"),
            "when": item.get("when") or computed_when,
            "by_week": by_week,
            "dishes": item.get("dishes") or [],
            "batches": item.get("batches"),
            "product": product,
        })
    return lines


def _computed(plan: MealPlan, user, lang: str) -> tuple[list[dict], dict]:
    from . import menus

    table = menus.menu_table(user)
    _, days = mealplan.parse(menus._with_dates(plan.days))
    pantry = menus.tastes_get(user).pantry or []
    computed = mealplan.shopping(days, table, lang, pantry)
    weeks = week_amounts(plan, table)
    lines = []
    for chain, items in computed["chains"].items():
        for item in items:
            unit = "ml" if "ml" in item else "g"
            amount = round(item.get("grams", item.get("ml", 0)), 2)
            product = chain_product(user, _food_key(item["name"], table), amount)
            by_week, computed_when = _by_week(item["name"], table, weeks)
            lines.append({
                "key": item_key(item["name"]),
                "name": item["name"],
                "amount": amount,
                "amount_two": None,
                "unit": unit,
                "section": (product or {}).get("section") or default_section(item["name"], table, lang),
                "pack": (product or {}).get("pack"),
                "chain": None if chain == mealplan.ANY_CHAIN else chain,
                "when": computed_when,
                "by_week": by_week,
                "dishes": [],
                "batches": None,
                "product": product,
            })
    extra = {
        "unknown": computed["unknown"],
        "pantry_skipped": computed["pantry_skipped"],
        "batches": [{**b, "dates": [d.isoformat() for d in b["dates"]]} for b in computed["batches"]],
    }
    return lines, extra


# R3-4: la nota fija en inglés que el coach pone en todas sus listas ("amounts are for the form
# each name gives…"). La app ya enseña la suya traducida, así que esa no se repite.
COACH_NOTE_START = "amounts are for the form each name gives"


def _note(note: str) -> str:
    return "" if fold(note).strip().startswith(COACH_NOTE_START) else note


def shopping_data(plan: MealPlan, user, lang: str) -> dict:
    imported = bool(plan.shopping.get("items"))
    if imported:
        lines = _imported_lines(plan, user, lang)
        extra = {"unknown": [], "pantry_skipped": [], "batches": plan.shopping.get("batches") or []}
    else:
        lines, extra = _computed(plan, user, lang)
    checked = set(ShoppingCheck.objects.filter(plan=plan).values_list("item_key", flat=True))
    for line in lines:
        line["checked"] = line["key"] in checked
    sections: dict[str, list[dict]] = {}
    for line in sorted(lines, key=lambda x: fold(x["name"])):
        sections.setdefault(line["section"], []).append(line)
    order = sorted(sections, key=lambda s: (s == OTHER_SECTION, fold(s)))
    return {
        "source": "menu" if imported else "engine",
        "sections": [{"section": s, "items": sections[s]} for s in order],
        "weeks": _weeks(plan),
        "note": _note(plan.shopping.get("note") or ""),
        "total": len(lines),
        "checked": sum(1 for line in lines if line["checked"]),
        **extra,
    }


def set_checked(plan: MealPlan, name: str, checked: bool) -> None:
    key = item_key(name)
    if not key:
        raise ValueError("item")
    if checked:
        ShoppingCheck.objects.get_or_create(plan=plan, item_key=key)
    else:
        ShoppingCheck.objects.filter(plan=plan, item_key=key).delete()
