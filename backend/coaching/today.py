"""Pantalla "Hoy" (F11): el parte rápido de ParteDiario sobre los modelos de FightLab.

No hay modelos nuevos: el tipo de día, el entreno hecho y la movilidad van en `DayLog` y las
marcas de las comidas en `MealCheck` (los dos de la F10, donde entra también el historial de
ParteDiario), el peso por `checkin_upsert` del check-in de F5 (que aplica `no_weight_targets`) y
cada sesión de cardio es una `Activity` de deporte, la misma que guarda la pantalla de Deportes.
La API habla con las claves del menú y de la app (`breakfast`, `done`, `gym`); aquí se traducen a
las de esos modelos, que son las de ParteDiario (`desayuno`, `hecho`, `gimnasio`). El plan del día sale del `WeeklyPlan` activo (F6) y las comidas,
del último menú (F8) que tenga ese día.

El total de cardio de la semana va hacia los 150 min de "Weekly baseline dose", donde un minuto
vigoroso cuenta como dos moderados ("1 vigorous minute counts as about 2 moderate minutes").
"""
from datetime import date, datetime, time, timedelta

from coach.text import fold
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from activities.constants import MAX_ACTIVITIES_PER_DAY
from activities.models import Activity

from . import batch, checkin, rules
from .bridge.adapters import _tz
from .models import DayLog, KnowledgeRule, MealCheck, MealPlan, WeeklyPlan
from .plan import CARDIO_MODERATE_MIN, DAYS
from .session_check import EFFORT_SCALE, VIGOROUS_RPE
from .targets import _key

# Tipos de cardio que se apuntan desde Hoy (los de ParteDiario, con las claves de Deportes donde
# las hay) y si cuentan como vigorosos por defecto. convention (FightLab): trote, comba y HIIT son
# vigorosos y lo demás moderado, como en ParteDiario; la persona lo puede cambiar al apuntarlo.
CARDIO_TYPES = {
    "walk": False,
    "run": True,
    "bike": False,
    "swim": False,
    "elliptical": False,
    "rope": True,
    "hiit": True,
    "other": False,
}
# Las intensidades con el vocabulario que ya guarda Deportes en `detail.intensity`.
INTENSITY_VALUE = {"moderate": "Moderado", "vigorous": "Intenso"}
VIGOROUS_FORMATS = ("hiit", "sprints")
CARDIO_MINUTES = (1, 600)  # los de ParteDiario (`Limits.CARDIO_MIN`)
CHANGE_MAX = MealCheck._meta.get_field("change").max_length
DISH_MAX = MealCheck._meta.get_field("dish").max_length
# Claves de la API (las del menú de F8 y las de la app) y su valor en los modelos de la F10.
DAY_TYPES = {"gym": DayLog.DayType.GYM, "cardio": DayLog.DayType.CARDIO, "rest": DayLog.DayType.REST}
DAY_TYPE_KEYS = {v: k for k, v in DAY_TYPES.items()}
MEALS = {
    "breakfast": MealCheck.Meal.BREAKFAST,
    "lunch": MealCheck.Meal.LUNCH,
    "snack": MealCheck.Meal.SNACK,
    "dinner": MealCheck.Meal.DINNER,
}
STATES = {"done": MealCheck.State.DONE, "skipped": MealCheck.State.NOT_DONE, "changed": MealCheck.State.CHANGED}
STATE_KEYS = {v: k for k, v in STATES.items()}
# Detail de las sesiones creadas aquí: solo esas se pueden borrar desde Hoy (las de Deportes
# tienen además una copia local en el móvil que las gestiona su pantalla).
ORIGIN = "today"
# Cuántos días atrás deja Hoy apuntar (ParteDiario dejaba editar cualquier día; aquí basta la
# semana y un poco más, para la revisión de los martes).
MAX_PAST_DAYS = 14


class TodayError(Exception):
    def __init__(self, code: str, http: int = 400, **params):
        super().__init__(code)
        self.code = code
        self.http = http
        self.params = params


def local_day(profile, moment: datetime) -> date:
    return timezone.localtime(moment, _tz(profile)).date()


def check_day(day: date, today: date) -> None:
    if day > today:
        raise ValidationError({"date": "cannot be in the future"})
    if day < today - timedelta(days=MAX_PAST_DAYS):
        raise ValidationError({"date": f"at most {MAX_PAST_DAYS} days back"})


def _grade(key: str) -> str | None:
    return KnowledgeRule.objects.filter(key=key).values_list("grade", flat=True).first() or None


# ---------------------------------------------------------------- plan del día


def _active_plan(user) -> WeeklyPlan | None:
    return WeeklyPlan.objects.filter(profile=user.profile, status=WeeklyPlan.Status.ACTIVE).first()


def planned_type(entries: list[dict]) -> str:
    """Lo que el plan pone ese día: gimnasio si hay sesión de gimnasio, cardio si hay cardio o
    MMA (cuenta como cardio en el plan) y descanso si no hay nada."""
    kinds = {e.get("kind") for e in entries}
    if "gym" in kinds:
        return "gym"
    if kinds & {"cardio", "mma"}:
        return "cardio"
    return "rest"


def plan_for(user, day: date) -> dict | None:
    plan = _active_plan(user)
    if plan is None:
        return None
    weekday = DAYS[day.weekday()]
    sessions = {s.get("key"): s for s in plan.sessions or []}
    entries = []
    for entry in plan.training_schedule or []:
        if entry.get("day") != weekday:
            continue
        out = {"kind": entry.get("kind"), "time": entry.get("time")}
        if entry.get("kind") == "gym":
            session = sessions.get(entry.get("session")) or {}
            out["session"] = entry.get("session")
            out["exercises"] = [i.get("exercise") for i in session.get("items") or []]
        elif entry.get("kind") == "cardio":
            out["minutes"] = entry.get("minutes")
        entries.append(out)
    return {"id": plan.id, "week_start": plan.week_start.isoformat(), "entries": entries, "type": planned_type(entries)}


# ---------------------------------------------------------------- menú


# Un menú generado dura como mucho 7 días; uno importado (fase 12), hasta 35.
MENU_MAX_DAYS = 35


def menu_day(user, day: date) -> tuple[MealPlan, dict] | tuple[None, None]:
    """El día `day` del menú más reciente que lo tenga."""
    iso = day.isoformat()
    for plan in MealPlan.objects.filter(
        profile=user.profile, start_date__lte=day, start_date__gt=day - timedelta(days=MENU_MAX_DAYS)
    ):
        for d in plan.days or []:
            if d.get("date") == iso:
                return plan, d
    return None, None


def planned_dish(meal: dict) -> str:
    """Lo que pone el menú en una comida, como se guarda en `MealCheck.dish`."""
    return ", ".join(d.get("dish", "") for d in meal.get("dishes") or [])[:DISH_MAX]


def mark_applies(mark: MealCheck, meal: dict, day: date, today: date) -> bool:
    """La marca vigente de una comida (F29). Una marca solo vale para el plato que se marcó: si
    después el menú de ese día cambia (otro menú preparado o importado), la marca no pasa al plato
    nuevo, que nunca estuvo en el día. La marca vieja no se borra ni se reescribe: queda como
    historial de adherencia con su `dish`. Siguen valiendo las marcas de días pasados (no se
    tocan) y las que no apuntan plato (historial antiguo de ParteDiario).

    Es la regla que debe usar cualquier lectura de las marcas (Hoy y, si algún día las lee, la
    revisión semanal; hoy la revisión no lee `MealCheck`)."""
    if day < today or not mark.dish:
        return True
    return fold(mark.dish) == fold(planned_dish(meal))


def _meal_out(meal: dict, mark: MealCheck | None, day: date, today: date) -> dict:
    previous = None
    if mark is not None and not mark_applies(mark, meal, day, today):
        previous = {"state": STATE_KEYS[mark.state], "change": mark.change or None, "dish": mark.dish}
        mark = None
    return {
        "meal": meal.get("meal", ""),
        "free": bool(meal.get("free")),
        "tupper": bool(meal.get("tupper")),
        "dishes": [d.get("dish", "") for d in meal.get("dishes") or []],
        "label": meal.get("label") or None,
        "prep": meal.get("prep") or [],
        "eve": eve_list(meal.get("eve")),
        "mark": {"state": STATE_KEYS[mark.state], "change": mark.change or None} if mark else None,
        "previous_mark": previous,
    }


def eve_list(value) -> list[str]:
    """`eve` de una comida: una lista de tareas (fase 12) o, en menús de antes, un texto."""
    if isinstance(value, str):
        value = [value]
    return [str(v).strip() for v in value or [] if str(v).strip()]


def tonight(user, day: date) -> dict:
    """Lo que hay que dejar hecho esta noche para mañana (`day + 1`): las tareas `eve` del menú,
    las de la sesión de batch de mañana y pasar a la nevera lo congelado que se come mañana."""
    tomorrow = day + timedelta(days=1)
    plan, _ = menu_day(user, tomorrow)
    if plan is None:  # la sesión de batch suele ir la víspera del primer día del menú
        iso = tomorrow.isoformat()
        plan = next(
            (p for p in MealPlan.objects.filter(
                profile=user.profile, start_date__gt=tomorrow, start_date__lte=tomorrow + timedelta(days=7))
             if any(s.get("date") == iso for s in p.batch_sessions or [])),
            None,
        )
    return {"date": tomorrow.isoformat(), "tasks": batch.eve_tasks(plan, tomorrow), "rule_key": batch.RULES["defrost"]}


def meals_for(user, day: date, today: date | None = None) -> dict | None:
    plan, menu = menu_day(user, day)
    if plan is None:
        return None
    marks = {m.meal: m for m in MealCheck.objects.filter(profile=user.profile, date=day)}
    today = today or day
    meals = [_meal_out(m, marks.get(MEALS.get(m.get("meal", ""))), day, today) for m in menu.get("meals") or []]
    return {"id": plan.id, "start_date": plan.start_date.isoformat(), "meals": meals}


def next_meal(menu: dict | None) -> dict | None:
    """Como el widget de ParteDiario: la primera comida del día que aún no tiene marca. Va por
    marcas y no por la hora, así que basta con marcar el desayuno para que pase a la comida."""
    if not menu or not menu["meals"]:
        return None
    pending = next((m for m in menu["meals"] if m["mark"] is None), None)
    if pending is None:
        return {"all_done": True}
    return {"all_done": False, **{k: pending[k] for k in ("meal", "free", "dishes")}}


# ---------------------------------------------------------------- cardio


def is_vigorous(activity: Activity) -> bool:
    """Si una sesión de deporte cuenta como vigorosa. Con RPE manda el RPE ("vigorous begins at
    a level of 7 or 8", 0-10 effort scale); sin él, lo que se eligió al apuntarla: intensidad
    alta, o formato por intervalos o sprints en Deportes; y si no hay nada, lo de su tipo."""
    if activity.rpe is not None:
        return activity.rpe >= VIGOROUS_RPE
    detail = activity.detail if isinstance(activity.detail, dict) else {}
    if "intensity" in detail or "format" in detail:
        return detail.get("intensity") == INTENSITY_VALUE["vigorous"] or detail.get("format") in VIGOROUS_FORMATS
    # Sin intensidad (el historial importado de ParteDiario): lo de su tipo, como en ParteDiario.
    return CARDIO_TYPES.get(detail.get("sport_key"), False)


def _minutes(activity: Activity) -> int:
    return round(activity.duration_sec / 60)


def _bounds(profile, first: date, last: date) -> tuple[datetime, datetime]:
    tz = _tz(profile)
    return datetime.combine(first, time.min, tzinfo=tz), datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz)


def session_out(activity: Activity) -> dict:
    detail = activity.detail if isinstance(activity.detail, dict) else {}
    minutes = _minutes(activity)
    vigorous = is_vigorous(activity)
    return {
        "id": activity.id,
        "type": detail.get("sport_key") or "other",
        "title": activity.title,
        "minutes": minutes,
        "vigorous": vigorous,
        "equivalent": minutes * 2 if vigorous else minutes,
        "deletable": detail.get("origin") == ORIGIN,
    }


def week_start_for(day: date) -> date:
    return day - timedelta(days=day.weekday())


def cardio_for(user, day: date) -> dict:
    """Las sesiones de deporte del día y el total de la semana (lunes a domingo) hacia los 150.

    convention (FightLab, como el plan de F6): los minutos de MMA cuentan como cardio moderado.
    """
    profile = user.profile
    start = week_start_for(day)
    lo, hi = _bounds(profile, start, start + timedelta(days=6))
    week = list(
        Activity.objects.filter(
            profile=profile, kind__in=(Activity.Kind.SPORT, Activity.Kind.MMA), started_at__gte=lo, started_at__lt=hi
        ).order_by("started_at", "id")
    )
    sports = [a for a in week if a.kind == Activity.Kind.SPORT]
    mma_minutes = sum(_minutes(a) for a in week if a.kind == Activity.Kind.MMA)
    out = [session_out(a) for a in sports]
    today_sessions = [s for a, s in zip(sports, out) if local_day(profile, a.started_at) == day]
    key = _key(rules.WEEKLY_BASELINE)
    effort_key = _key(EFFORT_SCALE)
    return {
        "sessions": today_sessions,
        "week": {
            "start": start.isoformat(),
            "minutes": sum(s["minutes"] for s in out) + mma_minutes,
            "equivalent": sum(s["equivalent"] for s in out) + mma_minutes,
            "goal": CARDIO_MODERATE_MIN,
            "mma_minutes": mma_minutes,
            "mma_convention": "fightlab" if mma_minutes else None,
            "rule_key": key,
            "grade": _grade(key),
            "vigorous_rule_key": effort_key,
            "vigorous_grade": _grade(effort_key),
        },
        "types": [{"key": k, "vigorous": v} for k, v in CARDIO_TYPES.items()],
    }


@transaction.atomic
def add_cardio(user, day: date, today: date, kind: str, minutes, intensity: str | None) -> Activity:
    check_day(day, today)
    errors = {}
    if kind not in CARDIO_TYPES:
        errors["type"] = f"must be one of: {', '.join(CARDIO_TYPES)}"
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not CARDIO_MINUTES[0] <= minutes <= CARDIO_MINUTES[1]:
        errors["minutes"] = f"must be a whole number between {CARDIO_MINUTES[0]} and {CARDIO_MINUTES[1]}"
    if intensity is not None and intensity not in INTENSITY_VALUE:
        errors["intensity"] = "must be moderate or vigorous"
    if errors:
        raise ValidationError(errors)
    profile = user.profile
    lo, hi = _bounds(profile, day, day)
    if Activity.objects.filter(profile=profile, started_at__gte=lo, started_at__lt=hi).count() >= MAX_ACTIVITIES_PER_DAY:
        raise TodayError("too_many_activities", 400, limit=MAX_ACTIVITIES_PER_DAY)
    vigorous = CARDIO_TYPES[kind] if intensity is None else intensity == "vigorous"
    seconds = minutes * 60
    now = timezone.now()
    if local_day(profile, now) == day:
        # Termina ahora; si empezaría ayer, se pega al principio del día para que cuente hoy.
        started = max(now - timedelta(seconds=seconds), lo)
    else:
        started = datetime.combine(day, time(12), tzinfo=_tz(profile))  # convention: mediodía
    return Activity.objects.create(
        profile=profile,
        kind=Activity.Kind.SPORT,
        title=kind,
        started_at=started,
        duration_sec=seconds,
        detail={
            "sport_key": kind,
            "intensity": INTENSITY_VALUE["vigorous" if vigorous else "moderate"],
            "origin": ORIGIN,
        },
    )


def delete_cardio(user, pk: int) -> None:
    activity = Activity.objects.filter(profile=user.profile, pk=pk, kind=Activity.Kind.SPORT).first()
    if activity is None:
        raise TodayError("not_found", 404)
    detail = activity.detail if isinstance(activity.detail, dict) else {}
    if detail.get("origin") != ORIGIN:
        raise TodayError("not_from_today", 409)
    activity.delete()


# ---------------------------------------------------------------- parte del día


DAY_FIELDS = ("day_type", "trained", "mobility")


@transaction.atomic
def save_day(user, day: date, today: date, values: dict) -> None:
    """Guarda lo que trae el parte rápido. `day_type: null` vuelve a lo que diga el plan; el peso
    pasa por `checkin_upsert` (lanza `CheckinRefused` con `no_weight_targets`)."""
    check_day(day, today)
    unknown = sorted(set(values) - {*DAY_FIELDS, "weight_kg"})
    errors = {name: f"unknown field: {name}" for name in unknown}
    if "day_type" in values and values["day_type"] not in (None, *DAY_TYPES):
        errors["day_type"] = f"must be one of: {', '.join(DAY_TYPES)} or null"
    for name in ("trained", "mobility"):
        if name in values and values[name] is not None and not isinstance(values[name], bool):
            errors[name] = "must be true, false or null"
    if errors:
        raise ValidationError(errors)
    if values.get("weight_kg") is not None:
        checkin.checkin_upsert(user, day, {"weight_kg": values["weight_kg"]}, today)
    fields = [name for name in DAY_FIELDS if name in values]
    if fields:
        row, _ = DayLog.objects.select_for_update().get_or_create(profile=user.profile, date=day)
        for name in fields:
            value = values[name]
            if name == "day_type":
                value = DAY_TYPES[value] if value else ""  # vacío: lo que diga el plan
            setattr(row, name, value)
        row.save()


def save_meal(user, day: date, today: date, meal: str, state: str | None, change: str = "") -> None:
    """Marca una comida del menú de `day`; `state: null` quita la marca."""
    check_day(day, today)
    _, menu = menu_day(user, day)
    planned = {m.get("meal"): m for m in (menu or {}).get("meals") or []}
    meals = set(planned)
    errors = {}
    if meal not in meals or meal not in MEALS:
        errors["meal"] = "no such meal in the menu for that day"
    if state is not None and state not in STATES:
        errors["state"] = f"must be one of: {', '.join(STATES)} or null"
    change = (change or "").strip()
    if len(change) > CHANGE_MAX:
        errors["change"] = f"at most {CHANGE_MAX} characters"
    if errors:
        raise ValidationError(errors)
    key = MEALS[meal]
    if state is None:
        MealCheck.objects.filter(profile=user.profile, date=day, meal=key).delete()
        return
    # `dish`: lo que ponía el menú, como en el historial importado de ParteDiario.
    dish = planned_dish(planned[meal])
    MealCheck.objects.update_or_create(
        profile=user.profile, date=day, meal=key, defaults={"state": STATES[state], "change": change, "dish": dish}
    )


def today_data(user, day: date, today: date) -> dict:
    row = user.profile.day_logs.filter(date=day).first()
    data = checkin.checkin_data(user, day, today)
    plan = plan_for(user, day)
    menu = meals_for(user, day, today)
    set_type = DAY_TYPE_KEYS.get(row.day_type) if row else None
    return {
        "date": day.isoformat(),
        "today": today.isoformat(),
        "weekday": DAYS[day.weekday()],
        "plan": plan,
        "day_type": set_type or (plan["type"] if plan else None),
        "day_type_set": bool(set_type),
        "trained": row.trained if row else None,
        "mobility": row.mobility if row else None,
        "weight_kg": data["weight_kg"] if data else None,
        "weight_blocked": checkin.weight_tracking_blocked(user, today),
        "menu": menu,
        "next_meal": next_meal(menu),
        "cardio": cardio_for(user, day),
        "tonight": tonight(user, day),
    }
