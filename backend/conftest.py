import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _reset_throttle_cache_between_tests():
    """DRF guarda los contadores de throttle (login, register, password-reset,
    activities-sync, ...) en la cache de Django. Toda la suite corre en un
    único proceso: sin este reset, un test de un paquete puede agotar el
    contador de otro que ni siquiera lo toca (p. ej. muchos tests de otras
    apps hacen login de fondo para autenticar su cliente). Se limpia antes
    y después de cada test para no dejar restos entre archivos."""
    cache.clear()
    yield
    cache.clear()
