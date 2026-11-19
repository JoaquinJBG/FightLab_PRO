"""Batch cooking (fase 12): cronograma de la sesión, nevera o congelador y tareas de la víspera.

Las reglas son las del anexo de FightLab (`knowledge_fightlab/batch-cooking.md`), cada una con su
clave para el chip de evidencia (`RULES`):

- **Cronograma** (`schedule`): de lo más largo a lo más corto y en paralelo por aparato, solo con
  los aparatos que el usuario tiene (`kitchen.capacity`). Un paso de un aparato que no tiene pasa
  a otro parecido (`SUBSTITUTES`, convención de FightLab) o queda en `missing`.
- **Nevera o congelador** (`storage_for`): lo que se come en los 2 días siguientes a la sesión,
  de la nevera; lo demás se congela el mismo día. El arroz, solo el día siguiente. Con la sesión
  el domingo: lunes y martes, nevera; de miércoles a viernes, congelador.
- **Víspera** (`eve_tasks`): lo que trae el menú en `eve`, las tareas `eve` de la sesión de batch
  del día siguiente y pasar a la nevera lo congelado que se come mañana.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from coach.tastes import matches

from . import kitchen
from .keys import rule_key

FILE = "batch-cooking.md"
HEADINGS = {
    "order": "Order the batch session from longest to shortest, in parallel by appliance",
    "cool": "Cool cooked food and refrigerate it within 2 hours, rice within 1 hour",
    "fridge": "Eat from the fridge within 2 days and freeze the rest the same day",
    "no_freeze": "Do not freeze potatoes, mayonnaise, fried food or yogurt sauces",
    "defrost": "Defrost in the fridge the night before",
    "reheat": "Reheat until steaming hot throughout and reheat rice only once",
    "air_fryer": "Check air-fried meat with a thermometer",
    "label": "Label each container with the dish and the date, first in first out",
}
RULES = {name: rule_key(FILE, heading) for name, heading in HEADINGS.items()}

# convention (FightLab), en "Eat from the fridge within 2 days...": días después de la sesión que
# un plato va a la nevera; el arroz, 1 (FSA: como mucho un día en la nevera).
FRIDGE_DAYS = 2
RICE_FRIDGE_DAYS = 1
RICE_WORDS = ("arroz", "rice")
# Lo que no se congela bien (AESAN, Nigella; ver "Do not freeze...").
NO_FREEZE_WORDS = (
    "patata", "potato", "mayonesa", "mayonnaise", "frito", "fried", "rebozado", "empanado",
    "yogur", "yogurt", "yoghurt", "nata ligera", "single cream", "huevo duro", "hard-boiled egg",
)
# convention (FightLab): si falta un aparato, el paso va a otro con su tiempo multiplicado. No es
# un dato de cocina contrastado: es para que el cronograma salga con lo que hay, y la pantalla lo
# marca como sustituido.
SUBSTITUTES = {
    "pressure_cooker": (("pot", 3.0),),
    "pot": (("pressure_cooker", 1.0),),
    "air_fryer": (("oven", 1.25),),
    "oven": (("air_fryer", 1.0),),
    "wok": (("frying_pan", 1.0),),
    "frying_pan": (("wok", 1.0),),
    "microwave": (("pot", 1.0), ("frying_pan", 1.0)),
}
MAX_STEP_MIN = 600
MAX_STEPS = 80


@dataclass
class Task:
    dish: str
    step: str
    minutes: int
    where: str


@dataclass
class Scheduled:
    timeline: list[dict] = field(default_factory=list)
    missing: list[dict] = field(default_factory=list)
    total_min: int = 0
    checked: bool = False


def _resolve(where: str, has: set[str] | None) -> tuple[str, float] | None:
    if has is None or where in has:
        return where, 1.0
    for other, factor in SUBSTITUTES.get(where, ()):
        if other in has:
            return other, factor
    return None


def schedule(chains: list[list[Task]], equipment: dict) -> Scheduled:
    """Coloca los pasos de cada plato (en orden dentro del plato) en el tiempo.

    Va como una cocina de verdad: en cada momento se empieza, entre los pasos listos, el del plato
    al que más le queda (de lo más largo a lo más corto) en el primer aparato libre de su tipo; los
    de fuego comparten además los fuegos. Con el menaje sin rellenar, cada aparato cuenta como uno
    y no se comprueba nada (`checked` falso)."""
    out = Scheduled(checked=bool(equipment))
    has = kitchen.owned(equipment) if equipment else None
    cap = kitchen.capacity(equipment) if equipment else {**{a: 1 for a in kitchen.APPLIANCES}, "burners": 99}
    queue: list[list[dict]] = []
    for chain in chains:
        steps = []
        for task in chain:
            resolved = _resolve(task.where, has)
            if resolved is None:
                out.missing.append({"dish": task.dish, "step": task.step, "where": task.where})
                continue
            where, factor = resolved
            entry = {"dish": task.dish, "step": task.step, "where": where, "minutes": max(1, round(task.minutes * factor))}
            if where != task.where:
                entry["substituted_from"] = task.where
            steps.append(entry)
        if steps:
            queue.append(steps)
    ready_at = [0] * len(queue)
    remaining = [sum(s["minutes"] for s in chain) for chain in queue]
    running: list[dict] = []  # {until, where}
    t = 0
    while any(queue):
        running = [r for r in running if r["until"] > t]
        busy: dict[str, int] = {}
        for r in running:
            busy[r["where"]] = busy.get(r["where"], 0) + 1
        burners = sum(1 for r in running if r["where"] in kitchen.HOB)
        order = sorted((i for i, chain in enumerate(queue) if chain and ready_at[i] <= t), key=lambda i: (-remaining[i], i))
        started = False
        for i in order:
            step = queue[i][0]
            where = step["where"]
            if busy.get(where, 0) >= cap.get(where, 0):
                continue
            if where in kitchen.HOB and burners >= cap["burners"]:
                continue
            until = t + step["minutes"]
            out.timeline.append({
                "min": t, "until": until, "where": where, "step": step["step"], "dish": step["dish"],
                **({"substituted_from": step["substituted_from"]} if "substituted_from" in step else {}),
            })
            running.append({"until": until, "where": where})
            busy[where] = busy.get(where, 0) + 1
            if where in kitchen.HOB:
                burners += 1
            remaining[i] -= step["minutes"]
            ready_at[i] = until
            queue[i].pop(0)
            started = True
        if started:
            continue
        upcoming = [r["until"] for r in running if r["until"] > t] + [ready_at[i] for i, c in enumerate(queue) if c and ready_at[i] > t]
        if not upcoming:  # nada puede empezar nunca (un aparato con capacidad 0)
            for chain in queue:
                out.missing += [{"dish": s["dish"], "step": s["step"], "where": s["where"]} for s in chain]
            break
        t = min(upcoming)
    out.timeline.sort(key=lambda e: (e["min"], kitchen.APPLIANCES.index(e["where"]) if e["where"] in kitchen.APPLIANCES else 99))
    out.total_min = max((e["until"] for e in out.timeline), default=0)
    return out


def chains_from_dishes(dish_ids: list[str], dishes: dict) -> list[list[Task]]:
    """Los pasos de batch (`steps_batch` con `min` y `where`) de los platos de una sesión."""
    chains = []
    for dish_id in dish_ids:
        dish = dishes.get(dish_id) or {}
        chain = []
        for step in dish.get("steps_batch") or []:
            if isinstance(step, dict) and step.get("min") and step.get("where"):
                where = kitchen.appliance(step["where"]) or "hands"
                chain.append(Task(dish.get("name", dish_id), str(step.get("step", "")), int(step["min"]), where))
        if chain:
            chains.append(chain)
    return chains


def chains_from_timeline(timeline: list[dict], dishes: dict) -> list[list[Task]]:
    """Un cronograma importado vuelto a pasos: los de un mismo plato, en su orden; sin plato, cada
    paso por su cuenta."""
    by_dish: dict[str, list[Task]] = {}
    loose = []
    for entry in sorted(timeline, key=lambda e: e["min"]):
        name = (dishes.get(entry.get("dish") or "") or {}).get("name") or entry.get("dish") or ""
        task = Task(name, entry["step"], max(1, entry["until"] - entry["min"]), entry["where"])
        if name:
            by_dish.setdefault(name, []).append(task)
        else:
            loose.append([task])
    return list(by_dish.values()) + loose


def session_view(session: dict, dishes: dict, equipment: dict) -> dict:
    """Una sesión de batch para la pantalla: su cronograma comprobado contra el menaje.

    Si el menú trae cronograma y todos sus aparatos están en el menaje, se queda como viene. Si
    usa alguno que no está, se rehace con `schedule` (y lo dice `rebuilt`). Sin cronograma, sale
    de los `steps_batch` de sus platos."""
    has = kitchen.owned(equipment) if equipment else None
    timeline = session.get("timeline") or []
    rebuilt = False
    missing: list[dict] = []
    if timeline and (has is None or all(e["where"] in has for e in timeline)):
        lines = timeline
    else:
        chains = chains_from_timeline(timeline, dishes) if timeline else chains_from_dishes(session.get("dishes") or [], dishes)
        result = schedule(chains, equipment)
        lines, missing, rebuilt = result.timeline, result.missing, bool(timeline)
    return {
        "date": session.get("date"),
        "dishes": [
            {"id": d, "name": (dishes.get(d) or {}).get("name", d), "batch_servings": (dishes.get(d) or {}).get("batch_servings")}
            for d in session.get("dishes") or []
        ],
        "eve": list(session.get("eve") or []),
        "timeline": lines,
        "total_min": max((e["until"] for e in lines), default=0),
        "appliances": sorted({e["where"] for e in lines}, key=lambda w: kitchen.APPLIANCES.index(w) if w in kitchen.APPLIANCES else 99),
        "missing": missing,
        "rebuilt": rebuilt,
        "checked": bool(equipment),
        "rules": [RULES["order"], RULES["cool"], RULES["label"]],
    }


# ---------------------------------------------------------------- nevera, congelador y víspera


def _texts(dish: dict) -> list[str]:
    texts = [dish.get("name") or dish.get("dish") or ""]
    for item in dish.get("ingredients") or []:
        if isinstance(item, dict) and item.get("food"):
            texts.append(item["food"])
    for item in dish.get("items") or []:
        texts.append(str(item).rpartition("=")[0])
    return [t for t in texts if t]


def _has_word(texts: list[str], words) -> list[str]:
    return [w for w in words if any(matches(w, t) for t in texts)]


def storage_for(dish: dict, session_day: date, eat_day: date) -> dict:
    """Dónde espera un plato de la sesión de `session_day` hasta que se come el `eat_day`."""
    texts = _texts(dish)
    rice = bool(_has_word(texts, RICE_WORDS))
    limit = RICE_FRIDGE_DAYS if rice else FRIDGE_DAYS
    days = (eat_day - session_day).days
    where = "fridge" if days <= limit else "freezer"
    out = {"where": where, "days": days, "rice": rice, "rules": [RULES["fridge"], RULES["reheat"]]}
    if where == "freezer":
        out["rules"] = [RULES["fridge"], RULES["defrost"], RULES["reheat"]]
        bad = _has_word(texts, NO_FREEZE_WORDS)
        if bad:
            out["no_freeze"] = bad
            out["rules"].append(RULES["no_freeze"])
    return out


def session_for(day: date, sessions: list[dict], dish_id: str) -> dict | None:
    """La sesión de batch más reciente, hasta `day`, que cocina `dish_id`."""
    best = None
    for session in sessions:
        try:
            when = date.fromisoformat(session.get("date") or "")
        except ValueError:
            continue
        if when <= day and dish_id in (session.get("dishes") or []) and (best is None or when > best[0]):
            best = (when, session)
    return best[1] if best else None


def meal_storage(plan, day: date, meal: dict) -> dict | None:
    """Nevera o congelador para una comida de un menú con sesiones de batch, o `None`."""
    dish_id = meal.get("dish_id")
    if not dish_id or meal.get("free"):
        return None
    session = session_for(day, plan.batch_sessions or [], dish_id)
    if session is None:
        return None
    dish = (plan.dishes or {}).get(dish_id) or {}
    out = storage_for(dish, date.fromisoformat(session["date"]), day)
    out["session_date"] = session["date"]
    return out


def eve_tasks(plan, day: date) -> list[dict]:
    """Lo que hay que dejar hecho la noche antes de `day` según el menú `plan`."""
    if plan is None:
        return []
    tasks: list[dict] = []
    iso = day.isoformat()
    for session in plan.batch_sessions or []:
        if session.get("date") == iso:
            tasks += [{"kind": "batch", "text": str(t)} for t in session.get("eve") or [] if str(t).strip()]
    entry = next((d for d in plan.days or [] if d.get("date") == iso), None)
    for meal in (entry or {}).get("meals") or []:
        eve = meal.get("eve") or []
        for text in [eve] if isinstance(eve, str) else eve:  # un texto en los menús de antes de la F12
            if str(text).strip():
                tasks.append({"kind": "meal", "meal": meal.get("meal"), "text": str(text)})
        storage = meal_storage(plan, day, meal)
        if storage and storage["where"] == "freezer":
            name = ((plan.dishes or {}).get(meal.get("dish_id")) or {}).get("name") or ", ".join(
                d.get("dish", "") for d in meal.get("dishes") or []
            )
            tasks.append({"kind": "defrost", "meal": meal.get("meal"), "dish": name, "rule_key": RULES["defrost"]})
    return tasks


def next_session(plan, today: date) -> dict | None:
    for session in sorted(plan.batch_sessions or [], key=lambda s: s.get("date") or ""):
        if (session.get("date") or "") >= today.isoformat():
            return session
    return None


def days_between(first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]
