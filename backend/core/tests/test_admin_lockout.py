import pytest
from django.core.cache import cache
from django.test import Client
from django.urls import clear_url_caches, reverse

from users.models import CustomUser


@pytest.fixture(autouse=True)
def _clean_cache(settings):
    cache.clear()
    # El manifest de whitenoise no existe en tests y el login renderiza estáticos.
    settings.STORAGES = {
        **settings.STORAGES,
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }


@pytest.fixture
def staff(db):
    return CustomUser.objects.create_superuser(email="root@example.com", password="pw-strong-123")


def _post(client, password, **extra):
    return client.post(
        reverse("admin:login"), {"username": "root@example.com", "password": password, "next": "/admin/"}, **extra
    )


def test_admin_locks_out_after_max_failures(staff, settings):
    settings.ADMIN_LOGIN_MAX_FAILURES = 3
    client = Client()
    for _ in range(3):
        assert _post(client, "wrong").status_code == 200
    # Con el bloqueo activo, ni siquiera la contraseña correcta entra.
    assert _post(client, "pw-strong-123").status_code == 429


def test_admin_lockout_cannot_be_dodged_by_rotating_xff(staff, settings):
    settings.ADMIN_LOGIN_MAX_FAILURES = 3
    client = Client()
    for i in range(3):
        _post(client, "wrong", HTTP_X_FORWARDED_FOR=f"6.6.6.{i}, 10.0.0.1")
    resp = _post(client, "wrong", HTTP_X_FORWARDED_FOR="7.7.7.7, 10.0.0.1")
    assert resp.status_code == 429


def test_admin_successful_login_resets_counter(staff, settings):
    settings.ADMIN_LOGIN_MAX_FAILURES = 3
    client = Client()
    _post(client, "wrong")
    _post(client, "wrong")
    assert _post(client, "pw-strong-123").status_code == 302
    client = Client()
    _post(client, "wrong")
    _post(client, "wrong")
    assert _post(client, "wrong").status_code == 200


def test_admin_not_mounted_without_admin_url():
    import importlib
    import sys

    from django.conf import settings

    original = settings.ADMIN_URL
    settings.ADMIN_URL = ""
    try:
        clear_url_caches()
        sys.modules.pop("core.urls", None)
        urls = importlib.import_module("core.urls")
        assert not any("admin" in str(p.pattern) for p in urls.urlpatterns)
    finally:
        settings.ADMIN_URL = original
        clear_url_caches()
        sys.modules.pop("core.urls", None)
