"""Menús y lista de la compra (fase 8), siguiendo `menu/SKILL.md` del coach.

Del motor solo se usan funciones puras (Task 8.1, `U07` en `docs/coach-upstream-sugerencias.md`):

- `mealplan.parse`, `batches`, `repeats`, `taste_flags` y `shopping`, sobre días en memoria;
- `foods.menu_totals`, `foods.find` y `foods.parse_item`;
- `regions.menu_table(region)` sin `data_dir`: solo lee las tablas que trae el motor (USDA y la
  capa de la región), nunca datos del usuario;
- `cli.menu_check`, que compara los totales de un día con los objetivos.

Lo que en el coach lee o escribe archivos (`load_draft`, `mealplan.save`, `tastes.yaml`,
`catalogue.csv`, `recipes/`) aquí va a la base de datos: `Tastes`, `Recipe`, `CatalogueProduct` y
`MealPlan`. Los objetivos son los de `/coach/targets` (fase 4), con sus bloqueos.

El flujo (Task 8.4): un proveedor de LLM propone los platos (`menu_llm`), el motor comprueba cada
día contra los objetivos, que no se repita un plato en `NO_REPEAT_DAYS` y las alergias por nombre,
y el proveedor rehace los días que no pasan. Un día que el motor sigue rechazando no se guarda.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache

from coach import foods, mealplan, regions, safety
from coach import tastes as coach_tastes
from coach.cli import MENU_KCAL_MARGIN, menu_check
from coach.profile import ProfileIncomplete
from coach.text import fold
from django.db import transaction

from .bridge.adapters import to_coach_profile
from .bridge.reasons import Reason
from .models import CatalogueProduct, MealPlan, Recipe, Tastes
from .targets import reasons_data, rule_refs, targets_data
from .views import engine_info

MEALS = ("breakfast", "lunch", "dinner", "snack")
DEFAULT_MEALS = ("breakfast", "lunch", "dinner", "snack")
# convention (FightLab): un menú es de 1 a 7 días, como la semana del plan.
MAX_DAYS = 7
# convention (FightLab): rondas en las que el proveedor puede rehacer los días que el motor
# rechaza antes de dejarlos fuera.
MAX_ROUNDS = 3
OUTPUT_DECIMALS = 2
SAVED_RATINGS = ("loved", "liked")
TASTE_LIST_FIELDS = coach_tastes.LIST_FIELDS
TASTE_FIELDS = (*TASTE_LIST_FIELDS, "cooking_minutes", "cooking_skill", "budget")
# Los campos que `/menu` pregunta, sin el código postal (no se guarda: ver `models.Tastes`).
ASKED = tuple(f for f in coach_tastes.ASKED if f != "postal_code")


class MenuBlocked(Exception):
    """Sin objetivos de kcal (`no_calorie_targets`): no hay menú que comprobar."""

    def __init__(self, reasons):
        super().__init__("no_calorie_targets")
        self.reasons = reasons


class MenuInvalid(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


class MenuRejected(Exception):
    """El motor ha rechazado todos los días: no se guarda nada."""

    def __init__(self, rejected: list[dict]):
        super().__init__("menu_rejected")
        self.rejected = rejected


# ---------------------------------------------------------------- tablas y gustos


@lru_cache(maxsize=8)
def _engine_table(region: str | None) -> tuple[foods.Food, ...]:
    return tuple(regions.menu_table(region))


def _region(user) -> str | None:
    region = (user.profile.region or "").strip().lower() or None
    try:
        return region if region is None or regions.region_dir(region) else None
    except ValueError:  # región sin capa en el motor: solo la tabla base
        return None


def product_food(product: CatalogueProduct) -> foods.Food:
    """Como `catalogue.CatalogueProduct.as_food`, desde la BD."""
    return foods.Food(
        name_en=product.product_name,
        name_es=product.product_name,
        **{n: getattr(product, n) for n in foods.NUMBERS},
        source=product.source,
        source_id=product.url,
        barcode=product.barcode,
        chain=product.chain,
        per=product.per,
    )


def menu_table(user) -> list[foods.Food]:
    """Alimentos del motor, productos de la región y el catálogo del usuario."""
    table = list(_engine_table(_region(user)))
    table += [product_food(p) for p in CatalogueProduct.objects.filter(profile=user.profile) if p.per in foods.PER_UNITS]
    return table


def tastes_get(user) -> Tastes:
    return Tastes.objects.get_or_create(profile=user.profile)[0]


def coach_tastes_for(user) -> coach_tastes.Tastes:
    """`coach.tastes.Tastes` desde la BD, con las valoraciones de `Recipe`."""
    row = tastes_get(user)
    ratings = [
        coach_tastes.Rating(r.dish, r.rating, r.rated_on, r.source_url, r.note)
        for r in Recipe.objects.filter(profile=user.profile)
    ]
    return coach_tastes.Tastes(**{f: getattr(row, f) for f in TASTE_FIELDS}, ratings=ratings)


def tastes_update(user, values: dict) -> Tastes:
    """Guarda los gustos con las comprobaciones de `coach.tastes` (listas de palabras, minutos,
    nivel y presupuesto)."""
    row = tastes_get(user)
    for name, value in values.items():
        if name not in TASTE_FIELDS:
            raise MenuInvalid("tastes_invalid", name)
        if name in TASTE_LIST_FIELDS and isinstance(value, list):
            value = list(dict.fromkeys(" ".join(str(v).split()) for v in value if str(v).strip()))
        try:
            coach_tastes._check_value(name, value)
        except ValueError as exc:
            raise MenuInvalid("tastes_invalid", str(exc)) from None
        setattr(row, name, value)
    row.save()
    return row


def tastes_data(user) -> dict:
    row = tastes_get(user)
    current = coach_tastes_for(user)
    return {
        **{f: getattr(row, f) for f in TASTE_FIELDS},
        "missing": [f for f in ASKED if getattr(row, f) is None],
        "favoured": current.dishes("loved", "liked"),
        "disliked": current.dishes("disliked"),
        "excluded": current.dishes("never_again"),
    }


# ---------------------------------------------------------------- objetivos


def menu_targets(user, today: date) -> dict:
    """Los objetivos del día con los que el motor comprueba el menú: los de `/coach/targets`.

    Lanza `ProfileIncomplete` (409 con el campo) y `MenuBlocked` con `no_calorie_targets`. No
    lleva ninguna cifra de peso: con `no_weight_targets` el menú no puede enseñarlas."""
    data = targets_data(user, today, "en")
    if data["blocked"]:
        raise MenuBlocked([
            {"code": r["code"], "rule_key": r["rule_key"], "params": r["params"]} for r in data["reasons"]
        ])
    m = data["macros"]
    return {
        "kcal": data["kcal"],
        "protein_g": m["protein_g"],
        "fat_min_g": m["fat_min_g"],
        "fat_g": m["fat_g"],
        "carbs_g": m["carbs_g"],
        "fibre_g": m["fibre_g"],
        "in_deficit": data["in_deficit"],
        "rules": {name: [r["key"] for r in refs] for name, refs in data["rules"].items()},
    }


# ---------------------------------------------------------------- comprobación


def _with_dates(days: list[dict]) -> dict:
    """El borrador con fechas `date`, como las lee `mealplan.parse` del YAML."""
    out = []
    for day in days:
        when = day.get("date") if isinstance(day, dict) else None
        if isinstance(when, str):
            try:
                when = date.fromisoformat(when)
            except ValueError:
                raise MenuInvalid("draft_invalid", f"date: {when!r}") from None
        out.append({**day, "date": when} if isinstance(day, dict) else day)
    return {"days": out}


def _iso_days(days: list[dict]) -> list[dict]:
    return [{**d, "date": d["date"].isoformat() if isinstance(d["date"], date) else d["date"]} for d in days]


def _round(value):
    if isinstance(value, float):
        return round(value, OUTPUT_DECIMALS)
    if isinstance(value, dict):
        return {k: _round(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_round(v) for v in value]
    return value


def _flag_out(flag: dict) -> dict:
    return {**flag, "date": flag["date"].isoformat()}


def previous_days(user, start: date) -> list[dict]:
    """Los días ya guardados de los `NO_REPEAT_DAYS` anteriores a `start`, para no repetir platos
    entre un menú y el siguiente (en el coach, la skill mira los menús guardados)."""
    since = start - timedelta(days=mealplan.NO_REPEAT_DAYS)
    out: dict[str, dict] = {}
    for plan in MealPlan.objects.filter(profile=user.profile, start_date__lt=start, start_date__gte=since - timedelta(days=MAX_DAYS)):
        for day in plan.days:
            if since.isoformat() <= day["date"] < start.isoformat():
                out[day["date"]] = day
    return [out[k] for k in sorted(out)]


def check_days(user, today: date, days: list[dict], targets: dict | None = None) -> dict:
    """Comprueba un borrador (lista de días en el formato de `mealplan`) como `coach mealplan
    check`: totales y estado de cada objetivo por día, platos repetidos y gustos. No guarda nada.

    Un día vale (`ok`) si el motor da `ok` a kcal, proteína, grasa y fibra, no tiene alimentos
    desconocidos, no repite plato y no choca con una alergia o intolerancia."""
    targets = targets or menu_targets(user, today)
    try:
        _, parsed = mealplan.parse(_with_dates(days))
    except ValueError as exc:
        raise MenuInvalid("draft_invalid", str(exc)) from None
    profile = to_coach_profile(user, today)
    if any(day.free_meals for day in parsed) and safety.eating_disorder_positive(profile):
        raise MenuInvalid("free_meal_refused", mealplan.FREE_MEAL_RULE)
    table = menu_table(user)
    earlier = previous_days(user, parsed[0].date)
    if earlier:
        _, before = mealplan.parse(_with_dates(earlier))
        before = [d for d in before if d.date < parsed[0].date]
    else:
        before = []
    flags = mealplan.taste_flags(parsed, coach_tastes_for(user), table)
    new_dates = {d.date for d in parsed}
    repeats = [
        {"dish": r["dish"], "dates": [d.isoformat() for d in r["dates"]]}
        for r in mealplan.repeats(before + parsed)
        if new_dates & set(r["dates"])
    ]
    repeated_on = {d for r in repeats for d in r["dates"]}
    checked = []
    for day in parsed:
        try:
            totals = foods.menu_totals(day.items, table)
        except ValueError as exc:
            raise MenuInvalid("draft_invalid", f"{day.date}: {exc}") from None
        check = menu_check(dataclasses.asdict(totals), targets, day.share)
        blocking = [f for f in flags if f["date"] == day.date and f["blocking"]]
        iso = day.date.isoformat()
        engine_ok = not totals.unknown and set(check.values()) == {"ok"}
        checked.append({
            "date": iso,
            "totals": _round(dataclasses.asdict(totals)),
            "check": check,
            "share": round(day.share, 4),
            "repeats": iso in repeated_on,
            "blocking": [_flag_out(f) for f in blocking],
            "ok": engine_ok and not blocking and iso not in repeated_on,
        })
    return {
        "ok": all(c["ok"] for c in checked),
        "days": checked,
        "repeats": repeats,
        "taste_flags": [_flag_out(f) for f in flags],
        "targets": {k: v for k, v in targets.items() if k != "rules"},
    }


# ---------------------------------------------------------------- generar


@dataclass
class MenuRequest:
    start_date: date
    days: int = 3
    meals: list[str] = field(default_factory=lambda: list(DEFAULT_MEALS))
    tupper_meals: list[str] = field(default_factory=list)


@dataclass
class ProposalContext:
    """Lo que ve el proveedor de LLM: objetivos, gustos y lo que no puede repetir. Con
    `totals(items)` puede preguntar al motor por los totales de unos ingredientes, como hace la
    skill con `coach menu`: no hace cuentas propias."""

    lang: str
    targets: dict
    tastes: coach_tastes.Tastes
    meals: list[str]
    tupper_meals: list[str]
    avoid_dishes: set[str]
    favoured: list[dict]
    table: list[foods.Food]
    chosen: dict[str, list[str]] = field(default_factory=dict)  # platos propuestos por fecha

    def totals(self, items: list[str]) -> foods.MenuTotals:
        return foods.menu_totals([foods.parse_item(i) for i in items], self.table)

    def find(self, name: str) -> foods.Food | None:
        return foods.find(name, self.table)


def _favoured(user) -> list[dict]:
    """Platos valorados `loved` o `liked` con ingredientes: el recetario que se reutiliza antes de
    buscar platos nuevos (paso 4 de `/menu`)."""
    return [
        {"dish": r.dish, "source": r.source_url, "meal": r.meal, "items": r.items, "seasoning": r.seasoning,
         "steps": r.steps, "rating": r.rating}
        for r in Recipe.objects.filter(profile=user.profile, rating__in=SAVED_RATINGS).exclude(items=[])
        .order_by("rating", "dish")
    ]


def _validate_request(request: MenuRequest, today: date) -> None:
    if not 1 <= request.days <= MAX_DAYS:
        raise MenuInvalid("days_invalid")
    if not request.meals or set(request.meals) - set(MEALS) or len(set(request.meals)) != len(request.meals):
        raise MenuInvalid("meals_invalid")
    if set(request.tupper_meals) - set(request.meals):
        raise MenuInvalid("meals_invalid")
    if request.start_date < today - timedelta(days=1) or request.start_date > today + timedelta(days=28):
        raise MenuInvalid("start_invalid")


def _rejected(iso: str, check: dict | None) -> dict:
    """Por qué el motor rechazó un día, sin sus platos (no se guardan)."""
    if check is None:
        return {"date": iso, "check": None, "unknown": [], "repeats": False, "blocking": [], "empty": True}
    return {
        "date": iso, "check": check["check"], "unknown": check["totals"]["unknown"], "repeats": check["repeats"],
        "blocking": [{"kind": f["kind"], "entry": f["entry"]} for f in check["blocking"]], "empty": False,
    }


@transaction.atomic
def generate(user, today: date, request: MenuRequest, lang: str, proposer) -> tuple[MealPlan, list[dict]]:
    """Propone, comprueba y guarda un menú. Devuelve el menú guardado y los días rechazados.

    Los días que el motor rechaza vuelven al proveedor con su comprobación, hasta `MAX_ROUNDS`
    rondas; los que siguen sin pasar no se guardan. Sin ningún día bueno, `MenuRejected`."""
    _validate_request(request, today)
    targets = menu_targets(user, today)
    dates = [request.start_date + timedelta(days=i) for i in range(request.days)]
    table = menu_table(user)
    current = coach_tastes_for(user)
    earlier = previous_days(user, request.start_date)
    ctx = ProposalContext(
        lang=lang,
        targets={k: v for k, v in targets.items() if k != "rules"},
        tastes=current,
        meals=list(request.meals),
        tupper_meals=list(request.tupper_meals),
        avoid_dishes={fold(d) for d in current.dishes("never_again")}
        | {fold(dish["dish"]) for day in earlier for meal in day["meals"] for dish in meal.get("dishes") or []},
        favoured=_favoured(user),
        table=table,
    )
    drafts = {d.isoformat(): d_ for d, d_ in zip(dates, proposer.propose(ctx, dates, 0, None), strict=True)}
    for attempt in range(1, MAX_ROUNDS + 1):
        # Un día sin platos (el proveedor no ha encontrado ninguno) no llega al motor: se rechaza.
        filled = [drafts[d.isoformat()] for d in dates if drafts[d.isoformat()].get("meals")]
        result = check_days(user, today, filled, targets) if filled else {"days": [], "taste_flags": []}
        checks = {c["date"]: c for c in result["days"]}
        failing = [d for d in dates if not checks.get(d.isoformat(), {}).get("ok")]
        if not failing or attempt == MAX_ROUNDS:
            break
        for d, new in zip(failing, proposer.propose(ctx, failing, attempt, result), strict=True):
            drafts[d.isoformat()] = new
    accepted = [drafts[d.isoformat()] for d in dates if checks.get(d.isoformat(), {}).get("ok")]
    rejected = [_rejected(d.isoformat(), checks.get(d.isoformat())) for d in failing]
    if not accepted:
        raise MenuRejected(rejected)
    accepted_dates = {d["date"] for d in accepted}
    # Lo que se guarda es lo que el motor ha aprobado: los días buenos y sus comprobaciones.
    MealPlan.objects.filter(
        profile=user.profile, start_date__gte=dates[0], start_date__lte=dates[-1]
    ).delete()
    plan = MealPlan.objects.create(
        profile=user.profile,
        start_date=date.fromisoformat(accepted[0]["date"]),
        days=_iso_days(accepted),
        checks=[checks[d] for d in sorted(accepted_dates)],
        rejected=rejected,
        targets={k: v for k, v in targets.items()},
        taste_flags=[f for f in result["taste_flags"] if f["date"] in accepted_dates],
        provider=proposer.name,
        engine_sha=engine_info()["sha_full"],
    )
    return plan, rejected


# ---------------------------------------------------------------- valorar


@transaction.atomic
def rate(user, dish: str, rating: str, source: str, today: date, note: str = "") -> Recipe:
    """`coach tastes rate`: una valoración nueva del mismo plato sustituye a la anterior. Un plato
    `loved` o `liked` entra en el recetario con sus pasos e ingredientes del menú guardado más
    reciente que lo tenga (`coach.recipes.save`)."""
    dish = " ".join(dish.split())
    if not dish or rating not in coach_tastes.RATINGS:
        raise MenuInvalid("rating_invalid")
    key = fold(dish)
    recipe = Recipe.objects.filter(profile=user.profile, dish_key=key).first() or Recipe(
        profile=user.profile, dish=dish, dish_key=key
    )
    recipe.rating, recipe.rated_on, recipe.note = rating, today, note
    if source:
        recipe.source_url = source
    entry = _find_in_menus(user, key)
    if entry:
        dish_entry, meal = entry
        recipe.dish = dish_entry["dish"]
        recipe.meal = meal
        for name in ("steps", "seasoning", "items"):
            if dish_entry.get(name):
                setattr(recipe, name, list(dish_entry[name]))
        if not source and dish_entry.get("source"):
            recipe.source_url = dish_entry["source"]
        if isinstance(dish_entry.get("servings"), int) and dish_entry["servings"] > 1:
            recipe.servings = dish_entry["servings"]
    recipe.full_clean()
    recipe.save()
    return recipe


def _find_in_menus(user, key: str):
    for plan in MealPlan.objects.filter(profile=user.profile).order_by("-start_date", "-created_at"):
        for day in plan.days:
            for meal in day["meals"]:
                for entry in meal.get("dishes") or []:
                    if fold(entry["dish"]) == key:
                        return entry, meal.get("meal", "")
    return None


def recipe_data(recipe: Recipe) -> dict:
    return {
        "dish": recipe.dish, "rating": recipe.rating, "source": recipe.source_url or None, "meal": recipe.meal,
        "servings": recipe.servings, "steps": recipe.steps, "seasoning": recipe.seasoning, "items": recipe.items,
        "rated_on": recipe.rated_on.isoformat(),
    }


def recipes_data(user) -> list[dict]:
    order = {r: i for i, r in enumerate(("loved", "liked", "disliked", "never_again"))}
    rows = sorted(Recipe.objects.filter(profile=user.profile), key=lambda r: (order[r.rating], fold(r.dish)))
    return [recipe_data(r) for r in rows]


# ---------------------------------------------------------------- lectura


def item_out(text: str, table: list[foods.Food], lang: str) -> dict:
    """Un ingrediente `NAME=CANTIDAD` con el nombre en el idioma de quien lee."""
    name, amount = foods.parse_item(text)
    food = foods.find(name, table)
    label = (food.name_en if lang == "en" else food.name_es) if food else name
    return {
        "name": label,
        "amount": round(float(amount), OUTPUT_DECIMALS),
        "unit": getattr(amount, "unit", "g"),
        "known": food is not None,
        "product": bool(food and food.barcode),
        "url": food.source_id if food and food.barcode else None,
    }


def _rules_out(targets: dict, lang: str) -> dict:
    return {name: rule_refs(keys, lang) for name, keys in (targets.get("rules") or {}).items()}


def plan_data(plan: MealPlan, user, lang: str) -> dict:
    """El menú guardado para la API: platos con los ingredientes en `lang`, la comprobación del
    motor de cada día, los días rechazados y la lista de la compra (`mealplan.shopping`)."""
    table = menu_table(user)
    _, days = mealplan.parse(_with_dates(plan.days))
    pantry = tastes_get(user).pantry or []
    shopping = mealplan.shopping(days, table, lang, pantry)
    checks = {c["date"]: c for c in plan.checks}
    out_days = []
    for day in plan.days:
        out_days.append({
            "date": day["date"],
            "meals": [
                {
                    "meal": meal.get("meal", ""),
                    "tupper": bool(meal.get("tupper")),
                    "free": bool(meal.get("free")),
                    "dishes": [
                        {
                            "dish": d["dish"],
                            "source": d.get("source") or None,
                            "servings": d.get("servings", 1),
                            "seasoning": d.get("seasoning") or [],
                            "steps": d.get("steps") or [],
                            "items": [item_out(i, table, lang) for i in d["items"]],
                        }
                        for d in meal.get("dishes") or []
                    ],
                }
                for meal in day["meals"]
            ],
            "check": checks.get(day["date"]),
        })
    targets = plan.targets
    return {
        "id": plan.id,
        "start_date": plan.start_date.isoformat(),
        "provider": plan.provider,
        "days": out_days,
        "rejected": plan.rejected,
        "taste_flags": plan.taste_flags,
        "targets": {k: v for k, v in targets.items() if k != "rules"},
        "rules": _rules_out(targets, lang),
        "shopping": {
            "chains": [{"chain": chain, "items": items} for chain, items in shopping["chains"].items()],
            "unknown": shopping["unknown"],
            "batches": [{**b, "dates": [d.isoformat() for d in b["dates"]]} for b in shopping["batches"]],
            "pantry_skipped": shopping["pantry_skipped"],
        },
        "conventions": {
            "kcal_margin": MENU_KCAL_MARGIN,
            "no_repeat_days": mealplan.NO_REPEAT_DAYS,
        },
        "engine_sha": plan.engine_sha[:7],
        "created_at": plan.created_at.isoformat(),
    }


def blocked_data(exc: MenuBlocked, lang: str) -> dict:
    return {"code": "no_calorie_targets", "reasons": reasons_data([Reason(**r) for r in exc.reasons], lang)}


def state(user, today: date, lang: str) -> dict:
    """`GET /coach/menu`: el último menú guardado, los gustos y si hay algo que lo impida."""
    blocked = missing = None
    try:
        menu_targets(user, today)
    except MenuBlocked as exc:
        blocked = blocked_data(exc, lang)
    except ProfileIncomplete as exc:
        missing = exc.field
    latest = MealPlan.objects.filter(profile=user.profile).first()
    return {
        "today": today.isoformat(),
        "blocked": blocked,
        "missing": missing,
        "menu": plan_data(latest, user, lang) if latest else None,
        "tastes": tastes_data(user),
        "max_days": MAX_DAYS,
        "meals": list(MEALS),
    }

