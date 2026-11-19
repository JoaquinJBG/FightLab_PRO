import importlib

import pytest
from django.apps import apps as django_apps
from django.contrib.auth import get_user_model

from profiles.models import UserProfile

User = get_user_model()

# El archivo de la migración de datos vive en profiles/ (es la app dueña del
# modelo UserProfile), pero es del paquete B (identidad y cuentas): backfill
# de los usuarios que ya existieran sin perfil antes de que la señal
# post_save de users.signals empezara a crearlo siempre.
backfill = importlib.import_module("profiles.migrations.0006_backfill_profiles")


@pytest.mark.django_db
def test_backfill_creates_missing_profiles():
    user = User.objects.create_user(email="legacy@b.com", password="pw-strong-123")
    UserProfile.objects.filter(user=user).delete()  # simula un usuario ya existente sin perfil
    assert not UserProfile.objects.filter(user=user).exists()

    backfill.backfill_profiles(django_apps, None)

    assert UserProfile.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_backfill_is_idempotent_for_users_with_profile():
    user = User.objects.create_user(email="ok@b.com", password="pw-strong-123")
    assert UserProfile.objects.filter(user=user).count() == 1

    backfill.backfill_profiles(django_apps, None)

    assert UserProfile.objects.filter(user=user).count() == 1
