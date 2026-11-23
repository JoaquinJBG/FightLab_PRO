"""Escáner de código de barras: qué producto es un código (EAN-13, EAN-8, UPC-A o UPC-E).

Se busca en este orden y se para en el primero que lo tiene:

1. El catálogo de cadena privado del usuario (`ChainProduct` por EAN, fase 13).
2. Sus productos guardados (`CatalogueProduct`): los de Open Food Facts y los creados a mano.
3. Open Food Facts por el proxy de la fase 8 (`off_proxy.product`). La caché del proxy guarda
   también los "no encontrado", así que un código ya preguntado no se vuelve a pedir a OFF
   mientras valga la caché. Sin contacto configurado, OFF no se llama nunca.

Un UPC-A (12 cifras) es el EAN-13 con un 0 delante, y un GTIN-14 que empieza por 0 es el EAN-13
sin él: `variants` prueba esas formas en lo del usuario. El UPC-E (8 cifras) se expande a UPC-A en
la app, que es quien sabe el formato que leyó la cámara.

Un producto creado a mano (`create_manual`) se guarda como `CatalogueProduct` con
`source = MANUAL_SOURCE`: es del usuario, sale en la búsqueda de alimentos de Nutrición y en los
menús, y al volver a escanear el código se encuentra sin preguntar a nadie.
"""
from __future__ import annotations

from datetime import date

from coach import foods

from . import chain_catalogue, off_proxy, products
from .menus import MenuInvalid, menu_table
from .models import CatalogueProduct, ChainProduct

MANUAL_SOURCE = "manual"
SOURCES = ("chain", "catalogue", "manual", "off")


def variants(code: str) -> list[str]:
    """El código tal cual y sus formas equivalentes (UPC-A ↔ EAN-13, GTIN-14 → EAN-13)."""
    out = [code]
    if len(code) == 12:
        out.append("0" + code)
    trimmed = code
    while len(trimmed) > 12 and trimmed.startswith("0"):
        trimmed = trimmed[1:]
        out.append(trimmed)
    return list(dict.fromkeys(out))


def _values(source) -> dict:
    return {n: getattr(source, n) for n in foods.NUMBERS}


def _rating(r: dict) -> dict:
    return {"rating": r["rating"], "check": r.get("check") or "", "nutriscore": r.get("nutriscore") or None,
            "rule_key": r["rule_key"]}


def _out(**fields) -> dict:
    values = fields.pop("values")
    return {
        **fields,
        **values,
        "missing": [n for n in foods.NUMBERS if values.get(n) is None],
    }


def chain_out(p: ChainProduct) -> dict:
    chain_catalogue.refresh([p])
    rule = chain_catalogue.product_out(p)["rule_key"]
    return _out(
        barcode=p.ean, name=p.name, brand=p.brand or None, chain=p.chain, pack=p.pack or None,
        pack_g=chain_catalogue.pack_grams(p.pack) if p.pack else None, serving_g=None, per=p.per,
        values=_values(p), url=None, unverified=False,
        rating={"rating": p.rating, "check": p.label_check or "", "nutriscore": p.nutriscore or None, "rule_key": rule},
    )


def catalogue_out(p: CatalogueProduct) -> dict:
    return _out(
        barcode=p.barcode, name=p.product_name, brand=p.brand or None, chain=p.chain or None, pack=None,
        pack_g=None, serving_g=None, per=p.per, values=_values(p), url=p.url or None, unverified=p.unverified,
        rating=_rating(products.catalogue_rating(p).as_dict()),
    )


def off_out(found: dict) -> dict:
    values = found.get("values") or {}
    return _out(
        barcode=found["barcode"], name=found.get("name") or None, brand=found.get("brand") or None,
        chain=None, pack=None, pack_g=None, serving_g=found.get("serving_g"), per=found.get("per") or "100 g",
        values={n: values.get(n) for n in foods.NUMBERS}, url=found.get("url"), unverified=True,
        rating=_rating(products.found_rating(found)),
    )


def find_private(user, code: str) -> tuple[str, dict] | None:
    """El producto en lo del usuario (cadena y luego guardados), sin salir de la BD."""
    codes = variants(code)
    chain = ChainProduct.objects.filter(profile=user.profile, ean__in=codes)
    for c in codes:  # el código exacto primero
        hit = next((p for p in chain if p.ean == c), None)
        if hit:
            return "chain", chain_out(hit)
    saved = CatalogueProduct.objects.filter(profile=user.profile, barcode__in=codes)
    for c in codes:
        hit = next((p for p in saved if p.barcode == c), None)
        if hit:
            return ("manual" if hit.source == MANUAL_SOURCE else "catalogue"), catalogue_out(hit)
    return None


def lookup(user, code: str) -> tuple[str, dict] | None:
    """`(fuente, producto)` o `None` si nadie lo tiene. Lanza `off_proxy.OffError` si OFF no
    contesta (o no está configurado) y el código no está en lo del usuario."""
    found = find_private(user, code)
    if found:
        return found
    off = off_proxy.product(code)
    return ("off", off_out(off)) if off else None


def create_manual(user, code: str, data: dict, today: date) -> tuple[CatalogueProduct, list[str]]:
    """Crea (o edita, si ya era suyo y a mano) el producto de ese código con los valores de la
    etiqueta. No pisa un producto de la cadena ni uno guardado de OFF."""
    codes = variants(code)
    if ChainProduct.objects.filter(profile=user.profile, ean__in=codes).exists():
        raise MenuInvalid("barcode_taken")
    existing = CatalogueProduct.objects.filter(profile=user.profile, barcode__in=codes).first()
    if existing and existing.source != MANUAL_SOURCE:
        raise MenuInvalid("barcode_taken")
    name = " ".join(data["name"].split())
    others = [f for f in menu_table(user) if f.barcode not in codes]
    if foods.find(name, others) is not None:
        raise MenuInvalid("name_taken")
    fields = {
        "product_name": name[:200],
        "brand": " ".join((data.get("brand") or "").split())[:200],
        "chain": " ".join((data.get("chain") or "").split())[:80],
        "per": data["per"],
        **{n: data.get(n) for n in (*foods.NUMBERS, "saturates_g", "sugars_g", "salt_g")},
        "url": "",
        "fetched_on": today,
        "source": MANUAL_SOURCE,
        "unverified": False,
    }
    product, _ = CatalogueProduct.objects.update_or_create(
        profile=user.profile, barcode=existing.barcode if existing else code, defaults=fields,
    )
    warnings = []
    if None not in (product.kcal, product.protein_g, product.carbs_g, product.fat_g):
        if foods.energy_exception(_values(product)):
            warnings.append("kcal_gap")
    return product, warnings

