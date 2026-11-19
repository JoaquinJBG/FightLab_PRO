"""Una variable opcional mal puesta no tumba el arranque (fix G1-7): se registra el error y esa
función queda apagada. Se comprueba en un subproceso (settings.py se ejecuta una vez por proceso)."""
import secrets
import sys

import pytest

from .test_settings_security import _run

PROBE = (
    "import django; django.setup(); from django.conf import settings as s; "
    "from notifications.push import configured as push_configured; from tickets.storage import get_storage; "
    "print('push', push_configured()); print('r2', get_storage() is not None); "
    "print('seconds', s.R2_SIGNED_URL_SECONDS)"
)
R2 = {"R2_ACCOUNT_ID": "acc", "R2_ACCESS_KEY_ID": "key", "R2_SECRET_ACCESS_KEY": "secret", "R2_BUCKET": "bucket"}
VAPID = {"VAPID_PUBLIC_KEY": "pub", "VAPID_PRIVATE_KEY": "priv"}


def boot(**extra):
    env = {
        "DJANGO_SETTINGS_MODULE": "core.settings",
        "ENV_FILE": "/nonexistent",
        "DEBUG": "False",
        "SECRET_KEY": secrets.token_urlsafe(50),
        "ALLOWED_HOSTS": "example.com",
        "DATABASE_URL": "postgres://u:p@localhost:5432/db",
        "TICKETS_STORAGE": "r2",
        "BFF_SHARED_SECRET": "x" * 40,
        **extra,
    }
    return _run(env, [sys.executable, "-c", PROBE])


def test_a_bad_vapid_subject_logs_and_turns_push_off():
    result = boot(**VAPID, VAPID_SUBJECT="persona@example.com")
    assert result.returncode == 0, result.stderr
    assert "push False" in result.stdout
    assert "VAPID_SUBJECT" in result.stderr


def test_a_good_vapid_subject_keeps_push_on():
    result = boot(**VAPID, VAPID_SUBJECT="https://fightlab.example")
    assert result.returncode == 0, result.stderr
    assert "push True" in result.stdout


@pytest.mark.parametrize("seconds", ["5", "99999", "diez"])
def test_bad_r2_signed_url_seconds_logs_and_turns_uploads_off(seconds):
    result = boot(**R2, R2_SIGNED_URL_SECONDS=seconds)
    assert result.returncode == 0, result.stderr
    assert "r2 False" in result.stdout
    assert "R2_SIGNED_URL_SECONDS" in result.stderr


def test_good_r2_settings_keep_uploads_on():
    result = boot(**R2, R2_SIGNED_URL_SECONDS="900")
    assert result.returncode == 0, result.stderr
    assert "r2 True" in result.stdout and "seconds 900" in result.stdout
