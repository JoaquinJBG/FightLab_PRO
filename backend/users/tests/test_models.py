import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.mark.django_db
def test_create_user_with_email_and_no_username():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    assert user.email == "a@b.com"
    assert user.check_password("pw-strong-123")
    assert user.username is None
    assert user.role == User.Role.ATHLETE
    assert user.is_email_verified is False
    assert user.is_active is True  # manager default; registration sets it False


@pytest.mark.django_db
def test_create_user_requires_email():
    with pytest.raises(ValueError):
        User.objects.create_user(email="", password="pw-strong-123")


@pytest.mark.django_db
def test_email_is_unique():
    User.objects.create_user(email="dup@b.com", password="pw-strong-123")
    with pytest.raises(Exception):
        User.objects.create_user(email="dup@b.com", password="pw-strong-456")


@pytest.mark.django_db
def test_create_superuser():
    admin = User.objects.create_superuser(email="admin@b.com", password="pw-strong-123")
    assert admin.is_staff is True
    assert admin.is_superuser is True
