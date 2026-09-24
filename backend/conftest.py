import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _reset_throttle_cache_between_tests(settings):
    """DRF guarda los contadores de throttle (login, register, password-reset,
    activities-sync, ...) en la cache de Django. Toda la suite corre en un
    único proceso: sin este reset, un test de un paquete puede agotar el
    contador de otro que ni siquiera lo toca (p. ej. muchos tests de otras
    apps hacen login de fondo para autenticar su cliente). Se limpia antes
    y después de cada test para no dejar restos entre archivos.

    En producción la caché es DatabaseCache (compartida entre workers); en
    tests se usa LocMem para que los tests sin acceso a BD no fallen al
    limpiarla."""
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    cache.clear()
    yield
    cache.clear()
