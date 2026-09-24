import pytest
from django.contrib.auth import get_user_model

from profiles.models import UserProfile

User = get_user_model()


@pytest.mark.django_db
def test_creating_user_creates_profile():
    user = User.objects.create_user(email="new@b.com", password="pw-strong-123")
    assert UserProfile.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_creating_superuser_creates_profile():
    """Hoy un superusuario (o un usuario del admin) nunca pasa por email_verify,
    así que sin la señal se queda sin perfil y la API le devuelve 500."""
    user = User.objects.create_superuser(email="admin@b.com", password="pw-strong-123")
    assert UserProfile.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_saving_existing_user_does_not_duplicate_profile():
    user = User.objects.create_user(email="x@b.com", password="pw-strong-123")
    assert UserProfile.objects.filter(user=user).count() == 1
    user.role = User.Role.COACH
    user.save()  # post_save con created=False
    assert UserProfile.objects.filter(user=user).count() == 1
