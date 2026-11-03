"""Importar el historial de ParteDiario y del coach (fase 10).

Los archivos los lee `bridge.history_files`; aquí se validan, se comparan con lo que ya hay y se
guardan:

- Peso, cintura y FC en reposo → `BiometricsLog` del check-in (`external_id="checkin:FECHA"`);
  kcal, sueño, energía, notas y agujetas → `DailyCheckin` (F5). Mismos rangos que el check-in
  (`checkin.clean_values`) y los límites del modelo. Con `no_weight_targets`, peso, cintura y kcal
  no se guardan, igual que en el check-in, y el resumen lo dice.
- `quad` (cuádriceps izquierdo de ParteDiario): con molestias, la zona `legs` del check-in y una
  nota; "bien" no deja nada.
- Tipo de día, entrenamiento y movilidad hechos y la FC de los entrenamientos → `DayLog` (la FC
  media, la máxima y las zonas se guardan sin mostrarse: fase 15).
- Comidas hechas, no hechas o cambiadas → `MealCheck`.
- Cada sesión de cardio → una `Activity` de deporte con `source=IMPORT` y
  `external_id="partediario:cardio:FECHA:N"`. Sin RPE: no suma carga (no se inventa).
- Las revisiones del coach → `WeeklyReview` con `source=import`, aceptadas en la fecha de fin
  de su semana: su TDEE es el que usa `coach/targets`, como el `/plan` del coach con
  `data/reviews/`. Una revisión hecha en la app esa semana no se toca nunca.
- `sessions.csv` del coach y los CSV de Hevy o genéricos → `imports.import_sets` (F9).

Lo que ya hay en FightLab no se pisa sin confirmar: con `on_conflict="keep"` (por defecto) un
dato distinto del que ya está se queda como está y solo se rellena lo que falta; con
`"replace"` gana el archivo. Las notas y las zonas de agujetas se suman, nunca se sustituyen (una
molestia apuntada antes se queda, como en `coach.checkins`). Con `dry_run` no se escribe nada y
el resumen dice lo que se haría.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction

from activities.models import Activity
from profiles import constants as limits
from profiles.models import BiometricsLog

from . import checkin, imports
from .bridge.adapters import _tz
from .bridge.history_files import DayRecord, ParsedFile
from .bridge.importers import ImportFileError
from .models import DailyCheckin, DayLog, MealCheck, WeeklyReview

ON_CONFLICT = ("keep", "replace")
FLOOR = date(2000, 1, 1)  # antes de esto es un error de formato (ParteDiario es de 2026)
MAX_DAYS = 5_000  # unos 13 años de partes: más, en varias subidas
MAX_CONFLICTS_LISTED = 60
MAX_EXAMPLES = 3
# convention (FightLab): controles de entrada de lo importado, no recomendaciones.
CARDIO_MINUTES = (1, 1440)
HEART_RANGES = {"fc_media": (20, 250), "fc_max": (20, 250), "min_z1": (0, 1440), "min_z2": (0, 1440), "min_z3": (0, 1440)}
REVIEW_KCAL = (500, 10_000)
TEXT_MAX = {"change": 300, "dish": 300}
REVIEW_TEXT_MAX = 20_000
CARDIO_PREFIX = "partediario:cardio:"
CARDIO_HOUR = 12  # ParteDiario no guarda la hora: mediodía, marcado `time_known: false`
REVIEW_HOUR = 12
# `CardioType` de ParteDiario → deporte de FightLab. HIIT y "Otro" no tienen uno: van sin él.
CARDIO_SPORT = {"PASEO": "walk", "PASEO_TROTE": "walk", "TROTE": "run"}
CARDIO_HIIT = {"HIIT_SACO", "HIIT_MAQUINA"}
QUAD_NOTES = {"molestia_leve": "Cuádriceps izquierdo: molestia leve", "peor": "Cuádriceps izquierdo: peor"}
QUAD_ZONE = "legs"

LOG_FIELDS = ("weight_kg", "waist_cm", "resting_heart_rate")
ROW_FIELDS = ("intake_kcal", "sleep_hours", "energy")
MODEL_LIMITS = {
    "weight_kg": tuple(float(x) for x in limits.WEIGHT_KG),
    "waist_cm": tuple(float(x) for x in limits.GIRTH_CM),
    "resting_heart_rate": limits.RESTING_HEART_RATE,
}
DECIMALS = {"weight_kg": 2, "waist_cm": 1, "sleep_hours": 2}


class HistoryError(ValueError):
    def __init__(self, code: str, params: dict | None = None):
        super().__init__(code)
        self.code = code
        self.params = params or {}


@dataclass
class Report:
    discarded: dict = field(default_factory=dict)  # (código, campo) → fechas
    blocked: Counter = field(default_factory=Counter)
    notices: Counter = field(default_factory=Counter)

    def discard(self, code: str, column: str, when: str) -> None:
        self.discarded.setdefault((code, column), []).append(when)

    def merge(self, parsed: ParsedFile) -> None:
        for key, whens in parsed.discarded.items():
            self.discarded.setdefault(key, []).extend(whens)
        self.notices.update(parsed.notices)


@dataclass
class Clean:
    """Un día validado: lo que se quiere escribir, por destino."""

    date: date
    log: dict = field(default_factory=dict)
    row: dict = field(default_factory=dict)
    notes: str = ""
    zones: list[str] = field(default_factory=list)
    day: dict = field(default_factory=dict)
    heart: dict = field(default_factory=dict)
    meals: dict = field(default_factory=dict)
    cardio: list | None = None


# ---------------------------------------------------------------- validación


def _int(value, low, high) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if isinstance(value, bool) or number != int(number) or not low <= number <= high:
        return None
    return int(number)


def _checkin_value(name: str, value, day: date, today: date, report: Report):
    """Un campo con las reglas del check-in (`checkin.clean_values`) y los límites del modelo."""
    when = day.isoformat()
    try:
        clean = checkin.clean_values(day, today, {name: value})
    except ValidationError as exc:
        text = " ".join(exc.message_dict.get(name, []))
        report.discard("out_of_range" if "outside" in text else "not_a_number", name, when)
        return None
    if name not in clean:
        return None
    number = clean[name]
    if name in MODEL_LIMITS:
        low, high = MODEL_LIMITS[name]
        if not low <= number <= high:
            report.discard("out_of_range", name, when)
            return None
    return number


def _clean_day(record: DayRecord, today: date, blocked: bool, report: Report) -> Clean | None:
    when = record.date.isoformat()
    if record.date > today:
        report.discard("future_date", "date", when)
        return None
    if record.date < FLOOR:
        report.discard("too_old", "date", when)
        return None
    out = Clean(record.date)
    notes = []
    for name, value in record.checkin.items():
        if name == "quad":
            if value in QUAD_NOTES:
                out.zones = [QUAD_ZONE]
                notes.append(QUAD_NOTES[value])
                report.notices["quad_to_soreness"] += 1
            continue
        if name == "notes":
            notes.insert(0, str(value).strip())
            continue
        if blocked and name in checkin.BODY_FIELDS:
            report.blocked[name] += 1
            continue
        number = _checkin_value(name, value, record.date, today, report)
        if number is None:
            continue
        (out.log if name in LOG_FIELDS else out.row)[name] = number
    out.notes = "; ".join(n for n in notes if n)
    out.day = dict(record.day)
    for name, value in record.heart.items():
        number = _int(value, *HEART_RANGES[name])
        if number is None:
            report.discard("out_of_range", name, when)
        else:
            out.heart[name] = number
    for meal, (state, change, dish) in record.meals.items():
        out.meals[meal] = (state, change[: TEXT_MAX["change"]], dish[: TEXT_MAX["dish"]])
    if record.cardio is not None:
        out.cardio = []
        for session in record.cardio:
            minutes = _int(session.minutes, *CARDIO_MINUTES)
            if minutes is None:
                report.discard("cardio_minutes", "cardio", when)
            else:
                out.cardio.append((session.code, session.label, minutes))
        if not out.cardio:
            out.cardio = None
    return out


def _merge(records: list[DayRecord], report: Report) -> list[DayRecord]:
    """Varios archivos con el mismo día: los campos del que va después ganan (sin borrar los
    que no trae)."""
    days: dict[date, DayRecord] = {}
    for record in records:
        earlier = days.get(record.date)
        if earlier is None:
            days[record.date] = record
            continue
        report.notices["same_day_in_several_files"] += 1
        earlier.checkin.update(record.checkin)
        earlier.day.update(record.day)
        earlier.heart.update(record.heart)
        earlier.meals.update(record.meals)
        if record.cardio is not None:
            earlier.cardio = record.cardio
    return sorted(days.values(), key=lambda r: r.date)


# ---------------------------------------------------------------- lo que ya hay


def _local_day(moment: datetime, tz) -> date:
    return moment.astimezone(tz).date()


def _existing(profile, days: list[date]) -> dict:
    """Todo lo que FightLab ya tiene en esas fechas, en una consulta por tabla."""
    if not days:
        return {"rows": {}, "logs": {}, "other": {}, "day_logs": {}, "meals": {}, "cardio": {}}
    first, last = min(days), max(days)
    wanted = set(days)
    tz = _tz(profile)
    rows = {r.date: r for r in DailyCheckin.objects.filter(profile=profile, date__in=wanted)}
    logs, other = {}, defaultdict(dict)
    window = (datetime.combine(first, time.min, tzinfo=tz) - timedelta(days=1),
              datetime.combine(last, time.max, tzinfo=tz) + timedelta(days=1))
    for log in BiometricsLog.objects.filter(profile=profile, timestamp__range=window).order_by("timestamp"):
        if (log.external_id or "").startswith("checkin:"):
            try:
                logs[date.fromisoformat(log.external_id.removeprefix("checkin:"))] = log
            except ValueError:
                pass
            continue
        day = _local_day(log.timestamp, tz)
        for name in LOG_FIELDS:
            value = getattr(log, name)
            if value is not None:
                other[day].setdefault(name, value)
    day_logs = {d.date: d for d in DayLog.objects.filter(profile=profile, date__in=wanted)}
    meals = defaultdict(dict)
    for m in MealCheck.objects.filter(profile=profile, date__in=wanted):
        meals[m.date][m.meal] = m
    cardio = defaultdict(list)
    for activity in Activity.objects.filter(
        profile=profile, source=Activity.Source.IMPORT, external_id__startswith=CARDIO_PREFIX
    ).order_by("external_id"):
        try:
            day = date.fromisoformat(activity.external_id.removeprefix(CARDIO_PREFIX).split(":")[0])
        except ValueError:
            continue
        if day in wanted:
            cardio[day].append(activity)
    return {"rows": rows, "logs": logs, "other": other, "day_logs": day_logs, "meals": meals, "cardio": cardio}


def _same(name: str, old, new) -> bool:
    if name in DECIMALS:
        return round(float(old), DECIMALS[name]) == round(float(new), DECIMALS[name])
    return old == new


def _cardio_key(activity: Activity) -> tuple:
    imported = (activity.detail or {}).get("import", {})
    return (imported.get("type") or activity.title, activity.duration_sec // 60)


@dataclass
class Plan:
    """Qué hacer con un día: los campos a escribir y en qué estado está cada uno."""

    clean: Clean
    exists: bool
    write: dict = field(default_factory=dict)  # destino → {campo: valor}
    conflicts: list[str] = field(default_factory=list)
    new_fields: int = 0
    same_fields: int = 0

    @property
    def status(self) -> str:
        if self.conflicts:
            return "conflict"
        if not self.new_fields:
            return "unchanged"
        return "filled" if self.exists else "new"


def _plan(clean: Clean, existing: dict, replace: bool) -> Plan:
    day = clean.date
    row = existing["rows"].get(day)
    log = existing["logs"].get(day)
    other = existing["other"].get(day, {})
    day_log = existing["day_logs"].get(day)
    meals = existing["meals"].get(day, {})
    cardio = existing["cardio"].get(day, [])
    plan = Plan(clean, exists=any((row, log, other, day_log, meals, cardio)))

    def decide(target: str, name: str, old, new) -> None:
        if old is None or old == "":
            plan.new_fields += 1
        elif _same(name, old, new):
            plan.same_fields += 1
            return
        else:
            plan.conflicts.append(name)
            if not replace:
                return
        plan.write.setdefault(target, {})[name] = new

    for name, value in clean.log.items():
        old = getattr(log, name) if log is not None and getattr(log, name) is not None else other.get(name)
        decide("log", name, old, value)
    for name, value in clean.row.items():
        decide("row", name, getattr(row, name) if row else None, value)
    if clean.notes:
        old = row.notes if row else ""
        if clean.notes in old:
            plan.same_fields += 1
        else:  # las notas se suman: no hay conflicto
            plan.new_fields += 1
            plan.write.setdefault("row", {})["notes"] = f"{old}; {clean.notes}" if old else clean.notes
    if clean.zones:
        old = list(row.soreness_zones) if row else []
        if set(clean.zones) <= set(old):
            plan.same_fields += 1
        else:
            plan.new_fields += 1
            plan.write.setdefault("row", {})["soreness_zones"] = list(dict.fromkeys([*old, *clean.zones]))
    for name, value in clean.day.items():
        decide("day", name, getattr(day_log, name) if day_log else None, value)
    heart = dict(day_log.heart) if day_log else {}
    for name, value in clean.heart.items():
        decide("heart", name, heart.get(name), value)
    for meal, (state, change, dish) in clean.meals.items():
        stored = meals.get(meal)
        if stored is None:
            plan.new_fields += 1
            plan.write.setdefault("meals", {})[meal] = (state, change, dish)
        elif (stored.state, stored.change) == (state, change):
            if dish and not stored.dish:  # el plato del menú solo rellena
                plan.new_fields += 1
                plan.write.setdefault("meals", {})[meal] = (state, change, dish)
            else:
                plan.same_fields += 1
        else:
            plan.conflicts.append(f"meal_{meal}")
            if replace:
                plan.write.setdefault("meals", {})[meal] = (state, change, dish or stored.dish)
    if clean.cardio is not None:
        old = [_cardio_key(a) for a in cardio] or None
        new = [(code or label, minutes) for code, label, minutes in clean.cardio]
        decide("cardio", "cardio", old, new)
    return plan


# ---------------------------------------------------------------- escritura


def _write_day(profile, plan: Plan, tz) -> None:
    clean, write = plan.clean, plan.write
    day = clean.date
    if write.get("row"):
        row, _ = DailyCheckin.objects.select_for_update().get_or_create(profile=profile, date=day)
        for name, value in write["row"].items():
            setattr(row, name, value)
        row.full_clean()
        row.save()
    if write.get("log"):
        log = profile.biometrics.filter(source=BiometricsLog.Source.MANUAL, external_id=f"checkin:{day.isoformat()}").first()
        if log is None:
            log = BiometricsLog(
                profile=profile,
                source=BiometricsLog.Source.MANUAL,
                external_id=f"checkin:{day.isoformat()}",
                timestamp=datetime.combine(day, time(checkin.LOG_HOUR), tzinfo=tz),
            )
        for name, value in write["log"].items():
            if name in checkin.DECIMALS:
                value = Decimal(str(round(value, checkin.DECIMALS[name])))
            setattr(log, name, value)
        log.full_clean()
        log.save()
    if write.get("day") or write.get("heart"):
        day_log, _ = DayLog.objects.select_for_update().get_or_create(profile=profile, date=day)
        for name, value in write.get("day", {}).items():
            setattr(day_log, name, value)
        if write.get("heart"):
            day_log.heart = {**day_log.heart, **write["heart"]}
        day_log.full_clean()
        day_log.save()
    for meal, (state, change, dish) in write.get("meals", {}).items():
        MealCheck.objects.update_or_create(
            profile=profile, date=day, meal=meal, defaults={"state": state, "change": change, "dish": dish}
        )
    if "cardio" in write:
        Activity.objects.filter(
            profile=profile, source=Activity.Source.IMPORT, external_id__startswith=f"{CARDIO_PREFIX}{day.isoformat()}:"
        ).delete()
        start = datetime.combine(day, time(CARDIO_HOUR), tzinfo=tz)
        for n, (code, label, minutes) in enumerate(clean.cardio, start=1):
            detail = {"import": {"source": "parte_diario", "type": code or label}, "time_known": False}
            if code in CARDIO_SPORT:
                detail["sport_key"] = CARDIO_SPORT[code]
            if code in CARDIO_HIIT:
                detail["format"] = "hiit"
            Activity.objects.create(
                profile=profile,
                kind=Activity.Kind.SPORT,
                title=label[:80],
                started_at=start + timedelta(minutes=n - 1),
                duration_sec=minutes * 60,
                source=Activity.Source.IMPORT,
                external_id=f"{CARDIO_PREFIX}{day.isoformat()}:{n}",
                detail=detail,
            )


def _count_items(plan: Plan, items: Counter) -> None:
    write = plan.write
    for name in write.get("log", {}):
        items["weights" if name == "weight_kg" else "waists" if name == "waist_cm" else "resting_hr"] += 1
    if write.get("row"):
        items["checkins"] += 1
    if write.get("day"):
        items["day_logs"] += 1
    if write.get("heart"):
        items["heart"] += 1
    items["meals"] += len(write.get("meals", {}))
    if "cardio" in write:
        items["cardio"] += len(plan.clean.cardio)


# ---------------------------------------------------------------- revisiones


def _review_values(record, today: date, blocked: bool, report: Report) -> dict | None:
    when = record.week_end.isoformat()
    if record.week_end > today:
        report.discard("future_date", "review", when)
        return None
    if record.week_end < FLOOR:
        report.discard("too_old", "review", when)
        return None
    values = {"recalibrated_tdee": None, "target_kcal": None, "in_deficit": None}
    raw = record.values
    for name in ("tdee_kcal", "target_kcal", "in_deficit"):
        if name not in raw or not raw[name].strip():
            continue
        if blocked:
            report.blocked[name] += 1
            continue
        text = raw[name].strip()
        if name == "in_deficit":
            if text.lower() in ("true", "false"):
                values["in_deficit"] = text.lower() == "true"
            else:
                report.discard("unknown_value", name, when)
            continue
        try:
            number = float(text)
        except ValueError:
            report.discard("not_a_number", name, when)
            continue
        if not REVIEW_KCAL[0] <= number <= REVIEW_KCAL[1]:
            report.discard("out_of_range", name, when)
            continue
        if name == "tdee_kcal":
            values["recalibrated_tdee"] = round(number, 1)
        else:
            values["target_kcal"] = int(round(number))
    values["narrative"] = record.text[:REVIEW_TEXT_MAX]
    return values


def _reviews(profile, records, today, blocked, replace, dry_run, report) -> dict:
    by_week = {}
    for record in records:
        if record.week_end in by_week:
            report.notices["same_day_in_several_files"] += 1
        by_week[record.week_end] = record
    counts = Counter()
    tz = _tz(profile)
    existing = defaultdict(list)
    for review in WeeklyReview.objects.filter(profile=profile, week_end__in=list(by_week)):
        existing[review.week_end].append(review)
    for week_end, record in sorted(by_week.items()):
        values = _review_values(record, today, blocked, report)
        if values is None:
            continue
        counts["total"] += 1
        stored = existing.get(week_end, [])
        if any(r.source == WeeklyReview.Source.APP for r in stored):
            counts["kept_app"] += 1
            continue
        imported = stored[0] if stored else None
        if imported is not None:
            same = all(getattr(imported, k) == v for k, v in values.items())
            if same:
                counts["unchanged"] += 1
                continue
            counts["conflict"] += 1
            if not replace:
                continue
        else:
            counts["new"] += 1
        counts["written"] += 1
        if dry_run:
            continue
        fields = {
            **values,
            "status": WeeklyReview.Status.ACCEPTED,
            "accepted": ["calories"] if values["target_kcal"] is not None else [],
            "accepted_at": datetime.combine(week_end, time(REVIEW_HOUR), tzinfo=tz),
        }
        if imported is None:
            WeeklyReview.objects.create(profile=profile, week_end=week_end, source=WeeklyReview.Source.IMPORT, **fields)
        else:
            for name, value in fields.items():
                setattr(imported, name, value)
            imported.save()
    return {k: counts[k] for k in ("total", "new", "conflict", "unchanged", "kept_app", "written")}


# ---------------------------------------------------------------- entrada


def _discarded(report: Report) -> list[dict]:
    out = []
    for (code, column), whens in sorted(report.discarded.items()):
        examples = sorted({w for w in whens if w})[:MAX_EXAMPLES]
        out.append({"code": code, "field": column, "count": len(whens), "examples": examples})
    return out


def import_history(user, files: list[ParsedFile], *, today: date, on_conflict: str = "keep", dry_run: bool = False) -> dict:
    """Valida, compara y (sin `dry_run`) guarda los días, revisiones y series de `files`."""
    if on_conflict not in ON_CONFLICT:
        raise HistoryError("bad_conflict_mode")
    replace = on_conflict == "replace"
    profile = user.profile
    tz = _tz(profile)
    blocked = checkin.weight_tracking_blocked(user, today)
    report = Report()
    for parsed in files:
        report.merge(parsed)
    records = _merge([r for f in files for r in f.days], report)
    if len(records) > MAX_DAYS:
        raise HistoryError("too_many_days", {"max": MAX_DAYS})

    cleaned = [c for c in (_clean_day(r, today, blocked, report) for r in records) if c is not None]
    existing = _existing(profile, [c.date for c in cleaned])
    plans = [_plan(c, existing, replace) for c in cleaned]
    status = Counter(p.status for p in plans)
    items = Counter()
    written = 0
    with transaction.atomic():
        for plan in plans:
            if not plan.write:
                continue
            _count_items(plan, items)
            written += 1
            if not dry_run:
                _write_day(profile, plan, tz)
        reviews = _reviews(
            profile, [r for f in files for r in f.reviews], today, blocked, replace, dry_run, report
        )

    sets = []
    for parsed in files:
        if parsed.sets is None:
            continue
        try:
            sets.append((parsed.name, imports.import_sets(user, parsed.sets, dry_run=dry_run), None))
        except ImportFileError as exc:
            sets.append((parsed.name, None, {"code": exc.code, "params": exc.params}))

    if items["cardio"]:
        report.notices["cardio_no_load"] = items["cardio"]
    if items["heart"]:
        report.notices["heart_hidden"] = items["heart"]
    days = [p.clean.date for p in plans]
    conflicts = [p for p in plans if p.conflicts]
    return {
        "dry_run": dry_run,
        "on_conflict": on_conflict,
        "days": {
            "total": len(plans),
            "new": status["new"],
            "filled": status["filled"],
            "conflict": status["conflict"],
            "unchanged": status["unchanged"],
            "written": written,
        },
        "conflicts": [
            {"date": p.clean.date.isoformat(), "fields": sorted(set(p.conflicts))} for p in conflicts[:MAX_CONFLICTS_LISTED]
        ],
        "range": {"first": min(days).isoformat(), "last": max(days).isoformat()} if days else None,
        "items": {k: items[k] for k in ("checkins", "weights", "waists", "resting_hr", "meals", "cardio", "day_logs", "heart")},
        "reviews": reviews,
        "sets": [{"name": name, "result": result, "error": error} for name, result, error in sets],
        "discarded": _discarded(report),
        "weight_blocked": {"active": blocked, "count": sum(report.blocked.values()), "fields": sorted(report.blocked)},
        "notices": [{"code": code, "count": n} for code, n in sorted(report.notices.items())],
    }
