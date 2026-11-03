"""Quién propone los platos del menú (Task 8.4): un proveedor de LLM, siempre simulado.

En el coach, el LLM (la skill `/menu`) busca recetas, elige platos y ajusta los gramos
preguntando al motor (`coach menu --targets`) hasta que cada día pasa. Aquí ese papel lo hace un
proveedor con la misma forma: `propose(ctx, dates, attempt, feedback)` devuelve un día de
borrador por fecha, en el formato de `coach.mealplan`. El servidor comprueba cada día con el motor
y le devuelve los que no pasan (`attempt` 1, 2…, con la comprobación en `feedback`).

**Decisión del usuario para la fase 8:** los menús se prueban solo con un LLM simulado. Solo
existe `FakeMenuProposer`, determinista (mismas entradas, mismo menú), para local, tests y E2E.
No hay proveedor real: nunca se llama a la API de Anthropic, aunque haya `ANTHROPIC_API_KEY`.
"""
from __future__ import annotations

from datetime import date

from coach import foods, mealplan
from coach.tastes import matches
from coach.text import fold
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from .menu_dishes import DISHES

# convention (FightLab): el simulado apunta al 102,5 % del objetivo de kcal, en mitad del margen
# que acepta el motor (del objetivo al 105 %, `cli.MENU_KCAL_MARGIN`).
KCAL_AIM = 1.025
# Listas de gustos que el simulado evita al elegir (el motor las vuelve a mirar después).
AVOIDED = ("allergies", "intolerances", "disliked_foods", "untried")


def _names(item: str, ctx) -> tuple[str, ...]:
    name, _ = foods.parse_item(item)
    food = ctx.find(name)
    return (name, food.name_en, food.name_es) if food else (name,)


def _clashes(dish: dict, ctx) -> bool:
    """¿Choca el plato con algo que el atleta evita? Por nombre, como `mealplan.taste_flags`."""
    texts = [(dish["dish"],), *((s,) for s in dish["seasoning"]), *(_names(i, ctx) for i in dish["items"])]
    for attribute in AVOIDED:
        for entry in getattr(ctx.tastes, attribute) or []:
            if any(matches(entry, *names) for names in texts):
                return True
    return False


def _template(entry: dict, lang: str) -> dict:
    lang = lang if lang in ("es", "en") else "es"
    return {
        "dish": entry[lang],
        "source": "",
        "seasoning": list(entry["seasoning"][lang]),
        "items": [f"{name}={grams}" for name, grams in entry["items"]],
        "tupper_ok": entry["tupper"],
    }


def _scaled(items: list[str], factor: float) -> list[str]:
    out = []
    for item in items:
        name, amount = foods.parse_item(item)
        unit = getattr(amount, "unit", "g")
        grams = max(1, round(float(amount) * factor))
        out.append(f"{name}={grams}{'ml' if unit == 'ml' else ''}")
    return out


class FakeMenuProposer:
    """Proveedor simulado y determinista. Elige platos del recetario del atleta (valorados `loved`
    o `liked`) y de `menu_dishes.DISHES`, sin platos vetados ni repetidos en la ventana de
    `mealplan.NO_REPEAT_DAYS`, sin lo que choca con sus gustos, y escala las raciones del día con
    los totales del motor hasta el objetivo de kcal. Cada intento (`attempt`) cambia la elección."""

    name = "fake"

    def propose(self, ctx, dates: list[date], attempt: int, feedback: dict | None) -> list[dict]:
        return [self._day(ctx, when, attempt) for when in dates]

    def _candidates(self, ctx, meal: str) -> list[dict]:
        own = [
            {"dish": r["dish"], "source": r["source"], "seasoning": list(r["seasoning"]), "items": list(r["items"]),
             "steps": list(r["steps"]), "tupper_ok": True, "own": True}
            for r in ctx.favoured if r["meal"] == meal
        ]
        # Solo platos cuyos ingredientes conoce la tabla del usuario (sin región, p. ej., no hay la
        # capa de España).
        return [
            d for d in own + [_template(d, ctx.lang) for d in DISHES if meal in d["meals"]]
            if all(ctx.find(foods.parse_item(i)[0]) for i in d["items"])
        ]

    def _taken(self, ctx, when: date) -> set[str]:
        """Platos ya elegidos en otros días a menos de `NO_REPEAT_DAYS`."""
        return {
            fold(dish)
            for iso, dishes in ctx.chosen.items()
            if iso != when.isoformat() and abs((date.fromisoformat(iso) - when).days) < mealplan.NO_REPEAT_DAYS
            for dish in dishes
        }

    def _day(self, ctx, when: date, attempt: int) -> dict:
        taken = self._taken(ctx, when) | ctx.avoid_dishes
        meals = []
        for offset, meal in enumerate(ctx.meals):
            tupper = meal in ctx.tupper_meals
            options = [
                d for d in self._candidates(ctx, meal)
                if fold(d["dish"]) not in taken and (d["tupper_ok"] or not tupper) and not _clashes(d, ctx)
            ]
            if not options:  # nada que proponer: el motor rechazará el día
                continue
            # El recetario del atleta va antes que los platos nuevos (paso 4 de `/menu`); en el
            # último intento se prueba con todo.
            own = [d for d in options if d.get("own")]
            pool = own if own and attempt < 2 else options
            pick = pool[(when.toordinal() * 3 + offset + attempt * 5) % len(pool)]
            taken.add(fold(pick["dish"]))
            dish = {k: v for k, v in pick.items() if k not in ("tupper_ok", "own") and (v or k == "items")}
            meals.append({"meal": meal, **({"tupper": True} if tupper else {}), "dishes": [dish]})
        if meals:
            self._fit(ctx, meals)
        ctx.chosen[when.isoformat()] = [d["dish"] for m in meals for d in m["dishes"]]
        return {"date": when.isoformat(), "meals": meals}

    def _fit(self, ctx, meals: list[dict]) -> None:
        """Escala las raciones del día con los totales del motor (`ctx.totals`) hacia el objetivo."""
        target = ctx.targets["kcal"] * KCAL_AIM
        for _ in range(3):
            items = [i for m in meals for d in m["dishes"] for i in d["items"]]
            totals = ctx.totals(items)
            if totals.unknown or "kcal" in totals.missing or totals.kcal <= 0:
                return
            factor = target / totals.kcal
            if abs(factor - 1) < 0.005:
                return
            for meal in meals:
                for dish in meal["dishes"]:
                    dish["items"] = _scaled(dish["items"], factor)


PROVIDERS = {"fake": FakeMenuProposer}


def get_proposer():
    """El proveedor de `settings.MENU_LLM_PROVIDER`. Solo existe el simulado."""
    name = getattr(settings, "MENU_LLM_PROVIDER", "fake")
    if name not in PROVIDERS:
        raise ImproperlyConfigured(f"MENU_LLM_PROVIDER={name!r}: solo existe el proveedor simulado ('fake')")
    return PROVIDERS[name]()
