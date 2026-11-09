"""Alimentos y productos del súper para los menús (Tasks 8.1 y 8.3).

- `search_foods`: la búsqueda de `coach foods search` (cada palabra empieza una palabra del
  nombre, sin tildes ni mayúsculas) sobre la tabla del motor, los productos de la región y el
  catálogo del usuario, con el nombre en su idioma (la tabla trae inglés y español).
- `add_product`: `coach products add` contra la BD: lee el producto de Open Food Facts por el
  proxy, con las mismas comprobaciones de la CLI (nombre, por 100 g o 100 ml, nombre repetido) y
  lo guarda `unverified` con su URL de OFF (ODbL).
"""
from __future__ import annotations

import re
from datetime import date

from coach import catalogue, foods
from coach.text import fold

from . import off_proxy, product_rating
from .menus import MenuInvalid, menu_table, product_food
from .models import CatalogueProduct

SEARCH_LIMIT = 30


def _hit(words: list[str], *names: str) -> bool:
    found = re.findall(r"\w+", fold(" ".join(n for n in names if n)))
    return all(any(f.startswith(w) for f in found) for w in words)


def food_out(food: foods.Food, lang: str) -> dict:
    product = bool(food.barcode) or food.source.startswith("label:")
    return {
        "name": food.name_en if lang == "en" else food.name_es,
        "name_es": food.name_es,
        "name_en": food.name_en,
        "per": food.per,
        **{n: getattr(food, n) for n in foods.NUMBERS},
        "missing": food.missing(),
        "source": food.source,
        "kind": "product" if product else "food",
        "barcode": food.barcode or None,
        "chain": food.chain or None,
        "url": food.source_id if product else None,
        "unverified": food.source == catalogue.SOURCE,
    }


def search_foods(user, query: str, lang: str) -> list[dict]:
    words = [fold(w) for w in query.split() if w.strip()]
    if not words:
        return []
    return [
        food_out(f, lang) for f in menu_table(user)
        if _hit(words, f.name_en, f.name_es, f.chain, f.barcode)
    ][:SEARCH_LIMIT]


def product_data(p: CatalogueProduct) -> dict:
    return {
        "barcode": p.barcode, "product_name": p.product_name, "brand": p.brand, "chain": p.chain, "per": p.per,
        **{n: getattr(p, n) for n in foods.NUMBERS},
        "missing": [n for n in foods.NUMBERS if getattr(p, n) is None],
        "allergens": p.allergens, "url": p.url, "fetched_on": p.fetched_on.isoformat(), "source": p.source,
        "unverified": p.unverified,
        "rating": catalogue_rating(p).as_dict(),
    }


def catalogue_rating(p: CatalogueProduct) -> product_rating.Rating:
    """La valoración de un producto de OFF guardado (fase 13), con el mismo motor que la cadena."""
    return product_rating.rate(product_rating.Inputs(
        name=p.product_name, **{n: getattr(p, n) for n in foods.NUMBERS},
        saturates_g=p.saturates_g, sugars_g=p.sugars_g, salt_g=p.salt_g, nutriscore=p.nutriscore,
        off_tags=tuple(p.off_tags or ()), drink=True if p.per == "100 ml" else None,
    ))


def found_rating(found: dict) -> dict:
    """La valoración de un producto tal como lo devuelve el proxy (búsqueda o lectura)."""
    extra = found.get("extra") or {}
    values = found.get("values") or {}
    return product_rating.rate(product_rating.Inputs(
        name=found.get("name") or "", **{n: values.get(n) for n in foods.NUMBERS},
        saturates_g=extra.get("saturates_g"), sugars_g=extra.get("sugars_g"), salt_g=extra.get("salt_g"),
        nutriscore=extra.get("nutriscore") or "", off_tags=tuple(extra.get("off_tags") or ()),
        drink=True if found.get("per") == "100 ml" else None,
    )).as_dict()


def _extra(found: dict) -> dict:
    extra = found.get("extra") or {}
    return {
        "saturates_g": extra.get("saturates_g"), "sugars_g": extra.get("sugars_g"), "salt_g": extra.get("salt_g"),
        "nutriscore": extra.get("nutriscore") or "", "off_tags": list(extra.get("off_tags") or []),
    }


def add_product(user, barcode: str, today: date, chain: str = "", name: str = "", per: str | None = None,
                confirm_per: bool = False) -> tuple[CatalogueProduct, list[str]]:
    """Guarda (o refresca) un producto de OFF en el catálogo. Devuelve el producto y avisos."""
    found = off_proxy.product(barcode)
    if found is None:
        raise MenuInvalid("off_not_found")
    name = " ".join((name or found["name"] or "").split())
    if not name:
        raise MenuInvalid("name_needed")
    if per and found["per"] and per != found["per"] and not confirm_per:
        raise MenuInvalid("per_mismatch", found["per"])
    per = per or found["per"]
    if per is None:
        raise MenuInvalid("per_needed")
    others = [f for f in menu_table(user) if f.barcode != barcode]
    if foods.find(name, others) is not None:
        raise MenuInvalid("name_taken")
    product, _ = CatalogueProduct.objects.update_or_create(
        profile=user.profile,
        barcode=barcode,
        defaults={
            "product_name": name[:200],
            "brand": (found["brand"] or "")[:200],
            "chain": " ".join(chain.split())[:80],
            "per": per,
            **found["values"],
            **_extra(found),
            "allergens": found["allergens"],
            "url": found["url"],
            "fetched_on": today,
            "source": catalogue.SOURCE,
            "unverified": True,
        },
    )
    warnings = []
    if None not in (product.kcal, product.protein_g, product.carbs_g, product.fat_g):
        # Como `coach products add`: la energía de la etiqueta lejos de 4/4/9 es un aviso.
        if foods.energy_exception({n: getattr(product, n) for n in foods.NUMBERS}):
            warnings.append("kcal_gap")
    return product, warnings
