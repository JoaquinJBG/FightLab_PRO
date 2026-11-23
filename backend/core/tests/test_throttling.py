"""Comprueba que NUM_PROXIES está conectado de verdad al throttling de DRF.

DRF solo lee NUM_PROXIES dentro de REST_FRAMEWORK (rest_framework.settings.
api_settings.NUM_PROXIES); un NUM_PROXIES a nivel de módulo de Django no hace
nada, y sin él SimpleRateThrottle.get_ident() usa la cabecera
X-Forwarded-For entera como clave, que el cliente controla por completo.
"""
from django.conf import settings
from django.test import RequestFactory, override_settings
from rest_framework.request import Request
from rest_framework.throttling import UserRateThrottle


def _request_con_xff(xff):
    django_request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR=xff)
    return Request(django_request)


def test_num_proxies_vive_dentro_de_rest_framework():
    """El único NUM_PROXIES válido es el que lee DRF (api_settings)."""
    assert not hasattr(settings, "NUM_PROXIES"), (
        "NUM_PROXIES no debe existir como setting de nivel superior: "
        "DRF no lo lee de ahí y la línea no tendría ningún efecto"
    )
    assert "NUM_PROXIES" in settings.REST_FRAMEWORK
    from rest_framework.settings import api_settings

    assert api_settings.NUM_PROXIES == settings.REST_FRAMEWORK["NUM_PROXIES"]


@override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 2})
def test_get_ident_ignora_lo_que_el_cliente_antepone_al_x_forwarded_for():
    """Con NUM_PROXIES=2 (BFF de Next + borde de Render delante de gunicorn),
    la clave de throttling es la posición fija de la cadena de proxies
    (BFF, luego lo que añade Render), no la cabecera entera. Dos peticiones
    con cabeceras distintas pero el mismo último salto real deben compartir
    clave, aunque el cliente rellene por delante lo que quiera.
    """
    throttle = UserRateThrottle()
    peticion_a = _request_con_xff("1.2.3.4, 10.0.0.9, 10.0.0.5")
    peticion_b = _request_con_xff("9.9.9.9, 8.8.8.8, 10.0.0.9, 10.0.0.5")

    ident_a = throttle.get_ident(peticion_a)
    ident_b = throttle.get_ident(peticion_b)

    assert ident_a == ident_b == "10.0.0.9"


@override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": None})
def test_sin_num_proxies_la_cabecera_entera_es_la_clave_vulnerable():
    """Documenta el fallo que se corrige: con NUM_PROXIES=None (el defecto de
    DRF, lo que pasaba antes al ponerlo fuera de REST_FRAMEWORK) cualquier
    cliente puede cambiar de clave de throttling en cada petición con solo
    variar el valor de X-Forwarded-For que manda.
    """
    throttle = UserRateThrottle()
    peticion_a = _request_con_xff("1.2.3.4, 10.0.0.9, 10.0.0.5")
    peticion_b = _request_con_xff("9.9.9.9, 8.8.8.8, 10.0.0.9, 10.0.0.5")

    assert throttle.get_ident(peticion_a) != throttle.get_ident(peticion_b)
