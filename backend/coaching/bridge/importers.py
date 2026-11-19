"""Leer un CSV subido con `coach.sessions.importers` (Task 9.1).

Los importadores del coach leen una ruta, así que el archivo se escribe en una carpeta temporal y
se borra al terminar. Lo que añade el puente:

- Comprueba el archivo antes de dárselo al motor: tamaño, que no esté vacío, que sea texto UTF-8
  (con o sin BOM) y no binario.
- Los errores del motor (`ImporterError`, en inglés y con la ruta temporal) se convierten en un
  código con sus parámetros, que la app traduce.
- Normaliza los saltos de línea de las notas y el título: un CSV guardado con CRLF (Excel, un
  checkout de git en Windows) deja `\\r\\n` dentro de los campos entre comillas, porque el motor
  abre el archivo con `newline=""` y no los toca (sugerencia U16).
- De Hevy guarda además `end_time`, que el motor no pasa a `ExerciseSet`, para la duración de la
  sesión.

No hay importador de Lyfta: el motor vendorizado (`69e5537`) no lo trae.
"""
from __future__ import annotations

import csv
import re
import tempfile
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path

from coach.sessions.importers import base, hevy_csv  # el paquete registra los dos importadores
from coach.sessions.importers.base import ImporterError
from coach.sessions.model import ExerciseSet

IMPORTERS = ("hevy_csv", "generic_csv")
MAX_IMPORT_BYTES = 5 * 1024 * 1024  # un export de Hevy de años ronda 1-2 MB


class ImportFileError(ValueError):
    """Un archivo que no se puede importar: `code` y `params` para el texto de la app."""

    def __init__(self, code: str, params: dict | None = None, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.params = params or {}
        self.detail = detail


@dataclass
class Parsed:
    importer: str
    sets: list[ExerciseSet]
    # Hevy: inicio de la sesión → fin, para la duración (las demás fuentes no la dan).
    end_times: dict[datetime, datetime] = field(default_factory=dict)
    # F17: lo que el motor no pasa a `ExerciseSet`, en paralelo a `sets` (una por fila): la
    # superserie (`superset_id`) y la descripción de la sesión de Hevy.
    extras: list[dict] = field(default_factory=list)


# Mensajes de `ImporterError` del motor → código de la app. El primero que case gana.
_ERRORS = (
    (re.compile(r"no importer can read"), "unknown_format"),
    (re.compile(r"more than one importer can read"), "ambiguous_format"),
    (re.compile(r"no importer named"), "unknown_format"),
    (re.compile(r"missing columns (?P<columns>.+)$"), "missing_columns"),
    (re.compile(r"line (?P<line>\d+) has more fields than the header"), "decimal_comma"),
    (re.compile(r"line (?P<line>\d+): (?P<column>\w+) '(?P<value>.*)' must be a whole number"), "not_whole"),
    (re.compile(r"line (?P<line>\d+): (?P<column>\w+) '(?P<value>.*)' is not a (finite )?number"), "not_a_number"),
    (re.compile(r"line (?P<line>\d+): date '(?P<value>.*)' is not"), "bad_date"),
    (re.compile(r"(unparseable|impossible) timestamp '(?P<value>.*)'"), "bad_date"),
)


def _error(exc: Exception, path: Path) -> ImportFileError:
    text = str(exc).replace(str(path), "file")
    for pattern, code in _ERRORS:
        if match := pattern.search(text):
            params = {k: v for k, v in match.groupdict().items() if v is not None}
            if "line" in params:
                params["line"] = int(params["line"])
            return ImportFileError(code, params, text)
    return ImportFileError("invalid", {}, text)


def check_bytes(data: bytes) -> None:
    if not data.strip():
        raise ImportFileError("empty_file")
    if len(data) > MAX_IMPORT_BYTES:
        raise ImportFileError("too_large", {"mb": MAX_IMPORT_BYTES // (1024 * 1024)})
    if b"\x00" in data:
        raise ImportFileError("not_csv")
    try:
        data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImportFileError("encoding") from None


def _clean_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _hevy_end_times(path: Path) -> dict[datetime, datetime]:
    out: dict[datetime, datetime] = {}
    for row in base.read_rows(path):
        try:
            start = hevy_csv.parse_datetime(row["start_time"])
            end = hevy_csv.parse_datetime(row.get("end_time") or "")
        except ImporterError:
            continue
        if end > start:
            out.setdefault(start, end)
    return out


def _hevy_extras(path: Path) -> list[dict]:
    """Por fila, como `HevyCsv.read` (una serie por fila y en el mismo orden): `superset_id`
    (entero o None) y la descripción de la sesión."""
    out = []
    for row in base.read_rows(path):
        raw = (row.get("superset_id") or "").strip()
        try:
            superset = int(float(raw)) if raw else None
        except ValueError:
            superset = None
        if superset is not None and not 0 <= superset <= 200:
            superset = None
        out.append({"superset": superset, "description": _clean_text((row.get("description") or "").strip())})
    return out


def parse(data: bytes, importer: str | None = None) -> Parsed:
    """Las series del archivo con el importador pedido o, sin él, el que lo reconozca."""
    check_bytes(data)
    if importer is not None and importer not in IMPORTERS:
        raise ImportFileError("unknown_format")
    with tempfile.TemporaryDirectory(prefix="fl-import-") as tmp:
        path = Path(tmp) / "upload.csv"
        path.write_bytes(data)
        try:
            chosen = base.get(importer) if importer else base.detect(path)
            sets = chosen.read(path)
            end_times = _hevy_end_times(path) if chosen.name == "hevy_csv" else {}
            extras = _hevy_extras(path) if chosen.name == "hevy_csv" else []
        except ImporterError as exc:
            raise _error(exc, path) from None
        except (csv.Error, UnicodeDecodeError, KeyError) as exc:
            raise ImportFileError("invalid", {}, str(exc).replace(str(path), "file")) from None
    sets = [replace(s, notes=_clean_text(s.notes), session_title=_clean_text(s.session_title)) for s in sets]
    if len(extras) != len(sets):  # por si el motor cambia y deja de dar una serie por fila
        extras = []
    return Parsed(chosen.name, sets, end_times, extras)
