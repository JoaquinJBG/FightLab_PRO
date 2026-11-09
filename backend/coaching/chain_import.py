"""Importar el catálogo de una cadena de súper desde el archivo del propio usuario (fase 13).

Lee dos formatos de CSV (con o sin BOM, separados por comas o por punto y coma):

- **Tabla puntuada** (`SCORED`): `mercadona_id,ean,nombre,marca,categoria,formato,precio_kilo,kcal,
  protein_g,carbs_g,fat_g,saturadas_g,sugars_g,salt_g,fibre_g,nutriscore,nova,bebida,azucar,
  saturadas,sal,grasa,valoracion,motivo,valores_coherentes,en_tabla_app,fuente`.
- **Tabla de la app** (`TABLE`): `name_es,nombre_mercadona,equivale_a,ean,mercadona_id,kcal,
  protein_g,carbs_g,fat_g,fibre_g,fuente,valoracion`. Es la que dice qué producto equivale a cada
  alimento genérico del motor (`equivale_a`).

Valores por 100 g (por 100 ml en bebidas). Las columnas del semáforo, `motivo`, `en_tabla_app` y
`valores_coherentes` no se guardan: el motor (`product_rating`) lo recalcula todo, y la
`valoracion` del archivo se guarda aparte para enseñar en qué no coincide.

**Clave**: el id del producto en la tienda (`mercadona_id`) o, sin él, el EAN. Reimportar no
duplica: una fila con la misma clave actualiza el producto, y solo con lo que el archivo trae (una
celda vacía no borra lo guardado). Así se puede subir la tabla puntuada y después la de la app, y
el producto junta los nutrientes de la primera con el `equivale_a` de la segunda.

FightLab no descarga nada de la cadena ni de sus fuentes: solo lee el archivo que se sube.
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from coach.text import fold
from django.db import transaction

from . import product_rating
from .bridge.importers import MAX_IMPORT_BYTES, ImportFileError
from .models import ChainProduct

SCORED, TABLE = "scored", "table"
DEFAULT_CHAIN = "Mercadona"
MAX_ROWS = 10_000  # convention: la tabla puntuada completa ronda las 2.000 filas
EXAMPLES = 5  # líneas de ejemplo por motivo de descarte
DIFF_EXAMPLES = 10
EAN = re.compile(r"\d{8,14}")
REF = re.compile(r"[\w.-]{1,40}")
# convention: rangos posibles por 100 g (la grasa es lo más denso: 900 kcal) y precio por kg.
LIMITS = {"kcal": 900, "price_per_kg": 1000}
GRAM_FIELDS = ("protein_g", "carbs_g", "fat_g", "fibre_g", "saturates_g", "sugars_g", "salt_g")
NUMBER_FIELDS = ("kcal", *GRAM_FIELDS, "price_per_kg")
TEXT_FIELDS = ("name", "alias", "brand", "category", "pack", "equivalent_of", "source")
TEXT_MAX = {"name": 200, "alias": 200, "brand": 120, "category": 120, "pack": 120, "equivalent_of": 200, "source": 500}

# columna del archivo -> campo del modelo
COLUMNS = {
    "mercadona_id": "chain_ref",
    "ean": "ean",
    "nombre": "name",
    "nombre_mercadona": "name",
    "name_es": "alias",
    "marca": "brand",
    "categoria": "category",
    "formato": "pack",
    "precio_kilo": "price_per_kg",
    "equivale_a": "equivalent_of",
    "kcal": "kcal",
    "protein_g": "protein_g",
    "carbs_g": "carbs_g",
    "fat_g": "fat_g",
    "fibre_g": "fibre_g",
    "saturadas_g": "saturates_g",
    "sugars_g": "sugars_g",
    "salt_g": "salt_g",
    "nutriscore": "nutriscore",
    "nova": "nova",
    "bebida": "drink",
    "fuente": "source",
    "valoracion": "file_rating",
}
SCORED_NEEDS = {"mercadona_id", "nombre", "kcal", "valoracion"}
TABLE_NEEDS = {"name_es", "nombre_mercadona", "equivale_a"}
# Campos que se comparan para decir si una fila cambia un producto guardado.
COMPARED = ("ean", "equivalent_key", *TEXT_FIELDS, *NUMBER_FIELDS, "nutriscore", "nova", "drink", "per", "file_rating")
YES = {"si", "sí", "yes", "true", "1", "x"}


@dataclass
class Parsed:
    format: str
    rows: list[tuple[int, dict]]  # (línea del archivo, campos)
    discarded: dict[tuple[str, str], list[int]] = field(default_factory=lambda: defaultdict(list))
    notices: Counter = field(default_factory=Counter)
    total: int = 0


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportFileError("bad_encoding")


def _number(text: str, decimal_comma: bool) -> float | None:
    text = (text or "").strip().replace("€", "").replace(" ", "")
    if not text or text in ("-", "nan", "NaN"):
        return None
    if decimal_comma or ("," in text and "." not in text):
        text = text.replace(".", "").replace(",", ".") if decimal_comma else text.replace(",", ".")
    return float(text)  # ValueError: la fila se descarta


def parse(data: bytes) -> Parsed:
    if len(data) > MAX_IMPORT_BYTES:
        raise ImportFileError("too_large", {"mb": MAX_IMPORT_BYTES // (1024 * 1024)})
    text = _decode(data)
    first = text.split("\n", 1)[0]
    delimiter = ";" if first.count(";") > first.count(",") else ","
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration:
        raise ImportFileError("empty_file") from None
    names = [product_rating.fold(h).replace(" ", "_") for h in header]
    present = set(names)
    if SCORED_NEEDS <= present:
        kind = SCORED
    elif TABLE_NEEDS <= present:
        kind = TABLE
    else:
        raise ImportFileError("unknown_columns", {"columns": ", ".join(h.strip() for h in header[:12])})
    decimal_comma = delimiter == ";"
    parsed = Parsed(kind, [])
    for line, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue
        parsed.total += 1
        if parsed.total > MAX_ROWS:
            raise ImportFileError("too_many_rows", {"max": MAX_ROWS})
        raw = {n: (cells[i].strip() if i < len(cells) else "") for i, n in enumerate(names)}
        row = _row(raw, kind, decimal_comma, parsed, line)
        if row is not None:
            parsed.rows.append((line, row))
    return parsed


def _row(raw: dict, kind: str, decimal_comma: bool, parsed: Parsed, line: int) -> dict | None:
    def drop(code: str, column: str = "") -> None:
        parsed.discarded[(code, column)].append(line)

    row: dict = {}
    for column, target in COLUMNS.items():
        if column not in raw:
            continue
        value = raw[column]
        if target == "name" and row.get("name"):
            continue  # `nombre` gana a `nombre_mercadona` si vienen los dos
        if target in NUMBER_FIELDS:
            try:
                number = _number(value, decimal_comma)
            except ValueError:
                drop("bad_number", column)
                return None
            limit = LIMITS.get(target, 100)
            if number is not None and not 0 <= number <= limit:
                drop("out_of_range", column)
                return None
            row[target] = number
        elif target == "nova":
            row[target] = int(value) if value in ("1", "2", "3", "4") else None
        elif target == "drink":
            row[target] = product_rating.fold(value) in YES
        elif target == "nutriscore":
            grade = value.strip().upper()
            row[target] = grade if grade in ("A", "B", "C", "D", "E") else ""
        elif target == "file_rating":
            row[target] = product_rating.normalise_file_rating(value)
        else:
            row[target] = " ".join(value.split())[: TEXT_MAX.get(target, 200)]
    if kind == TABLE and not row.get("name"):
        row["name"] = row.get("alias", "")
    if not row.get("name"):
        drop("no_name")
        return None
    ref, ean = row.get("chain_ref", ""), row.get("ean", "")
    if ref and not REF.fullmatch(ref):
        ref = row["chain_ref"] = ""
        parsed.notices["ref_invalid"] += 1
    if ean and not EAN.fullmatch(ean):
        ean = row["ean"] = ""
        parsed.notices["ean_invalid"] += 1
    if not ref and not ean:
        drop("no_key")
        return None
    if None not in (row.get("fat_g"), row.get("saturates_g")) and row["saturates_g"] > row["fat_g"] + 0.05:
        row["saturates_g"] = None  # más saturada que grasa: el dato es de otra receta
        parsed.notices["saturates_dropped"] += 1
    return row


def _inputs(p: ChainProduct) -> product_rating.Inputs:
    return product_rating.Inputs(
        name=p.name, kcal=p.kcal, protein_g=p.protein_g, carbs_g=p.carbs_g, fat_g=p.fat_g, fibre_g=p.fibre_g,
        saturates_g=p.saturates_g, sugars_g=p.sugars_g, salt_g=p.salt_g, nutriscore=p.nutriscore,
        category=p.category, drink=p.drink,
    )


def apply_rating(p: ChainProduct) -> product_rating.Rating:
    """Valora el producto con el motor y deja el resultado en sus campos (sin guardar)."""
    result = product_rating.rate(_inputs(p))
    p.rating, p.label_check, p.reasons, p.rating_version = result.rating, result.check, result.reasons, product_rating.RATING_VERSION
    if p.drink is None:
        p.per = "100 ml" if result.drink else "100 g"
    else:
        p.per = "100 ml" if p.drink else "100 g"
    return result


def _snapshot(p: ChainProduct) -> tuple:
    return (*(getattr(p, f) for f in COMPARED), p.rating, p.label_check, p.reasons, p.rating_version)


def import_catalogue(user, parsed: Parsed, chain: str = DEFAULT_CHAIN, dry_run: bool = False) -> dict:
    profile = user.profile
    existing = list(ChainProduct.objects.filter(profile=profile, chain=chain))
    by_ref = {p.chain_ref: p for p in existing if p.chain_ref}
    by_ean = {p.ean: p for p in existing if p.ean}
    seen: set[int] = set()  # productos guardados que ya ha tocado otra fila del archivo
    seen_keys: set[str] = set()
    created: list[ChainProduct] = []
    changed: list[ChainProduct] = []
    unchanged = 0
    ratings: Counter = Counter()
    checks: Counter = Counter()
    diffs: list[dict] = []
    diff_count = 0

    for line, row in parsed.rows:
        ref, ean = row.get("chain_ref", ""), row.get("ean", "")
        keys = {f"r:{ref}" if ref else "", f"e:{ean}" if ean else ""} - {""}
        if keys & seen_keys:
            parsed.discarded[("duplicate_in_file", "")].append(line)
            continue
        target = by_ref.get(ref) if ref else None
        if target is None and ean:
            candidate = by_ean.get(ean)
            if candidate is not None and (not ref or not candidate.chain_ref):
                target = candidate
            elif candidate is not None:  # el EAN es de otro producto de la tienda: no se usa aquí
                row["ean"] = ean = ""
                parsed.notices["ean_taken"] += 1
        if target is not None and target.pk in seen:
            parsed.discarded[("duplicate_in_file", "")].append(line)
            continue
        seen_keys |= keys
        product = target or ChainProduct(profile=profile, chain=chain)
        before = _snapshot(product) if target is not None else None
        for name, value in row.items():
            if value is None or value == "":
                continue  # una celda vacía no borra lo guardado
            setattr(product, name, value)
        product.equivalent_key = fold(product.equivalent_of) if product.equivalent_of else ""
        result = apply_rating(product)
        ratings[result.rating] += 1
        if result.check:
            checks[result.check] += 1
        if product.file_rating and product.file_rating != result.rating:
            diff_count += 1
            if len(diffs) < DIFF_EXAMPLES:
                diffs.append({"line": line, "name": product.name, "file": product.file_rating, "engine": result.rating})
        if target is None:
            created.append(product)
            if ref:
                by_ref[ref] = product
            if ean:
                by_ean[ean] = product
        else:
            seen.add(target.pk)
            if _snapshot(product) != before:
                changed.append(product)
            else:
                unchanged += 1
            if ean:
                by_ean.setdefault(ean, product)

    if not dry_run:
        with transaction.atomic():
            ChainProduct.objects.bulk_create(created, batch_size=500)
            fields = [*COMPARED, "chain_ref", "rating", "label_check", "reasons", "rating_version"]
            ChainProduct.objects.bulk_update(changed, fields, batch_size=500)

    discarded = [
        {"code": code, "field": column, "count": len(lines), "lines": lines[:EXAMPLES]}
        for (code, column), lines in sorted(parsed.discarded.items())
    ]
    return {
        "dry_run": dry_run,
        "format": parsed.format,
        "chain": chain,
        "rows": parsed.total,
        "new": len(created),
        "updated": len(changed),
        "unchanged": unchanged,
        "discarded_total": sum(d["count"] for d in discarded),
        "discarded": discarded,
        "ratings": {r: ratings.get(r, 0) for r in product_rating.RATINGS},
        "review": checks.get(product_rating.REVIEW, 0),
        "differences": {"count": diff_count, "examples": diffs},
        "notices": [{"code": c, "count": n} for c, n in sorted(parsed.notices.items())],
        "rule_key": product_rating.RATING_RULE,
    }
