"""Importar menús completos (fase 12): el JSON `schema: 1` de la app, el YAML del coach y los
`menus` de la copia de ParteDiario.

**JSON `schema: 1`** (`menus-app/*.json`, `para-amigo/menu-ejemplo.json`):

- `id`, `start`, `end`, `title`, `targets`, `notes`;
- `days[]`: `date`, `totals` y `meals[]` con `meal` (Desayuno, Comida...), `dish_id`, `dish`,
  `tupper`, `free`, `free_budget_kcal`, `prep` (qué preparar ese día) y `eve[]` (qué dejar hecho
  la noche antes);
- `dishes{id}`: `name`, `source`, `batch_servings`, `steps`, `steps_batch` (texto o
  `{step, min, where}`), `steps_day`, `storage`, `seasoning` e `ingredients[{food, grams|ml}]`;
- `batch_sessions[]`: `date`, `dishes[]` (ids), `eve[]` y `timeline[{min, until, where, step}]`
  (`where` es el aparato; `min` y `until`, minutos desde el inicio de la sesión);
- `shopping`: `items[]` con `name`, `grams`/`ml`, `grams_two`/`ml_two` (para dos), `chain`,
  `section`, `pack` (formato: "pollo picado", no "pollo"), `when` (semana 1, 2 o las dos),
  `dishes[]` y `batches`; `note`; `batches[]`.

Faltan muchos de estos campos en los menús antiguos: todo es opcional salvo `days`.

**YAML del coach** (`data/menus/<fecha>.yaml`, lo que guarda `coach mealplan save`): `days[]` con
`meals[].dishes[]` en el formato de borrador (`dish`, `source`, `servings`, `steps`, `seasoning`,
`items: [NAME=GRAMOS]`). Su `id` es la fecha del nombre del archivo (o la del primer día).

Todo se pasa al formato de borrador de `coach.mealplan` (lo que ya guardaba la F8), así el motor
comprueba cada día, la pantalla Hoy marca las comidas y la lista de la compra sale igual. Lo que
el borrador no tiene (platos por id, sesiones de batch, lista con sección y formato) va en sus
campos de `MealPlan`. Un menú importado no se rechaza por no cuadrar con los objetivos: se guarda
con la comprobación del motor, que la pantalla enseña.

Si se reimporta el mismo `id`, sustituye al anterior **en la misma fila**: lo tachado de la lista
(`ShoppingCheck`) se queda, y lo marcado en Hoy (`MealCheck`, por fecha y comida) no se toca.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime

import yaml
from coach import mealplan, safety
from coach.profile import ProfileIncomplete
from coach.text import fold
from django.db import transaction
from django.utils import timezone

from . import kitchen, menus
from .bridge.adapters import to_coach_profile
from .keys import slugify
from .models import MealPlan, ShoppingCheck

# convention (FightLab): un menú importado cubre de 1 a 35 días (los de la app son de 14).
MAX_DAYS = 35
MAX_DISHES = 150
MAX_ITEMS = 400
MAX_SESSIONS = 10
MAX_TIMELINE = 120
MAX_LIST = 40
TEXT_MAX = 500
ID_MAX = MealPlan._meta.get_field("menu_id").max_length
TITLE_MAX = MealPlan._meta.get_field("title").max_length
MAX_BYTES = 2 * 1024 * 1024
# Nombre de cada comida en los menús → clave de FightLab (la de `menus.MEALS` y Hoy).
MEAL_KEYS = {
    "desayuno": "breakfast", "breakfast": "breakfast",
    "comida": "lunch", "almuerzo": "lunch", "lunch": "lunch",
    "merienda": "snack", "snack": "snack", "media manana": "snack",
    "cena": "dinner", "dinner": "dinner",
}
WEEKS = {"1": [1], "2": [2], "week1": [1], "week2": [2], "semana 1": [1], "semana 2": [2],
         "both": [1, 2], "ambas": [1, 2], "las dos": [1, 2], "all": [1, 2]}
STORAGE_KEYS = ("fridge_days", "freezer", "freeze", "reheat", "note", "where")


class ImportInvalid(ValueError):
    def __init__(self, code: str = "import_invalid", detail: str = "", **params):
        super().__init__(code)
        self.code = code
        self.detail = detail
        self.params = params


@dataclass
class ParsedMenu:
    menu_id: str
    source: str
    start: date
    end: date
    title: str = ""
    notes: list[str] = field(default_factory=list)
    days: list[dict] = field(default_factory=list)
    dishes: dict = field(default_factory=dict)
    batch_sessions: list[dict] = field(default_factory=list)
    shopping: dict = field(default_factory=dict)


def _need(ok: bool, detail: str) -> None:
    if not ok:
        raise ImportInvalid("import_invalid", detail)


def _text(value, where: str, max_len: int = TEXT_MAX, required: bool = False) -> str:
    if value is None:
        _need(not required, where)
        return ""
    _need(isinstance(value, (str, int, float)) and not isinstance(value, bool), where)
    out = " ".join(str(value).split())
    _need(len(out) <= max_len and (out or not required), where)
    return out


def _texts(value, where: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    _need(isinstance(value, list) and len(value) <= MAX_LIST, where)
    return [t for t in (_text(v, where) for v in value) if t]


def _number(value, where: str, low: float = 0, high: float = 100_000, required: bool = False):
    if value is None:
        _need(not required, where)
        return None
    _need(isinstance(value, (int, float)) and not isinstance(value, bool) and low <= value <= high, where)
    return round(float(value), 2)


def _date(value, where: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ImportInvalid("import_invalid", where) from None


def meal_key(label: str, taken: set[str]) -> str:
    key = MEAL_KEYS.get(fold(label).strip()) or slugify(label) or "meal"
    base, n = key, 2
    while key in taken:
        key, n = f"{base}-{n}", n + 1
    taken.add(key)
    return key


def _storage(value, where: str):
    if value is None:
        return None
    if isinstance(value, str):
        return {"note": _text(value, where)}
    _need(isinstance(value, dict), where)
    out = {}
    for k in STORAGE_KEYS:
        if k in value and value[k] is not None:
            v = value[k]
            out[k] = v if isinstance(v, bool) else (_number(v, where, 0, 365) if k == "fridge_days" else _text(v, where))
    return out or None


def _batch_steps(value, where: str) -> list:
    if value is None:
        return []
    _need(isinstance(value, list) and len(value) <= MAX_LIST, where)
    out = []
    for step in value:
        if isinstance(step, dict):
            entry = {"step": _text(step.get("step"), where, required=True)}
            minutes = _number(step.get("min"), where, 0, 600)
            if minutes:
                entry["min"] = int(round(minutes))
            if step.get("where") is not None:
                label = _text(step.get("where"), where, 60)
                entry["where"] = kitchen.appliance(label) or "hands"
                entry["where_label"] = label
            out.append(entry)
        else:
            text = _text(step, where)
            if text:
                out.append(text)
    return out


def _ingredients(value, where: str) -> list[dict]:
    _need(isinstance(value, list) and 0 < len(value) <= MAX_LIST, where)
    out = []
    for item in value:
        _need(isinstance(item, dict), where)
        food = _text(item.get("food") or item.get("name"), where, 200, required=True)
        _need("=" not in food, where)
        if item.get("ml") is not None:
            out.append({"food": food, "ml": _number(item["ml"], where, 0.1, 20_000, required=True)})
        else:
            out.append({"food": food, "grams": _number(item.get("grams"), where, 0.1, 20_000, required=True)})
    return out


def _item_line(item: dict) -> str:
    if "ml" in item:
        return f"{item['food']}={item['ml']:g}ml"
    return f"{item['food']}={item['grams']:g}"


def _dish(dish_id: str, raw) -> dict:
    where = f"dishes.{dish_id}"
    _need(isinstance(raw, dict), where)
    servings = raw.get("batch_servings")
    _need(servings is None or (isinstance(servings, int) and not isinstance(servings, bool) and 1 <= servings <= 50), where)
    return {
        "name": _text(raw.get("name"), where, 300, required=True),
        "source": _text(raw.get("source"), where) or None,
        "batch_servings": servings,
        "steps": _texts(raw.get("steps"), where),
        "steps_batch": _batch_steps(raw.get("steps_batch"), where),
        "steps_day": _texts(raw.get("steps_day"), where),
        "storage": _storage(raw.get("storage"), where),
        "seasoning": _texts(raw.get("seasoning"), where),
        "ingredients": _ingredients(raw.get("ingredients"), where),
    }


def _draft_dish(dish_id: str, dish: dict) -> dict:
    """Un plato en el formato de borrador de `coach.mealplan`: una ración, lo que se come."""
    return {
        "id": dish_id,
        "dish": dish["name"],
        **({"source": dish["source"]} if dish.get("source") else {}),
        **({"servings": dish["batch_servings"]} if (dish.get("batch_servings") or 1) > 1 else {}),
        "steps": dish["steps_day"] or dish["steps"],
        "seasoning": dish["seasoning"],
        "items": [_item_line(i) for i in dish["ingredients"]],
    }


def _week(value, where: str) -> list[int]:
    if value is None:
        return []
    if isinstance(value, list):
        out = sorted({int(v) for v in value if isinstance(v, int) and not isinstance(v, bool) and v in (1, 2)})
        _need(len(out) == len([v for v in value if v is not None]), where)
        return out
    key = fold(str(value)).strip()
    _need(key in WEEKS, where)
    return WEEKS[key]


def _shopping(raw) -> dict:
    if raw is None:
        return {}
    _need(isinstance(raw, dict), "shopping")
    items = raw.get("items") or []
    _need(isinstance(items, list) and len(items) <= MAX_ITEMS, "shopping.items")
    out_items = []
    for item in items:
        _need(isinstance(item, dict), "shopping.items")
        entry = {"name": _text(item.get("name"), "shopping.items", 200, required=True)}
        for key in ("grams", "ml", "grams_two", "ml_two"):
            value = _number(item.get(key), "shopping.items", 0, 200_000)
            if value is not None:
                entry[key] = value
        for key in ("chain", "section", "pack"):
            value = _text(item.get(key), "shopping.items", 200)
            if value:
                entry[key] = value
        entry["when"] = _week(item.get("when"), "shopping.items.when")
        entry["dishes"] = _texts(item.get("dishes"), "shopping.items.dishes")
        batches = item.get("batches")
        if batches is not None:
            entry["batches"] = int(_number(batches, "shopping.items.batches", 0, 100)) if not isinstance(batches, list) else _texts(batches, "shopping.items.batches")
        out_items.append(entry)
    batches = raw.get("batches") or []
    _need(isinstance(batches, list) and len(batches) <= MAX_DISHES, "shopping.batches")
    out_batches = []
    for b in batches:
        _need(isinstance(b, dict), "shopping.batches")
        out_batches.append({
            "dish": _text(b.get("dish"), "shopping.batches", 300, required=True),
            "servings": int(_number(b.get("servings"), "shopping.batches", 0, 100) or 0),
            "dates": [_date(d, "shopping.batches.dates").isoformat() for d in (b.get("dates") or [])][:MAX_DAYS],
            "left_over": int(_number(b.get("left_over"), "shopping.batches", 0, 100) or 0),
        })
    return {"items": out_items, "note": _text(raw.get("note"), "shopping.note", 1000), "batches": out_batches}


def _sessions(raw, dishes: dict) -> list[dict]:
    if raw is None:
        return []
    _need(isinstance(raw, list) and len(raw) <= MAX_SESSIONS, "batch_sessions")
    out = []
    for session in raw:
        _need(isinstance(session, dict), "batch_sessions")
        ids = [str(d) for d in session.get("dishes") or []]
        _need(all(d in dishes for d in ids), "batch_sessions.dishes")
        timeline = session.get("timeline") or []
        _need(isinstance(timeline, list) and len(timeline) <= MAX_TIMELINE, "batch_sessions.timeline")
        lines = []
        for entry in timeline:
            _need(isinstance(entry, dict), "batch_sessions.timeline")
            start = _number(entry.get("min"), "timeline.min", 0, 1440, required=True)
            until = _number(entry.get("until"), "timeline.until", 0, 1440, required=True)
            _need(until > start, "timeline.until")
            label = _text(entry.get("where"), "timeline.where", 60, required=True)
            line = {
                "min": int(round(start)), "until": int(round(until)),
                "where": kitchen.appliance(label) or "hands", "where_label": label,
                "step": _text(entry.get("step"), "timeline.step", required=True),
            }
            dish = entry.get("dish")
            if dish is not None and str(dish) in dishes:
                line["dish"] = str(dish)
            lines.append(line)
        out.append({
            "date": _date(session.get("date"), "batch_sessions.date").isoformat(),
            "dishes": ids,
            "eve": _texts(session.get("eve"), "batch_sessions.eve"),
            "timeline": sorted(lines, key=lambda e: (e["min"], e["until"])),
        })
    return sorted(out, key=lambda s: s["date"])


def _check_days(days: list[dict]) -> tuple[date, date]:
    _need(isinstance(days, list) and days, "days")
    _need(len(days) <= MAX_DAYS, "days")
    dates = [date.fromisoformat(d["date"]) for d in days]
    _need(dates == sorted(set(dates)), "days.order")
    if len(days) > MAX_DAYS or (dates[-1] - dates[0]).days >= MAX_DAYS:
        raise ImportInvalid("import_too_long", "days", max=MAX_DAYS)
    return dates[0], dates[-1]


def parse_schema1(data: dict, source: str = MealPlan.Source.JSON, fallback_id: str = "") -> ParsedMenu:
    _need(isinstance(data, dict) and data.get("schema") == 1, "schema")
    raw_days = data.get("days")
    _need(isinstance(raw_days, list) and raw_days, "days")
    if len(raw_days) > MAX_DAYS:
        raise ImportInvalid("import_too_long", "days", max=MAX_DAYS)
    raw_dishes = data.get("dishes") or {}
    _need(isinstance(raw_dishes, dict) and len(raw_dishes) <= MAX_DISHES, "dishes")
    dishes = {_text(k, "dishes", 60, required=True): _dish(str(k), v) for k, v in raw_dishes.items()}
    days = []
    for raw_day in raw_days:
        _need(isinstance(raw_day, dict), "days")
        when = _date(raw_day.get("date"), "days.date")
        meals_raw = raw_day.get("meals")
        _need(isinstance(meals_raw, list) and meals_raw, f"{when}: meals")
        taken: set[str] = set()
        meals = []
        for raw in meals_raw:
            _need(isinstance(raw, dict), f"{when}: meal")
            label = _text(raw.get("meal"), f"{when}: meal", 60, required=True)
            free = raw.get("free") is True
            meal = {
                "meal": meal_key(label, taken),
                "label": label,
                "tupper": raw.get("tupper") is True,
                "free": free,
                "eve": _texts(raw.get("eve"), f"{when}: eve"),
            }
            prep = raw.get("prep")
            if prep is not None:
                meal["prep"] = _texts(prep, f"{when}: prep")
            if free:
                meal["free_budget_kcal"] = _number(raw.get("free_budget_kcal"), f"{when}: free_budget_kcal", 0, 10_000)
                meal["dishes"] = []
            else:
                dish_id = _text(raw.get("dish_id"), f"{when}: dish_id", 60, required=True)
                _need(dish_id in dishes, f"{when}: dish_id {dish_id}")
                meal["dish_id"] = dish_id
                meal["dishes"] = [_draft_dish(dish_id, dishes[dish_id])]
            meals.append(meal)
        day = {"date": when.isoformat(), "meals": meals}
        if isinstance(raw_day.get("totals"), dict):
            day["totals"] = {k: _number(v, f"{when}: totals", 0, 100_000) for k, v in raw_day["totals"].items()
                             if k in ("kcal", "protein_g", "carbs_g", "fat_g", "fibre_g")}
        days.append(day)
    start, end = _check_days(days)
    menu_id = _text(data.get("id"), "id", ID_MAX) or fallback_id or start.isoformat()
    return ParsedMenu(
        menu_id=menu_id,
        source=source,
        start=start,
        end=end,
        title=_text(data.get("title"), "title", TITLE_MAX),
        notes=_texts(data.get("notes"), "notes"),
        days=days,
        dishes=dishes,
        batch_sessions=_sessions(data.get("batch_sessions"), dishes),
        shopping=_shopping(data.get("shopping")),
    )


def parse_coach_yaml(data: dict, filename: str = "") -> ParsedMenu:
    """Un menú guardado por el coach: ya está en formato de borrador."""
    _need(isinstance(data, dict) and isinstance(data.get("days"), list) and data["days"], "days")
    if len(data["days"]) > MAX_DAYS:
        raise ImportInvalid("import_too_long", "days", max=MAX_DAYS)
    dishes: dict[str, dict] = {}
    days = []
    for raw_day in data["days"]:
        _need(isinstance(raw_day, dict), "days")
        when = _date(raw_day.get("date"), "days.date")
        meals_raw = raw_day.get("meals")
        _need(isinstance(meals_raw, list) and meals_raw, f"{when}: meals")
        taken: set[str] = set()
        meals = []
        for raw in meals_raw:
            _need(isinstance(raw, dict), f"{when}: meal")
            label = _text(raw.get("meal"), f"{when}: meal", 60) or "meal"
            free = raw.get("free") is True
            meal = {"meal": meal_key(label, taken), "label": label, "tupper": raw.get("tupper") is True,
                    "free": free, "eve": _texts(raw.get("eve"), f"{when}: eve"), "dishes": []}
            for entry in [] if free else (raw.get("dishes") or []):
                _need(isinstance(entry, dict), f"{when}: dish")
                name = _text(entry.get("dish"), f"{when}: dish", 300, required=True)
                items = [_text(i, f"{when}: items", 300, required=True) for i in entry.get("items") or []]
                _need(items and all("=" in i for i in items), f"{when}: {name}: items")
                servings = entry.get("servings", 1)
                _need(isinstance(servings, int) and not isinstance(servings, bool) and 1 <= servings <= 50, f"{when}: servings")
                dish_id = slugify(name)[:60] or "dish"
                draft = {"id": dish_id, "dish": name, **({"source": entry["source"]} if entry.get("source") else {}),
                         **({"servings": servings} if servings > 1 else {}),
                         "steps": _texts(entry.get("steps"), f"{when}: steps"),
                         "seasoning": _texts(entry.get("seasoning"), f"{when}: seasoning"), "items": items}
                meal["dishes"].append(draft)
                dishes.setdefault(dish_id, {
                    "name": name, "source": draft.get("source"), "batch_servings": servings if servings > 1 else None,
                    "steps": draft["steps"], "steps_batch": [], "steps_day": [], "storage": None,
                    "seasoning": draft["seasoning"],
                    "ingredients": [{"food": i.rpartition("=")[0].strip(), "line": i} for i in items],
                })
            if len(meal["dishes"]) == 1:
                meal["dish_id"] = meal["dishes"][0]["id"]
            _need(free or meal["dishes"], f"{when}: dishes")
            meals.append(meal)
        day = {"date": when.isoformat(), "meals": meals}
        if isinstance(raw_day.get("totals"), dict):
            day["totals"] = {k: v for k, v in raw_day["totals"].items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
        days.append(day)
    start, end = _check_days(days)
    stem = re.sub(r"\.ya?ml$", "", filename.rsplit("/", 1)[-1], flags=re.IGNORECASE)
    menu_id = stem if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stem) else start.isoformat()
    return ParsedMenu(menu_id=f"coach-{menu_id}", source=MealPlan.Source.YAML, start=start, end=end, days=days, dishes=dishes)


def parse_file(name: str, raw: bytes) -> ParsedMenu:
    """Un archivo subido: JSON `schema: 1` o YAML del coach (el contenido manda)."""
    if len(raw) > MAX_BYTES:
        raise ImportInvalid("import_invalid", "size")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportInvalid("import_invalid", "encoding") from None
    stripped = text.lstrip()
    if stripped.startswith("{"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise ImportInvalid("import_invalid", "json") from None
        return parse_schema1(data)
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        raise ImportInvalid("import_invalid", "yaml") from None
    if isinstance(data, dict) and data.get("schema") == 1:
        return parse_schema1(data)
    return parse_coach_yaml(data, name)


# ---------------------------------------------------------------- guardar


def _validate_draft(parsed: ParsedMenu) -> None:
    """El motor lee el borrador como lo leería el coach (`mealplan.parse`)."""
    try:
        mealplan.parse(menus._with_dates(parsed.days))
    except (ValueError, menus.MenuInvalid) as exc:
        raise ImportInvalid("import_invalid", str(exc)[:200]) from None


def _checks(user, today: date, days: list[dict]) -> tuple[list[dict], dict]:
    """La comprobación del motor de cada día; sin objetivos de kcal (o sin un dato del perfil) el
    menú se guarda sin ella."""
    try:
        result = menus.check_days(user, today, days)
    except (menus.MenuBlocked, ProfileIncomplete):
        return [], {}
    return result["days"], result


def save(user, parsed: ParsedMenu, today: date, *, replace_start: bool = False, keep_existing: bool = False) -> dict:
    """Guarda un menú importado. Devuelve `{plan, replaced, kept, ...}`.

    - Mismo `menu_id` que uno ya guardado: lo sustituye en la misma fila (se quedan lo tachado y
      los tickets). Con `keep_existing` (el "no pisar" de la F10) se deja como está.
    - Otro menú distinto que empieza el mismo día: `start_taken` (409) salvo `replace_start`.
    """
    _validate_draft(parsed)
    profile = user.profile
    if any(m["free"] for d in parsed.days for m in d["meals"]) and safety.eating_disorder_positive(to_coach_profile(user, today)):
        raise ImportInvalid("free_meal_refused", mealplan.FREE_MEAL_RULE)
    with transaction.atomic():
        existing = MealPlan.objects.select_for_update().filter(profile=profile, menu_id=parsed.menu_id).first()
        if existing and keep_existing:
            return {"plan": existing, "replaced": False, "kept": True, "kept_checks": 0}
        clash = MealPlan.objects.filter(profile=profile, start_date=parsed.start)
        if existing:
            clash = clash.exclude(pk=existing.pk)
        if clash.exists():
            if not replace_start:
                raise ImportInvalid("start_taken", parsed.start.isoformat())
            clash.delete()
        checks, result = _checks(user, today, parsed.days)
        values = {
            "start_date": parsed.start,
            "end_date": parsed.end,
            "title": parsed.title,
            "source": parsed.source,
            "notes": parsed.notes,
            "days": parsed.days,
            "dishes": parsed.dishes,
            "batch_sessions": parsed.batch_sessions,
            "shopping": parsed.shopping,
            "checks": checks,
            "rejected": [],
            "targets": result.get("targets", {}),
            "taste_flags": result.get("taste_flags", []),
            "provider": "import",
            "engine_sha": menus.engine_info()["sha_full"] if checks else "",
            "imported_at": timezone.now(),
        }
        if existing:
            for name, value in values.items():
                setattr(existing, name, value)
            existing.save()
            plan = existing
        else:
            plan = MealPlan.objects.create(profile=profile, menu_id=parsed.menu_id, **values)
    return {
        "plan": plan,
        "replaced": existing is not None,
        "kept": False,
        "kept_checks": ShoppingCheck.objects.filter(plan=plan).count() if existing else 0,
    }


def summary(parsed: ParsedMenu) -> dict:
    return {
        "menu_id": parsed.menu_id,
        "title": parsed.title,
        "start": parsed.start.isoformat(),
        "end": parsed.end.isoformat(),
        "days": len(parsed.days),
        "dishes": len(parsed.dishes),
        "batch_sessions": len(parsed.batch_sessions),
        "shopping_items": len(parsed.shopping.get("items") or []),
        "source": parsed.source,
    }


def apply_shopping_checks(plan: MealPlan, items: list[str]) -> int:
    """Tacha en la lista de `plan` las líneas de `items` (nombres), sin repetir."""
    keys = {fold(i).strip()[:200] for i in items if str(i).strip()}
    have = set(ShoppingCheck.objects.filter(plan=plan, item_key__in=keys).values_list("item_key", flat=True))
    ShoppingCheck.objects.bulk_create(ShoppingCheck(plan=plan, item_key=k) for k in sorted(keys - have))
    return len(keys - have)
