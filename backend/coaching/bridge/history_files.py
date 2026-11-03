"""Leer el historial de ParteDiario y del coach (fase 10): de bytes a días, revisiones y series.

Formatos que se reconocen (el contenido manda; la extensión solo desempata):

- **Copia de seguridad JSON de ParteDiario** (`kind: "parte-diario-copia"`, `format` 1): `days`
  (las claves son las columnas del CSV y los valores cerrados van por su nombre de constante:
  `PASEO`, `MOLESTIA_LEVE`, `GIMNASIO`…), `meal_checks`, `cardio_sessions`, `menus`,
  `shopping_checks` y `ticket_photos`. Una copia de antes de la v1.6 no trae `cardio_sessions`:
  el cardio va dentro de cada día y pasa a una sesión, como hace la app al restaurarla. Los menús,
  la lista de la compra y las fotos no se leen aquí (fase 12); solo se cuentan.
- **CSV semanal de ParteDiario** (UTF-8, punto decimal, fechas ISO, `true`/`false`, celda vacía =
  no apuntado, RFC 4180). Las columnas se leen por su nombre: pueden faltar las opcionales y
  llegar otras nuevas al final. Los valores cerrados van por su texto (`Paseo con la perra`,
  `molestia leve`, `gimnasio`, `no_hecho`).
- **`checkins.csv` del coach**: `date,weight_kg,waist_cm,intake_kcal,sleep_hours,notes`.
- **`reviews/FIN.md` del coach**: el nombre es la fecha de fin de la semana; las líneas
  `tdee_kcal:`, `target_kcal:` e `in_deficit:` y el resto, el texto.
- **`sessions.csv` del coach** (las columnas de `ExerciseSet`) y los CSV de Hevy o genéricos de
  la fase 9: van a `imports.import_sets`, como en `POST /coach/import`.

Aquí solo se lee y se normaliza: los rangos, los flags y lo que ya hay en FightLab los aplica
`coaching.history_import`. Un valor que no se entiende se descarta con su motivo; nunca se adivina.
"""
from __future__ import annotations

import csv
import io
import json
import re
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from coach.sessions import store

from .importers import ImportFileError, Parsed, check_bytes
from .importers import parse as parse_sets

BACKUP_KIND = "parte-diario-copia"
BACKUP_FORMAT = 1  # `Backup.FORMAT` de ParteDiario: una copia más nueva no se lee

MEALS = ("desayuno", "comida", "merienda", "cena")
MEAL_STATES = ("hecho", "no_hecho", "cambiada")
DAY_TYPES = ("gimnasio", "cardio", "descanso")
QUAD_STATES = ("bien", "molestia_leve", "peor")

# `CardioType` de ParteDiario: nombre de la constante → texto de la app (lo que sale en el CSV).
CARDIO_TYPES = {
    "PASEO": "Paseo con la perra",
    "PASEO_TROTE": "Paseo + trote",
    "TROTE": "Trote",
    "HIIT_SACO": "HIIT saco",
    "HIIT_MAQUINA": "HIIT máquina",
    "OTRO": "Otro",
}
CARDIO_BY_LABEL = {label.casefold(): code for code, label in CARDIO_TYPES.items()}
NO_CARDIO = "NADA"
MIXED_CARDIO = "varios"  # `cardio_type` del CSV cuando el día tiene sesiones de varios tipos

PD_CSV_MARKERS = {"sleep_h", "trained", "mobility", "quad", "tipo_dia", "cardio_sesiones", "cardio_type"}
COACH_CHECKIN_COLUMNS = {"date", "weight_kg", "waist_cm", "intake_kcal", "sleep_hours", "notes"}
HEART_COLUMNS = ("fc_media", "fc_max", "min_z1", "min_z2", "min_z3")
REVIEW_KEYS = ("tdee_kcal", "target_kcal", "in_deficit")
_REVIEW_LINE = re.compile(r"^\s*(tdee_kcal|target_kcal|in_deficit)\s*:\s*(.*?)\s*$", re.IGNORECASE)
_REVIEW_NAME = re.compile(r"(\d{4}-\d{2}-\d{2})")


@dataclass
class Cardio:
    code: str  # `CardioType` de ParteDiario, o "" si el texto no es uno conocido
    label: str
    minutes: object  # tal cual: lo valida `history_import`


@dataclass
class DayRecord:
    """Un día del archivo, sin validar. `checkin` son campos del check-in (`checkin.ALLOWED`) y
    `quad`; `day` los de `DayLog` (y `heart`); `meals`, comida → (estado, cambio, plato);
    `cardio` es None si el archivo no dice nada del cardio ese día."""

    date: date
    checkin: dict = field(default_factory=dict)
    day: dict = field(default_factory=dict)
    heart: dict = field(default_factory=dict)
    meals: dict = field(default_factory=dict)
    cardio: list[Cardio] | None = None


@dataclass
class ReviewRecord:
    week_end: date
    values: dict  # tdee_kcal, target_kcal, in_deficit tal cual (texto)
    text: str


@dataclass
class ParsedFile:
    name: str
    kind: str  # parte_diario_json | parte_diario_csv | coach_checkins | coach_review | sets
    days: list[DayRecord] = field(default_factory=list)
    reviews: list[ReviewRecord] = field(default_factory=list)
    sets: Parsed | None = None
    # Lo que no se ha podido leer: (código, campo) → fechas (o "" si no hay fecha).
    discarded: dict = field(default_factory=dict)
    # Lo que el archivo trae y esta fase no importa: código → cuántos.
    notices: Counter = field(default_factory=Counter)

    def discard(self, code: str, column: str = "", when: str = "") -> None:
        self.discarded.setdefault((code, column), []).append(when)


# ---------------------------------------------------------------- ayudas


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _bool(value, out: ParsedFile, column: str, when: str):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = _text(value).lower()
    if text in ("true", "false"):
        return text == "true"
    out.discard("unknown_value", column, when)
    return None


def _choice(value, allowed, out: ParsedFile, column: str, when: str) -> str | None:
    """Un valor cerrado por su constante (`MOLESTIA_LEVE`) o por su texto (`molestia leve`)."""
    text = _text(value)
    if not text:
        return None
    key = text.lower().replace(" ", "_")
    if key in allowed:
        return key
    out.discard("unknown_value", column, when)
    return None


def _date(value, out: ParsedFile) -> date | None:
    text = _text(value)
    try:
        return date.fromisoformat(text)
    except ValueError:
        out.discard("bad_date", "date", text[:20])
        return None


def _quad(value, record: DayRecord, out: ParsedFile, when: str) -> None:
    state = _choice(value, QUAD_STATES, out, "quad", when)
    if state is not None:
        record.checkin["quad"] = state


def _cardio(type_value, minutes, out: ParsedFile, when: str) -> Cardio | None:
    text = _text(type_value)
    if not text or text.upper() == NO_CARDIO or text.casefold() == "nada":
        return None
    if text.upper() in CARDIO_TYPES:
        return Cardio(text.upper(), CARDIO_TYPES[text.upper()], minutes)
    code = CARDIO_BY_LABEL.get(text.casefold(), "")
    return Cardio(code, text, minutes)


# ---------------------------------------------------------------- copia JSON de ParteDiario


def _json_day(o: dict, out: ParsedFile) -> DayRecord | None:
    day = _date(o.get("date"), out)
    if day is None:
        return None
    when = day.isoformat()
    record = DayRecord(day)
    for src, dst in (("weight_kg", "weight_kg"), ("waist_cm", "waist_cm"), ("intake_kcal", "intake_kcal"),
                     ("sleep_h", "sleep_hours"), ("energy", "energy")):
        if o.get(src) is not None:
            record.checkin[dst] = o[src]
    if _text(o.get("notes")):
        record.checkin["notes"] = _text(o["notes"])
    _quad(o.get("quad"), record, out, when)
    for name in ("trained", "mobility"):
        value = _bool(o.get(name), out, name, when)
        if value is not None:
            record.day[name] = value
    day_type = _choice(o.get("day_type"), DAY_TYPES, out, "day_type", when)
    if day_type:
        record.day["day_type"] = day_type
    return record


def parse_backup(name: str, text: str) -> ParsedFile:
    try:
        root = json.loads(text)
    except json.JSONDecodeError:
        raise ImportFileError("not_json") from None
    if not isinstance(root, dict) or root.get("kind") != BACKUP_KIND:
        raise ImportFileError("not_backup")
    fmt = root.get("format")
    if not isinstance(fmt, int) or isinstance(fmt, bool) or fmt > BACKUP_FORMAT:
        raise ImportFileError("newer_backup", {"format": str(fmt)})

    def objects(key: str) -> list[dict]:
        value = root.get(key) or []
        if not isinstance(value, list) or any(not isinstance(o, dict) for o in value):
            raise ImportFileError("damaged_backup", {"key": key})
        return value

    out = ParsedFile(name, "parte_diario_json")
    days: dict[date, DayRecord] = {}
    for o in objects("days"):
        record = _json_day(o, out)
        if record is not None:
            days[record.date] = record

    def record_for(day: date) -> DayRecord:
        return days.setdefault(day, DayRecord(day))

    if "cardio_sessions" in root:
        for o in objects("cardio_sessions"):
            day = _date(o.get("date"), out)
            if day is None:
                continue
            session = _cardio(o.get("type"), o.get("minutes"), out, day.isoformat())
            if session is not None:
                record = record_for(day)
                record.cardio = (record.cardio or []) + [session]
    else:  # copia de antes de la v1.6: el cardio va en el día
        for o in objects("days"):
            day = _date(o.get("date"), out) if o.get("date") else None
            session = _cardio(o.get("cardio_type"), o.get("cardio_min"), out, day.isoformat()) if day else None
            if session is not None:
                record_for(day).cardio = [session]

    for o in objects("meal_checks"):
        day = _date(o.get("date"), out)
        if day is None:
            continue
        when = day.isoformat()
        meal = _choice(o.get("meal"), MEALS, out, "meal", when)
        state = _choice(o.get("state"), MEAL_STATES, out, "meal_state", when) if o.get("state") else None
        if state is None and isinstance(o.get("done"), bool):  # filas de antes de la v3
            state = "hecho" if o["done"] else "no_hecho"
        if meal is None or state is None:
            if meal is not None and o.get("state") is None:
                out.discard("unknown_value", "meal_state", when)
            continue
        record_for(day).meals[meal] = (state, _text(o.get("change")), "")

    for key, code in (("menus", "menus_later"), ("shopping_checks", "shopping_later"), ("ticket_photos", "tickets_later")):
        if objects(key):
            out.notices[code] = len(root[key])
    out.days = sorted(days.values(), key=lambda r: r.date)
    return out


# ---------------------------------------------------------------- CSV


def _rows(text: str) -> tuple[list[str], list[dict]]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    header = [_text(h).lower() for h in (reader.fieldnames or [])]
    reader.fieldnames = header
    return header, list(reader)


def _sessions(value: str, out: ParsedFile, when: str) -> list[Cardio]:
    """`cardio_sesiones`: "Paseo con la perra:25;Trote:15"."""
    sessions = []
    for part in value.split(";"):
        if not part.strip():
            continue
        label, sep, minutes = part.rpartition(":")
        if not sep or not label.strip():
            out.discard("unknown_value", "cardio_sesiones", when)
            continue
        session = _cardio(label, minutes.strip(), out, when)
        if session is not None:
            sessions.append(session)
    return sessions


def parse_parte_csv(name: str, header: list[str], rows: list[dict]) -> ParsedFile:
    out = ParsedFile(name, "parte_diario_csv")
    days: dict[date, DayRecord] = {}
    for row in rows:
        row = {k: v for k, v in row.items() if k}  # sin las celdas de más de una fila larga
        day = _date(row.get("date"), out)
        if day is None:
            continue
        when = day.isoformat()
        record = DayRecord(day)

        def cell(column: str) -> str:
            return _text(row.get(column))

        for src, dst in (("weight_kg", "weight_kg"), ("waist_cm", "waist_cm"), ("intake_kcal", "intake_kcal"),
                         ("sleep_h", "sleep_hours"), ("energy", "energy"), ("fc_reposo", "resting_heart_rate")):
            if cell(src):
                record.checkin[dst] = cell(src)
        if cell("notes"):
            record.checkin["notes"] = cell("notes")
        _quad(cell("quad"), record, out, when)
        for column in ("trained", "mobility"):
            value = _bool(cell(column), out, column, when)
            if value is not None:
                record.day[column] = value
        day_type = _choice(cell("tipo_dia"), DAY_TYPES, out, "tipo_dia", when)
        if day_type:
            record.day["day_type"] = day_type
        for column in HEART_COLUMNS:
            if cell(column):
                record.heart[column] = cell(column)

        for meal in MEALS:
            state = _choice(cell(f"{meal}_estado"), MEAL_STATES, out, f"{meal}_estado", when)
            if state is None:  # CSV de antes de la v1.3: solo hecho / no hecho
                done = _bool(cell(f"{meal}_hecho"), out, f"{meal}_hecho", when)
                state = None if done is None else ("hecho" if done else "no_hecho")
            if state is not None:
                record.meals[meal] = (state, cell(f"{meal}_cambio"), cell(meal))

        if cell("cardio_sesiones"):
            record.cardio = _sessions(cell("cardio_sesiones"), out, when)
        elif cell("cardio_type"):  # CSV de antes de la v1.6: un solo tipo con sus minutos
            if cell("cardio_type").casefold() == MIXED_CARDIO:
                out.discard("cardio_without_detail", "cardio_type", when)
            else:
                session = _cardio(cell("cardio_type"), cell("cardio_min"), out, when)
                record.cardio = [session] if session else None
        days[day] = record
    out.days = sorted(days.values(), key=lambda r: r.date)
    return out


def parse_coach_checkins(name: str, rows: list[dict]) -> ParsedFile:
    out = ParsedFile(name, "coach_checkins")
    days: dict[date, DayRecord] = {}
    for row in rows:
        day = _date(row.get("date"), out)
        if day is None:
            continue
        record = DayRecord(day)
        for column in ("weight_kg", "waist_cm", "intake_kcal", "sleep_hours", "notes"):
            if _text(row.get(column)):
                record.checkin[column] = _text(row[column])
        days[day] = record
    out.days = sorted(days.values(), key=lambda r: r.date)
    return out


def parse_coach_sessions(name: str, data: bytes) -> ParsedFile:
    with tempfile.TemporaryDirectory(prefix="fl-history-") as tmp:
        path = Path(tmp) / "sessions.csv"
        path.write_bytes(data.replace(b"\r\n", b"\n"))
        try:
            sets = store.read_sets(path)
        except store.StoreError as exc:
            raise ImportFileError("invalid", {}, str(exc).replace(str(path), "file")) from None
    return ParsedFile(name, "sets", sets=Parsed("coach_sessions", sets))


def parse_review(name: str, text: str) -> ParsedFile:
    match = _REVIEW_NAME.search(Path(name).stem)
    try:
        week_end = date.fromisoformat(match.group(1)) if match else None
    except ValueError:
        week_end = None
    if week_end is None:
        raise ImportFileError("review_name")
    values: dict = {}
    body = []
    for line in text.splitlines():
        found = _REVIEW_LINE.match(line)
        if found and found.group(1).lower() not in values:
            values[found.group(1).lower()] = found.group(2)
        else:
            body.append(line)
    return ParsedFile(name, "coach_review", reviews=[ReviewRecord(week_end, values, "\n".join(body).strip())])


# ---------------------------------------------------------------- entrada


def parse_file(name: str, data: bytes) -> ParsedFile:
    """Reconoce el archivo y lo lee. Lanza `ImportFileError` si no se puede."""
    check_bytes(data)
    text = data.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    lower = name.lower()
    if lower.endswith(".json") or text.lstrip().startswith("{"):
        return parse_backup(name, text)
    if lower.endswith(".md"):
        return parse_review(name, text)
    try:
        header, rows = _rows(text)
    except csv.Error as exc:
        raise ImportFileError("invalid", {}, str(exc)) from None
    columns = set(header)
    if "date" in columns and columns & (PD_CSV_MARKERS | {f"{m}_hecho" for m in MEALS}):
        return parse_parte_csv(name, header, rows)
    if "date" in columns and "sleep_hours" in columns and columns <= COACH_CHECKIN_COLUMNS | {""}:
        return parse_coach_checkins(name, rows)
    if columns == set(store.FIELDS):
        return parse_coach_sessions(name, data)
    return ParsedFile(name, "sets", sets=parse_sets(data))
