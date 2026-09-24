import pytest
from django.contrib.auth import get_user_model
from django.core import mail

from users.services import user_create, email_verify, verification_resend
from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.mark.django_db
def test_user_create_makes_inactive_user_and_sends_email(django_capture_on_commit_callbacks):
    # El envío va en transaction.on_commit (bug crítico de email): sin
    # capturar los callbacks de on_commit, mail.outbox seguiría vacío aquí
    # porque el test envuelve todo en una transacción que nunca hace commit.
    with django_capture_on_commit_callbacks(execute=True):
        user = user_create(email="a@b.com", password="pw-strong-123")
    assert user.is_active is False
    assert user.is_email_verified is False
    assert len(mail.outbox) == 1
    assert "a@b.com" in mail.outbox[0].to


@pytest.mark.django_db
def test_user_create_keeps_original_password_on_reregister_of_unverified_account(
    django_capture_on_commit_callbacks,
):
    """Bug major (re-registro): un segundo registro del email sin verificar
    reenvía el enlace pero NO toca la contraseña ya guardada, para que el
    usuario legítimo (el caso más común: pulsó "Crear cuenta" dos veces) no
    se quede sin poder entrar tras verificar."""
    with django_capture_on_commit_callbacks(execute=True):
        user_create(email="a@b.com", password="pw-strong-123")  # sin verificar
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        again = user_create(email="a@b.com", password="pw-strong-456")
    assert again.email == "a@b.com"
    # La contraseña que queda activa es la del PRIMER intento; la del
    # segundo intento (no autenticado como el dueño real del email) se
    # ignora.
    assert again.has_usable_password()
    assert again.check_password("pw-strong-123")
    assert not again.check_password("pw-strong-456")
    assert len(mail.outbox) == 1  # reenvía el enlace


@pytest.mark.django_db
def test_user_create_does_not_roll_back_when_email_backend_fails(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Bug crítico de email: un fallo al enviar el email de verificación NO
    debe deshacer el alta del usuario (antes de este fix, send_mail se
    llamaba dentro del mismo @transaction.atomic sin try/except: cualquier
    excepción del backend de email revertía también la creación del
    usuario, además de tumbar la petición)."""

    def _boom(*args, **kwargs):
        raise OSError("SMTP timed out")

    monkeypatch.setattr("users.services.send_mail", _boom)
    with django_capture_on_commit_callbacks(execute=True):
        user = user_create(email="a@b.com", password="pw-strong-123")  # no debe lanzar

    assert User.objects.filter(email="a@b.com").exists()
    assert user.check_password("pw-strong-123")
    assert len(mail.outbox) == 0  # el backend real habría fallado


@pytest.mark.django_db
def test_user_create_rejects_verified_duplicate():
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    with pytest.raises(ValueError):
        user_create(email="a@b.com", password="pw-strong-456")


@pytest.mark.django_db
def test_email_verify_activates_user():
    user = user_create(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    verified = email_verify(token=token)
    verified.refresh_from_db()
    assert verified.is_active is True
    assert verified.is_email_verified is True


@pytest.mark.django_db
def test_verification_resend_sends_again_for_unverified(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        user_create(email="a@b.com", password="pw-strong-123")
    mail.outbox.clear()
    with django_capture_on_commit_callbacks(execute=True):
        verification_resend(email="a@b.com")
    assert len(mail.outbox) == 1


@pytest.mark.django_db
def test_verification_resend_swallows_email_backend_failure(
    monkeypatch, django_capture_on_commit_callbacks
):
    """Bug crítico de email: un fallo al enviar (SMTP colgado, API caída...)
    no debe propagar la excepción hacia arriba."""
    with django_capture_on_commit_callbacks(execute=True):
        user_create(email="a@b.com", password="pw-strong-123")

    def _boom(*args, **kwargs):
        raise OSError("SMTP timed out")

    monkeypatch.setattr("users.services.send_mail", _boom)
    with django_capture_on_commit_callbacks(execute=True):
        verification_resend(email="a@b.com")  # no debe lanzar
