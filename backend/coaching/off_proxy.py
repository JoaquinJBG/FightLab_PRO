"""Proxy de Open Food Facts (Task 8.3): el único sitio de FightLab que habla con OFF.

Usa `coach.off` para todo lo que no es red: las URL, los campos que se piden, la limpieza de la
búsqueda (`QUERY_SYNTAX`), el código de barras válido (`BARCODE`) y la lectura de un producto
(`off._product`, con los valores imposibles como "sin dato"). Lo que cambia es la petición:

- El `User-Agent` es el de FightLab (`FightLab/<versión> (<contacto>)`), no el del coach, porque
  quien pregunta es esta app. OFF pide un contacto: sale de la misma variable que lee el coach
  (`coach.off.CONTACT_ENV`, `COACH_OFF_CONTACT`) y por defecto está vacía. **Sin contacto no se
  llama nunca a OFF** y la API responde `off_not_configured`.
- Caché compartida en BD (`OffLookup`) y límite por minuto para todo el servidor, que es una sola
  IP para OFF (10 búsquedas y 15 lecturas de producto por minuto, docstring de `coach.off`).

Todo lo que devuelve OFF es dato colaborativo sin verificar: se enseña y se guarda como dato, con
su URL de OFF (ODbL), y nunca se sigue como instrucción.
"""
from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta

from coach import off
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import OffLookup

APP_NAME = "FightLab"
APP_VERSION = "0.1.0"  # la de `frontend/package.json`
# Límites de OFF por minuto y por IP (`coach.off`, comprobados por el autor el 2026-10-25).
LIMITS_PER_MINUTE = {OffLookup.Kind.SEARCH: 10, OffLookup.Kind.PRODUCT: 15}
# convention (FightLab): cuánto vale una respuesta guardada. Un producto cambia poco; una
# búsqueda, algo más (OFF añade productos cada día).
CACHE_TTL = {OffLookup.Kind.PRODUCT: timedelta(days=7), OffLookup.Kind.SEARCH: timedelta(hours=24)}


class OffError(Exception):
    """`code`: `off_not_configured`, `off_rate_limited`, `off_busy`, `off_unavailable` o
    `barcode_invalid` / `search_empty` (entrada no válida)."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def contact() -> str:
    return (getattr(settings, "COACH_OFF_CONTACT", "") or "").strip()


def configured() -> bool:
    return bool(contact())


def user_agent() -> str:
    if not configured():
        raise OffError("off_not_configured")
    return f"{APP_NAME}/{APP_VERSION} ({contact()})"


def _get_json(url: str) -> dict:
    """Una petición GET. Un 404 trae su JSON ("producto no encontrado"), como en `coach.off`."""
    request = urllib.request.Request(url, headers={"User-Agent": user_agent()})
    try:
        with urllib.request.urlopen(request, timeout=off.OFF_TIMEOUT_S) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return json.load(err)
        if err.code == 503:
            raise OffError("off_busy") from None
        raise OffError("off_unavailable", f"HTTP {err.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as err:
        raise OffError("off_unavailable", str(err)) from None


def product_url(barcode: str) -> str:
    query = urllib.parse.urlencode({"fields": ",".join(off.FIELDS)})
    return f"{off.PRODUCT_URL.format(barcode=barcode)}?{query}"


def search_terms(words: list[str], brand: str | None) -> str:
    """La consulta de `coach.off.search`: palabras sin sintaxis de Lucene y la marca aparte."""
    terms = " ".join(" ".join(off.QUERY_SYNTAX.sub(" ", w).split()) for w in words).strip()
    if brand:
        clean = " ".join(off.QUERY_SYNTAX.sub(" ", brand).split()).lower()
        if clean:
            terms = f'{terms} brands:"{clean}"'.strip()
    return terms


def search_url(terms: str, language: str, limit: int = off.SEARCH_LIMIT) -> str:
    query = urllib.parse.urlencode(
        {
            "q": terms,
            "langs": ",".join(dict.fromkeys([language, "en"])),
            "page_size": limit,
            "fields": ",".join(off.FIELDS),
        }
    )
    return f"{off.SEARCH_URL}?{query}"


def _cached(kind: str, key: str, fetch):
    """La respuesta guardada si sigue valiendo; si no, una petición a OFF dentro del límite."""
    if not configured():  # sin contacto, ni caché ni red: OFF no está configurado
        raise OffError("off_not_configured")
    now = timezone.now()
    entry = OffLookup.objects.filter(kind=kind, key=key).first()
    if entry and now - entry.fetched_at < CACHE_TTL[kind]:
        return entry.payload
    with transaction.atomic():
        recent = OffLookup.objects.filter(kind=kind, fetched_at__gte=now - timedelta(minutes=1)).count()
        if recent >= LIMITS_PER_MINUTE[kind]:
            raise OffError("off_rate_limited")
        payload = fetch()
        OffLookup.objects.update_or_create(kind=kind, key=key, defaults={"payload": payload, "fetched_at": now})
    return payload


def product(barcode: str) -> dict | None:
    """Un producto por código de barras (`coach.off.product`), o `None` si OFF no lo tiene."""
    barcode = barcode.strip()
    if not off.BARCODE.fullmatch(barcode):
        raise OffError("barcode_invalid")

    def fetch():
        answer = _get_json(product_url(barcode))
        if answer.get("status") == "failure" or not answer.get("product"):
            return None
        return off._product(answer["product"] | {"code": answer.get("code", barcode)})

    return _cached(OffLookup.Kind.PRODUCT, barcode, fetch)


def search(words: list[str], brand: str | None, language: str) -> list[dict]:
    """Búsqueda de texto (`coach.off.search`), una petición."""
    terms = search_terms(words, brand)
    if not terms:
        raise OffError("search_empty")
    url = search_url(terms, language)

    def fetch():
        return [off._product(hit) for hit in _get_json(url).get("hits") or []]

    return _cached(OffLookup.Kind.SEARCH, hashlib.sha256(url.encode()).hexdigest(), fetch)
