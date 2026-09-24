import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle


@pytest.fixture
def client():
    cache.clear()
    return APIClient()


def _register(client, email, client_ip=None, secret=None):
    kwargs = {}
    if client_ip is not None:
        kwargs["HTTP_X_BFF_CLIENT_IP"] = client_ip
    if secret is not None:
        kwargs["HTTP_X_BFF_SECRET"] = secret
    return client.post(
        "/api/v1/auth/register",
        {"email": email, "password": "pw-strong-123"},
        format="json",
        **kwargs,
    )


@pytest.mark.django_db
def test_throttle_is_per_client_ip_behind_trusted_bff(client, settings, monkeypatch):
    """Con el secreto compartido correcto, cada IP real (la que reenvía el
    BFF) tiene su propio contador: no comparten cupo entre sí."""
    settings.BFF_SHARED_SECRET = "s3cret"
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "1/min")

    assert _register(client, "a@b.com", client_ip="1.1.1.1", secret="s3cret").status_code == 201
    # Mismo visitante real: agota su cupo.
    assert _register(client, "c@d.com", client_ip="1.1.1.1", secret="s3cret").status_code == 429
    # Otro visitante real detrás del mismo BFF: cupo independiente.
    assert _register(client, "e@f.com", client_ip="2.2.2.2", secret="s3cret").status_code == 201


@pytest.mark.django_db
def test_throttle_ignores_client_ip_header_with_wrong_secret(client, settings, monkeypatch):
    """Sin el secreto correcto, X-Bff-Client-Ip no sirve para saltarse el
    throttle: se cae a REMOTE_ADDR (el mismo para todo el test client), así
    que las dos peticiones comparten contador aunque manden IPs distintas."""
    settings.BFF_SHARED_SECRET = "s3cret"
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "1/min")

    assert _register(client, "a@b.com", client_ip="1.1.1.1", secret="wrong").status_code == 201
    resp = _register(client, "c@d.com", client_ip="9.9.9.9", secret="wrong")
    assert resp.status_code == 429


@pytest.mark.django_db
def test_throttle_ignores_client_ip_header_without_secret_sent(client, settings, monkeypatch):
    settings.BFF_SHARED_SECRET = "s3cret"
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "1/min")

    assert _register(client, "a@b.com", client_ip="1.1.1.1").status_code == 201
    resp = _register(client, "c@d.com", client_ip="9.9.9.9")
    assert resp.status_code == 429


@pytest.mark.django_db
def test_throttle_shares_one_counter_when_bff_secret_not_configured(client, monkeypatch):
    """BFF_SHARED_SECRET vacío (valor por defecto): X-Bff-Client-Ip se
    ignora siempre y se usa el throttle estándar de DRF."""
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "1/min")

    assert _register(client, "a@b.com", client_ip="1.1.1.1").status_code == 201
    resp = _register(client, "c@d.com", client_ip="2.2.2.2")
    assert resp.status_code == 429


def _verify(client, token="not-a-real-token", client_ip=None, secret=None):
    kwargs = {}
    if client_ip is not None:
        kwargs["HTTP_X_BFF_CLIENT_IP"] = client_ip
    if secret is not None:
        kwargs["HTTP_X_BFF_SECRET"] = secret
    return client.post("/api/v1/auth/verify-email", {"token": token}, format="json", **kwargs)


@pytest.mark.django_db
def test_default_anon_throttle_trusts_bff_client_ip_with_correct_secret(client, settings, monkeypatch):
    """VerifyEmailView no define throttle_classes propio: usa
    DEFAULT_THROTTLE_CLASSES (TrustedBffAnonRateThrottle, scope "user").
    Con el secreto correcto, cada IP real detrás del BFF tiene su propio
    contador, igual que en las vistas con throttle_scope explícito."""
    settings.BFF_SHARED_SECRET = "s3cret"
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "user", "1/min")

    assert _verify(client, client_ip="1.1.1.1", secret="s3cret").status_code == 400  # token inválido, pero no throttled
    assert _verify(client, client_ip="1.1.1.1", secret="s3cret").status_code == 429
    # Otro visitante real detrás del mismo BFF: cupo independiente.
    assert _verify(client, client_ip="2.2.2.2", secret="s3cret").status_code == 400


@pytest.mark.django_db
def test_default_anon_throttle_ignores_client_ip_header_without_correct_secret(client, monkeypatch):
    """Sin el secreto (o con uno incorrecto), rotar X-Bff-Client-Ip en cada
    petición NO evita el throttle por defecto: se cae al REMOTE_ADDR/XFF
    estándar de DRF, compartido por el test client."""
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "user", "1/min")

    assert _verify(client, client_ip="1.1.1.1").status_code == 400
    resp = _verify(client, client_ip="9.9.9.9")
    assert resp.status_code == 429


@pytest.mark.django_db
def test_resend_and_register_have_independent_throttle_scopes(client, monkeypatch):
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "register", "0/min")
    resp = client.post(
        "/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json"
    )
    assert resp.status_code == 429
    resend_resp = client.post(
        "/api/v1/auth/verify-email/resend", {"email": "a@b.com"}, format="json"
    )
    assert resend_resp.status_code == 200


@pytest.mark.django_db
def test_password_reset_request_and_confirm_have_independent_throttle_scopes(
    client, monkeypatch
):
    from users.services import email_verify, user_create
    from users.tokens import generate_email_verification_token, generate_password_reset_uid_and_token

    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    uid, token = generate_password_reset_uid_and_token(user)

    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "password-reset", "0/min")
    request_resp = client.post("/api/v1/auth/password-reset", {"email": "a@b.com"}, format="json")
    assert request_resp.status_code == 429

    confirm_resp = client.post(
        "/api/v1/auth/password-reset/confirm",
        {"uid": uid, "token": token, "password": "pw-new-strong-999"},
        format="json",
    )
    assert confirm_resp.status_code == 200
