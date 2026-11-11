"""Menús con la IA del propio usuario a coste 0 (fase 14).

FightLab no llama a ninguna IA. Prepara los datos y las instrucciones para que el usuario genere
el menú con **su** IA y lo devuelva en el JSON `schema: 1` de la F12:

- **B (la vía principal):** la skill de Claude Code de su PC (`tools/claude-skill/fightlab-menu`)
  descarga `context_data` con su token personal (`menu_tokens`), le pide el JSON a su Claude, lo
  comprueba con `dry_run` y lo sube.
- **C (desde el móvil):** la app copia el mismo contexto en texto (instrucciones y datos) para
  pegarlo en claude.ai u otra IA, y el JSON que devuelve se pega en la app (`parse_pasted`).

En los dos casos el menú pasa por el importador de la F12 (`menu_import`) y por la comprobación
del motor, y se guarda con origen `user_ai`.

El contexto lleva solo lo que hace falta para el menú: objetivos del día (sin peso ni datos del
perfil), gustos, recetario, Mi cocina (los comensales sin su nombre), los alimentos que conoce el
motor con sus valores por 100 g o 100 ml, el catálogo resumido y los platos de los menús recientes.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from coach import mealplan
from coach.cli import MENU_KCAL_MARGIN
from coach.text import fold

from . import kitchen, menu_import, menus, product_rating
from .menu_dishes import DISHES
from .models import ChainProduct, MealPlan

CONTEXT_VERSION = 1
# convention (FightLab): la IA del usuario prepara de 1 a 14 días (dos semanas, como los menús de
# la app); el importador acepta hasta `menu_import.MAX_DAYS`.
MAX_DAYS = 14
DEFAULT_DAYS = 7
RECENT_MENUS = 3
CHAIN_PRODUCTS = 60
AI_ID_PREFIX = "ia-"
FOOD_COLUMNS = ["name", "per", "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"]
MEAL_LABELS = {
    "es": {"breakfast": "Desayuno", "lunch": "Comida", "dinner": "Cena", "snack": "Merienda"},
    "en": {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "snack": "Snack"},
}
def _lang(lang: str) -> str:
    return lang if lang in ("es", "en") else "es"


def default_start(user, today: date) -> date:
    """El día después del último menú, si llega hasta hoy o más tarde; si no, hoy."""
    last = MealPlan.objects.filter(profile=user.profile).exclude(end_date=None).order_by("-end_date").first()
    if last and last.end_date >= today:
        return last.end_date + timedelta(days=1)
    return today


# ---------------------------------------------------------------- contexto


def _foods(user, lang: str) -> list[list]:
    """La tabla del motor y el catálogo del usuario: nombre en `lang` y valores por 100 g o 100 ml
    (vacío = sin dato). Son los únicos nombres que el motor reconoce en `food`."""
    out = []
    seen = set()
    for f in menus.menu_table(user):
        name = (f.name_en if lang == "en" else f.name_es) or f.name_es or f.name_en
        key = fold(name)
        if key in seen:
            continue
        seen.add(key)
        out.append([name, f.per, *(None if getattr(f, n) is None else round(getattr(f, n), 1)
                                   for n in ("kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"))])
    return out


def _chain_summary(user) -> dict:
    """El catálogo de la cadena (F13), resumido: los productos buenos o regulares con el alimento
    genérico al que equivalen. Sirve para elegir alimentos que el usuario encuentra en su súper."""
    rows = ChainProduct.objects.filter(profile=user.profile)
    if not rows.exists():
        return {"chains": [], "products": []}
    order = {product_rating.GOOD: 0, product_rating.FAIR: 1}
    found = [p for p in rows if p.rating in order and p.equivalent_of]
    found.sort(key=lambda p: (order[p.rating], fold(p.equivalent_of), fold(p.name)))
    return {
        "chains": sorted({p.chain for p in rows}),
        "products": [
            {"name": p.name, "equivalent_of": p.equivalent_of, "chain": p.chain, "pack": p.pack or None,
             "rating": p.rating}
            for p in found[:CHAIN_PRODUCTS]
        ],
    }


def _recent(user) -> list[dict]:
    """Los últimos menús con sus platos (sin cantidades), para variar y para repetir lo que gustó."""
    out = []
    for plan in MealPlan.objects.filter(profile=user.profile)[:RECENT_MENUS]:
        dishes: dict[str, dict] = {}
        for day in plan.days:
            for meal in day.get("meals") or []:
                for d in meal.get("dishes") or []:
                    dishes.setdefault(fold(d["dish"]), {"meal": meal.get("meal", ""), "dish": d["dish"]})
        out.append({
            "start": plan.start_date.isoformat(),
            "end": plan.end_date.isoformat() if plan.end_date else None,
            "title": plan.title or None,
            "origin": menus.origin_of(plan.source),
            "dishes": list(dishes.values()),
        })
    return out


def _avoid(user, start: date) -> list[str]:
    """Platos que no pueden salir: los de los `NO_REPEAT_DAYS` antes del inicio y los
    `never_again`."""
    names = {}
    for day in menus.previous_days(user, start):
        for meal in day.get("meals") or []:
            for d in meal.get("dishes") or []:
                names.setdefault(fold(d["dish"]), d["dish"])
    for dish in menus.coach_tastes_for(user).dishes("never_again"):
        names.setdefault(fold(dish), dish)
    return list(names.values())


def _example(lang: str, start: date, meals: list[str], tupper: list[str]) -> dict:
    """Un esqueleto del JSON `schema: 1` con un plato de ejemplo de FightLab (`menu_dishes`)."""
    labels = MEAL_LABELS[lang]
    first = meals[0]
    dish = next((d for d in DISHES if first in d["meals"]), DISHES[0])
    table = {fold(f.name_es): f for f in menus._engine_table(None)}

    def name(food: str) -> str:
        found = table.get(fold(food))
        return (found.name_en if lang == "en" else found.name_es) if found else food

    return {
        "schema": 1,
        "id": f"{AI_ID_PREFIX}{start.isoformat()}",
        "start": start.isoformat(),
        "end": start.isoformat(),
        "title": "…",
        "notes": [],
        "days": [{
            "date": start.isoformat(),
            "meals": [{"meal": labels[first], "dish_id": "D1", "tupper": first in tupper}],
        }],
        "dishes": {
            "D1": {
                "name": dish[lang],
                "source": None,
                "batch_servings": None,
                "steps": ["…"],
                "seasoning": list(dish["seasoning"][lang]),
                "ingredients": [{"food": name(food), "grams": grams} for food, grams in dish["items"][:3]],
            },
        },
    }


def context_data(user, today: date, lang: str, *, start: date | None = None, days: int = DEFAULT_DAYS,
                 meals: list[str] | None = None, tupper: list[str] | None = None) -> dict:
    """`GET /menu/context`. Lanza `menus.MenuBlocked` sin objetivos de kcal y `ProfileIncomplete`
    si falta un dato del perfil (sin objetivos no hay menú que comprobar)."""
    lang = _lang(lang)
    targets = menus.menu_targets(user, today)
    start = start or default_start(user, today)
    meals = list(meals or menus.DEFAULT_MEALS)
    tupper = [m for m in (tupper or []) if m in meals]
    tastes = menus.tastes_data(user)
    equipment = kitchen.equipment_of(user.profile)
    end = start + timedelta(days=days - 1)
    return {
        "context_version": CONTEXT_VERSION,
        "app": "FightLab",
        "lang": lang,
        "today": today.isoformat(),
        "request": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "days": days,
            "meals": meals,
            "meal_labels": {m: MEAL_LABELS[lang][m] for m in meals},
            "tupper_meals": tupper,
            "id": f"{AI_ID_PREFIX}{start.isoformat()}",
        },
        "targets": {k: v for k, v in targets.items() if k != "rules"},
        "rules": {
            "kcal_margin": MENU_KCAL_MARGIN,
            "no_repeat_days": mealplan.NO_REPEAT_DAYS,
            "max_days": menu_import.MAX_DAYS,
        },
        "tastes": {k: tastes[k] for k in (*menus.TASTE_FIELDS, "favoured", "disliked", "excluded") if k in tastes},
        "kitchen": {
            "filled": bool(equipment),
            "equipment": equipment,
            "diners": [
                {"diner": i + 1, "restrictions": d["restrictions"]}
                for i, d in enumerate(kitchen.diners_of(user.profile))
            ],
            "categories": {k: list(v) for k, v in sorted(kitchen.categories().items())},
        },
        "recipes": [
            {"dish": r["dish"], "meal": r["meal"] or None, "rating": r["rating"], "items": r["items"],
             "seasoning": r["seasoning"], "steps": r["steps"], "source": r["source"] or None}
            for r in menus._favoured(user)
        ],
        "avoid_dishes": _avoid(user, start),
        "recent_menus": _recent(user),
        "foods_columns": FOOD_COLUMNS,
        "foods": _foods(user, lang),
        "chain_catalogue": _chain_summary(user),
        "format": _example(lang, start, meals, tupper),
        "instructions": instructions(lang, start, end, days, meals, tupper),
    }


# ---------------------------------------------------------------- instrucciones

_INSTRUCTIONS = {
    "es": """Eres el planificador de menús de FightLab. Con los datos JSON de abajo, prepara un menú y responde SOLO con un objeto JSON `schema: 1`, sin texto antes ni después y sin comentarios.

Qué menú:
- Del {start} al {end} ({days} días), con estas comidas cada día: {meals}.
- Para llevar en tupper (frío o recalentable, sin cocinar al momento): {tupper}.
- En cada comida, "meal" lleva su etiqueta de "request.meal_labels". El "id" del menú es "{id}".

Formato (copia la forma de "format"):
- "schema": 1, "id", "start", "end", "title" y "notes" (opcional).
- "days": uno por fecha, en orden, con "date" y "meals": [{{"meal", "dish_id", "tupper"}}].
- "dishes": cada plato una vez, por su id: "name", "ingredients": [{{"food", "grams"}}] ("ml" solo en productos por 100 ml), "seasoning", "steps" y, si se cocina una vez para varios días, "batch_servings": N y "steps_batch".
- Las cantidades son una ración: lo que come esta persona en esa comida.

Reglas (el motor de FightLab las comprueba al subir el menú):
1. Cada "food" es exactamente un nombre de "foods" (columnas en "foods_columns", valores por 100 g o 100 ml). Un nombre que no está no cuenta y ese día no pasa.
2. Cada día: kcal entre "targets.kcal" y un {margin} % más; proteína ("protein_g"), fibra ("fibre_g") y grasa mínima ("fat_min_g") al menos su objetivo. Los carbohidratos rellenan el resto. Reparte la proteína entre las comidas.
3. Ningún plato se repite en {no_repeat} días, ni sale ninguno de "avoid_dishes". Un plato de tanda con "batch_servings": N puede salir hasta N veces, siempre con los mismos ingredientes.
4. Nunca uses nada de "tastes.allergies" ni de "tastes.intolerances". Evita "disliked_foods", "untried" y "excluded". Prefiere "loved_foods", "cuisines", "flavours" y los platos de "recipes".
5. Comensales ("kitchen.diners"): en las comidas de cada restricción ("meals" vacío = todas), nada de lo que "exclude", salvo lo de "allow". "kitchen.categories" dice qué alimentos entran en cada palabra (p. ej. "pescado").
6. Cocina solo con "kitchen.equipment" (vacío = cocina sencilla) y respeta "cooking_minutes", "cooking_skill" y "budget".
7. Hierbas, especias, sal, pimienta, vinagre y zumo de limón van en "seasoning", sin gramos. Aceite, mantequilla, salsas, miel o queso son ingredientes con sus gramos.
8. Sin comida libre salvo que el usuario la pida. No pongas "totals": los calcula el motor.
9. Si "chain_catalogue" tiene productos, usa sobre todo los alimentos de su "equivalent_of".""",
    "en": """You are FightLab's menu planner. Using the JSON data below, prepare a menu and reply ONLY with a `schema: 1` JSON object, with no text before or after it and no comments.

The menu:
- From {start} to {end} ({days} days), with these meals every day: {meals}.
- Packed in a lunchbox (cold or reheatable, no last-minute cooking): {tupper}.
- Each meal's "meal" is its label from "request.meal_labels". The menu "id" is "{id}".

Format (copy the shape of "format"):
- "schema": 1, "id", "start", "end", "title" and "notes" (optional).
- "days": one per date, in order, with "date" and "meals": [{{"meal", "dish_id", "tupper"}}].
- "dishes": each dish once, by its id: "name", "ingredients": [{{"food", "grams"}}] ("ml" only for products per 100 ml), "seasoning", "steps" and, when it is cooked once for several days, "batch_servings": N and "steps_batch".
- Amounts are one serving: what this person eats at that meal.

Rules (FightLab's engine checks them when the menu is uploaded):
1. Every "food" is exactly a name from "foods" (columns in "foods_columns", values per 100 g or 100 ml). A name that is not there does not count and that day fails.
2. Every day: kcal from "targets.kcal" up to {margin} % more; protein ("protein_g"), fibre ("fibre_g") and minimum fat ("fat_min_g") at least their target. Carbohydrate fills the rest. Spread protein over the meals.
3. No dish repeats within {no_repeat} days, and none from "avoid_dishes" appears. A batch dish with "batch_servings": N may appear up to N times, always with the same ingredients.
4. Never use anything in "tastes.allergies" or "tastes.intolerances". Avoid "disliked_foods", "untried" and "excluded". Prefer "loved_foods", "cuisines", "flavours" and the dishes in "recipes".
5. Diners ("kitchen.diners"): at the meals of each restriction (empty "meals" = all), nothing they "exclude", except what they "allow". "kitchen.categories" lists the foods each word covers (e.g. "fish").
6. Cook only with "kitchen.equipment" (empty = simple cooking) and respect "cooking_minutes", "cooking_skill" and "budget".
7. Herbs, spices, salt, pepper, vinegar and lemon juice go in "seasoning", without grams. Oil, butter, sauces, honey or cheese are ingredients with their grams.
8. No free meal unless the user asks for one. Do not add "totals": the engine computes them.
9. When "chain_catalogue" has products, favour the foods in their "equivalent_of".""",
}


def instructions(lang: str, start: date, end: date, days: int, meals: list[str], tupper: list[str]) -> str:
    lang = _lang(lang)
    labels = MEAL_LABELS[lang]
    none = "ninguna" if lang == "es" else "none"
    return _INSTRUCTIONS[lang].format(
        start=start.isoformat(),
        end=end.isoformat(),
        days=days,
        meals=", ".join(labels[m] for m in meals),
        tupper=", ".join(labels[m] for m in tupper) or none,
        id=f"{AI_ID_PREFIX}{start.isoformat()}",
        margin=round(MENU_KCAL_MARGIN * 100),
        no_repeat=mealplan.NO_REPEAT_DAYS,
    )


# ---------------------------------------------------------------- lo que devuelve la IA


def _json_slice(text: str) -> str:
    """Del primer `{` al último `}`: quita las vallas ```json y el texto que la IA añade alrededor."""
    first, last = text.find("{"), text.rfind("}")
    return text[first:last + 1] if first != -1 and last > first else text


def ai_menu_id(menu_id: str) -> str:
    """Un menú de la IA lleva su propio id (`ia-…`): así nunca pisa un menú importado de la F12 con
    el mismo id, y subir otra versión del mismo menú lo sustituye en la misma fila."""
    if menu_id.startswith(AI_ID_PREFIX):
        return menu_id[: menu_import.ID_MAX]
    return f"{AI_ID_PREFIX}{menu_id}"[: menu_import.ID_MAX]


def parse_pasted(value) -> menu_import.ParsedMenu:
    """El JSON `schema: 1` de la IA del usuario, como objeto o como el texto pegado tal cual.

    Errores claros (`ImportInvalid`): `paste_empty`, `paste_not_json` (con línea y columna),
    `paste_no_schema` y los del importador de la F12 (`import_invalid` con dónde falla)."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise menu_import.ImportInvalid("paste_empty", "menu")
        if len(text.encode("utf-8")) > menu_import.MAX_BYTES:
            raise menu_import.ImportInvalid("import_invalid", "size")
        try:
            data = json.loads(_json_slice(text))
        except json.JSONDecodeError as exc:
            raise menu_import.ImportInvalid(
                "paste_not_json", f"line {exc.lineno}, column {exc.colno}: {exc.msg}", line=exc.lineno, column=exc.colno
            ) from None
    elif value is None:
        raise menu_import.ImportInvalid("paste_empty", "menu")
    else:
        data = value
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise menu_import.ImportInvalid("paste_no_schema", "schema")
    parsed = menu_import.parse_schema1(data, source=MealPlan.Source.USER_AI)
    parsed.menu_id = ai_menu_id(parsed.menu_id)
    return parsed


def check_data(user, parsed: menu_import.ParsedMenu, today: date) -> dict:
    """La comprobación del motor sin guardar nada (`dry_run`): lo que la skill enseña a la IA para
    que corrija los días que no pasan."""
    days, result = menu_import.preflight(user, parsed, today)
    unknown = sorted({u for d in days for u in d["totals"].get("unknown") or []})
    return {
        "dry_run": True,
        "checked": bool(days),
        "ok": bool(days) and all(d["ok"] for d in days),
        "summary": menu_import.summary(parsed),
        "days": [
            {"date": d["date"], "ok": d["ok"], "check": d["check"], "totals": d["totals"], "repeats": d["repeats"],
             "blocking": [{"kind": f["kind"], "entry": f["entry"], "dish": f.get("dish")} for f in d["blocking"]]}
            for d in days
        ],
        "unknown_foods": unknown,
        "repeats": result.get("repeats", []),
        "taste_flags": result.get("taste_flags", []),
        "targets": {k: v for k, v in (result.get("targets") or {}).items() if k != "rules"},
    }
