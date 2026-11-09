"""El catálogo de cadena del usuario en uso (fase 13): compra, coste y sustitutos.

- `product_for(user, generic)`: el producto de la cadena que equivale a un alimento genérico del
  motor (`equivale_a`). Si hay varios, el mejor valorado y, a igualdad, el más barato por kilo.
- `shopping_for(user, items)`: para cada alimento de una lista, su producto, el formato de venta y el
  coste estimado (`gramos / 1000 × precio_kilo`), y el total de lo que tiene precio. Es lo que
  llama la lista de la compra de la fase 12 (función o `POST /coach/chain-products/shopping`).
- `substitutes(user, name, grams)`: sustitutos isocalóricos de un alimento, como hacía ParteDiario:
  la misma energía con un reparto de macros parecido. Los `evitar` se penalizan y van al final.

Lo que se guarda es del usuario y no sale de su cuenta.
"""
from __future__ import annotations

from coach import foods
from coach.text import fold

from . import product_rating
from .chain_import import apply_rating
from .models import ChainProduct

SHOPPING_MAX_ITEMS = 300
SUBSTITUTES_LIMIT = 8
# convention (FightLab): cuánto pesa cada cosa al ordenar sustitutos. La distancia de macros va de
# 0 (mismo reparto de energía entre proteína, hidratos y grasa) a 2 (nada en común). Un `evitar`
# suma más que la peor distancia aceptada, así que solo sale si no hay nada mejor.
MAX_MACRO_DISTANCE = 0.6
PENALTY = {product_rating.AVOID: 1.0, product_rating.FAIR: 0.1, product_rating.NO_DATA: 0.05}
REVIEW_PENALTY = 0.2
MIN_KCAL_PER_100 = 15  # con menos, la ración isocalórica sale absurda (agua, caldo, especias)
MAX_PORTION_G = 800
ROUND_G = 5


def rule_grades() -> dict[str, str]:
    """El grado de evidencia de las reglas de la valoración (para el chip), si el anexo está cargado."""
    from .models import KnowledgeRule

    keys = [product_rating.RATING_RULE, product_rating.FATS_RULE, product_rating.ENERGY_RULE]
    return dict(KnowledgeRule.objects.filter(key__in=keys, retired=False).values_list("key", "grade"))


def refresh(rows) -> list[ChainProduct]:
    """Recalcula y guarda la valoración de los productos valorados con una versión vieja del motor."""
    rows = list(rows)
    stale = [p for p in rows if p.rating_version != product_rating.RATING_VERSION]
    for p in stale:
        apply_rating(p)
    if stale:
        ChainProduct.objects.bulk_update(stale, ["rating", "label_check", "reasons", "rating_version", "per"], batch_size=500)
    return rows


def product_out(p: ChainProduct) -> dict:
    return {
        "id": p.pk,
        "chain": p.chain,
        "chain_ref": p.chain_ref or None,
        "ean": p.ean or None,
        "name": p.name,
        "brand": p.brand,
        "category": p.category,
        "pack": p.pack,
        "price_per_kg": p.price_per_kg,
        "equivalent_of": p.equivalent_of or None,
        "per": p.per,
        **{n: getattr(p, n) for n in (*foods.NUMBERS, "saturates_g", "sugars_g", "salt_g")},
        "nutriscore": p.nutriscore or None,
        "nova": p.nova,
        "rating": p.rating,
        "check": p.label_check or None,
        "reasons": p.reasons,
        "file_rating": p.file_rating or None,
        "rule_key": product_rating.FATS_RULE if any(r.get("code") == "fats_nutriscore_only" for r in p.reasons)
        else product_rating.RATING_RULE,
    }


def catalogue_data(user, query: str = "", rating: str = "", limit: int = 200) -> dict:
    rows = ChainProduct.objects.filter(profile=user.profile)
    total = rows.count()
    counts = {r: 0 for r in product_rating.RATINGS}
    found = refresh(rows)
    review = 0
    for p in found:
        counts[p.rating] = counts.get(p.rating, 0) + 1
        review += p.label_check == product_rating.REVIEW
    words = [fold(w) for w in query.split() if w.strip()]
    if words:
        found = [p for p in found if all(w in fold(f"{p.name} {p.brand} {p.equivalent_of} {p.alias}") for w in words)]
    if rating:
        found = [p for p in found if p.rating == rating]
    return {
        "total": total,
        "chains": sorted({p.chain for p in ChainProduct.objects.filter(profile=user.profile).only("chain")}),
        "ratings": counts,
        "review": review,
        "matched": len(found),
        "products": [product_out(p) for p in found[:limit]],
        "thresholds": product_rating.THRESHOLDS,
        "rule_key": product_rating.RATING_RULE,
        "energy_rule_key": product_rating.ENERGY_RULE,
        "rule_grades": rule_grades(),
    }


def delete_all(user, chain: str | None = None) -> int:
    rows = ChainProduct.objects.filter(profile=user.profile)
    if chain:
        rows = rows.filter(chain=chain)
    deleted, _ = rows.delete()
    return deleted


# ---------------------------------------------------------------- lista de la compra


def _rank(p: ChainProduct) -> tuple:
    price = p.price_per_kg if p.price_per_kg is not None else float("inf")
    return (product_rating.RATING_ORDER.get(p.rating, 9), p.label_check == product_rating.REVIEW, price, p.name)


def _generic_keys(name: str) -> set[str]:
    """El nombre tal cual y, si es un alimento del motor, su nombre en el otro idioma."""
    keys = {fold(name)}
    from .menus import _engine_table  # import tardío: `menus` carga el motor entero

    food = foods.find(name, list(_engine_table(None)))
    if food is not None:
        keys |= {fold(food.name_es), fold(food.name_en)}
    return keys - {""}


def product_for(user, generic: str, chain: str | None = None) -> ChainProduct | None:
    rows = ChainProduct.objects.filter(profile=user.profile, equivalent_key__in=_generic_keys(generic))
    if chain:
        rows = rows.filter(chain=chain)
    rows = [p for p in refresh(rows) if p.rating != product_rating.NOT_FOOD]
    return min(rows, key=_rank, default=None)


def _cost(grams: float | None, p: ChainProduct | None) -> float | None:
    if p is None or p.price_per_kg is None or grams is None:
        return None
    return round(grams / 1000 * p.price_per_kg, 2)


def shopping_for(user, items: list[dict], chain: str | None = None) -> dict:
    """`items`: `[{"name": alimento genérico, "grams": cantidad (g o ml)}]`."""
    rows = list(ChainProduct.objects.filter(profile=user.profile).exclude(equivalent_key=""))
    if chain:
        rows = [p for p in rows if p.chain == chain]
    refresh(rows)
    by_key: dict[str, list[ChainProduct]] = {}
    for p in rows:
        if p.rating != product_rating.NOT_FOOD:
            by_key.setdefault(p.equivalent_key, []).append(p)
    out, total, priced = [], 0.0, 0
    for item in items[:SHOPPING_MAX_ITEMS]:
        name = str(item.get("name") or "").strip()
        grams = item.get("grams")
        grams = float(grams) if isinstance(grams, (int, float)) and grams >= 0 else None
        candidates = [p for k in _generic_keys(name) for p in by_key.get(k, [])] if name else []
        product = min(candidates, key=_rank, default=None)
        cost = _cost(grams, product)
        if cost is not None:
            total += cost
            priced += 1
        out.append({
            "name": name,
            "grams": grams,
            "product": None if product is None else {
                "id": product.pk, "chain": product.chain, "name": product.name, "pack": product.pack,
                "price_per_kg": product.price_per_kg, "rating": product.rating, "check": product.label_check or None,
            },
            "cost_eur": cost,
        })
    return {"items": out, "total_eur": round(total, 2) if priced else None, "priced": priced,
            "unpriced": len(out) - priced}


# ---------------------------------------------------------------- sustitutos isocalóricos


def _shares(kcal_p: float, kcal_c: float, kcal_f: float) -> tuple[float, float, float] | None:
    total = kcal_p + kcal_c + kcal_f
    if total <= 0:
        return None
    return kcal_p / total, kcal_c / total, kcal_f / total


def _macro_shares(protein, carbs, fat) -> tuple[float, float, float] | None:
    if None in (protein, carbs, fat):
        return None
    return _shares(4 * protein, 4 * carbs, 9 * fat)


def _distance(a, b) -> float:
    return sum(abs(x - y) for x, y in zip(a, b))


def _candidates(user, lang: str) -> list[dict]:
    from .menus import menu_table
    from .products import catalogue_rating

    out = []
    for f in menu_table(user):
        out.append({"key": f"food:{fold(f.name_es)}", "name": f.name_en if lang == "en" else f.name_es,
                    "names": {fold(f.name_es), fold(f.name_en), f.barcode} - {""},
                    "kind": "product" if f.barcode else "food", "chain": f.chain or None, "pack": None,
                    "kcal": f.kcal, "protein_g": f.protein_g, "carbs_g": f.carbs_g, "fat_g": f.fat_g,
                    "rating": None, "check": None, "barcode": f.barcode or None})
    # Los productos de OFF guardados se valoran con el mismo motor.
    from .models import CatalogueProduct

    ratings = {p.barcode: catalogue_rating(p) for p in CatalogueProduct.objects.filter(profile=user.profile)}
    for c in out:
        if c["barcode"] in ratings:
            c["rating"], c["check"] = ratings[c["barcode"]].rating, ratings[c["barcode"]].check or None
    for p in refresh(ChainProduct.objects.filter(profile=user.profile)):
        out.append({"key": f"chain:{p.pk}", "name": p.name, "names": {fold(p.name), fold(p.alias)} - {""},
                    "kind": "chain", "chain": p.chain, "pack": p.pack or None, "kcal": p.kcal,
                    "protein_g": p.protein_g, "carbs_g": p.carbs_g, "fat_g": p.fat_g,
                    "rating": p.rating, "check": p.label_check or None, "barcode": p.ean or None, "id": p.pk})
    return out


def substitutes(user, name: str, grams: float, lang: str = "es", limit: int = SUBSTITUTES_LIMIT) -> dict | None:
    """Alternativas con las mismas kcal que `grams` de `name`. None si no se conoce el alimento."""
    wanted = fold(name)
    candidates = _candidates(user, lang)
    base = next((c for c in candidates if wanted in c["names"]), None)
    if base is None or not base["kcal"]:
        return None
    target_kcal = base["kcal"] * grams / 100
    base_shares = _macro_shares(base["protein_g"], base["carbs_g"], base["fat_g"])
    if base_shares is None:
        return None
    scored = []
    for c in candidates:
        if c is base or wanted in c["names"] or c["rating"] == product_rating.NOT_FOOD:
            continue
        if not c["kcal"] or c["kcal"] < MIN_KCAL_PER_100:
            continue
        shares = _macro_shares(c["protein_g"], c["carbs_g"], c["fat_g"])
        if shares is None:
            continue
        distance = _distance(base_shares, shares)
        if distance > MAX_MACRO_DISTANCE:
            continue
        portion = round(target_kcal / c["kcal"] * 100 / ROUND_G) * ROUND_G
        if portion <= 0 or portion > MAX_PORTION_G:
            continue
        penalty = PENALTY.get(c["rating"], 0) + (REVIEW_PENALTY if c["check"] == product_rating.REVIEW else 0)
        factor = portion / 100
        scored.append((distance + penalty, c["name"], {
            "name": c["name"], "kind": c["kind"], "chain": c["chain"], "pack": c["pack"], "barcode": c["barcode"],
            "grams": portion,
            "kcal": round(c["kcal"] * factor),
            "protein_g": round(c["protein_g"] * factor, 1),
            "carbs_g": round(c["carbs_g"] * factor, 1),
            "fat_g": round(c["fat_g"] * factor, 1),
            "rating": c["rating"], "check": c["check"],
            "penalised": c["rating"] == product_rating.AVOID,
            "distance": round(distance, 2),
        }))
    scored.sort(key=lambda s: (s[0], s[1]))
    return {
        "food": {"name": base["name"], "grams": grams, "kcal": round(target_kcal), "rating": base["rating"]},
        "substitutes": [s[2] for s in scored[:limit]],
        "rule_key": product_rating.RATING_RULE,
        "rule_grades": rule_grades(),
    }
