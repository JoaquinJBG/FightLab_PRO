"""Suscripción, preferencias y aviso de prueba (`/me/push*`), y el endpoint del cron con el
secreto del BFF. Ningún envío real: `push_post` (conftest) sustituye la llamada HTTP."""
import json

import pytest
from rest_framework.test import APIClient

from coaching.tests.helpers import client_for, make_user
from notifications.models import PushSubscription, ReminderPrefs

from .conftest import browser_keys

pytestmark = pytest.mark.django_db
FCM = "https://fcm.googleapis.com/fcm/send/abc123"
SECRET = "bff-secret-de-prueba"
CRON = "/api/v1/cron/reminders"


def subscribe(client, endpoint=FCM):
    return client.post("/api/v1/me/push/subscribe", {"endpoint": endpoint, "keys": browser_keys()}, format="json")


def test_requires_auth():
    for path in ("", "/subscribe", "/unsubscribe", "/test"):
        assert APIClient().post(f"/api/v1/me/push{path}", {}, format="json").status_code == 401
    assert APIClient().get("/api/v1/me/push").status_code == 401


def test_without_vapid_keys_push_is_off_and_says_so(settings):
    settings.VAPID_PUBLIC_KEY = settings.VAPID_PRIVATE_KEY = settings.VAPID_SUBJECT = ""
    client = client_for(make_user())
    body = client.get("/api/v1/me/push").json()
    assert body == {
        "configured": False,
        "public_key": None,
        "prefs": {"eve": True, "review": True, "weigh": False, "mobility": False},
        "devices": 0,
    }
    res = subscribe(client)
    assert res.status_code == 503 and res.json() == {"code": "push_not_configured"}
    assert client.post("/api/v1/me/push/test").status_code == 503
    assert not PushSubscription.objects.exists()


def test_subscribe_is_an_upsert_by_endpoint(vapid):
    user = make_user()
    client = client_for(user)
    res = subscribe(client)
    assert res.status_code == 201
    body = res.json()
    assert body["configured"] is True and body["public_key"] == vapid and body["devices"] == 1
    subscribe(client)  # el navegador lo vuelve a mandar al abrir la app
    assert PushSubscription.objects.filter(profile=user.profile).count() == 1
    # El mismo navegador con otra cuenta: la suscripción pasa a la otra.
    other = make_user()
    subscribe(client_for(other))
    assert PushSubscription.objects.get(endpoint=FCM).profile == other.profile


@pytest.mark.parametrize(
    "endpoint",
    ["http://fcm.googleapis.com/fcm/send/x", "https://evil.example/push", "https://fcm.googleapis.com.evil.example/x"],
)
def test_only_known_push_services_are_accepted(vapid, endpoint):
    res = subscribe(client_for(make_user()), endpoint)
    assert res.status_code == 400 and "endpoint" in res.json()
    assert not PushSubscription.objects.exists()


def test_known_services_of_every_browser(vapid):
    client = client_for(make_user())
    for endpoint in (
        "https://updates.push.services.mozilla.com/wpush/v2/x",
        "https://web.push.apple.com/QH1",
        "https://wns2-db5p.notify.windows.com/w/?token=x",
    ):
        assert subscribe(client, endpoint).status_code == 201


def test_a_person_keeps_at_most_ten_devices(vapid):
    user = make_user()
    client = client_for(user)
    for i in range(12):
        subscribe(client, f"{FCM}{i}")
    endpoints = set(PushSubscription.objects.filter(profile=user.profile).values_list("endpoint", flat=True))
    assert len(endpoints) == 10 and f"{FCM}11" in endpoints and f"{FCM}0" not in endpoints


def test_unsubscribe_only_touches_own_devices(vapid):
    user, other = make_user(), make_user()
    subscribe(client_for(other), FCM + "other")
    client = client_for(user)
    subscribe(client)
    body = client.post("/api/v1/me/push/unsubscribe", {"endpoint": FCM + "other"}, format="json").json()
    assert body["devices"] == 1
    body = client.post("/api/v1/me/push/unsubscribe", {"endpoint": FCM}, format="json").json()
    assert body["devices"] == 0 and PushSubscription.objects.filter(endpoint=FCM + "other").exists()


def test_each_reminder_switches_on_and_off_on_its_own():
    user = make_user()
    client = client_for(user)
    body = client.put("/api/v1/me/push/prefs", {"weigh": True, "eve": False}, format="json").json()
    assert body["prefs"] == {"eve": False, "review": True, "weigh": True, "mobility": False}
    prefs = ReminderPrefs.objects.get(profile=user.profile)
    assert (prefs.eve, prefs.review, prefs.weigh, prefs.mobility) == (False, True, True, False)
    assert client.put("/api/v1/me/push/prefs", {"weigh": "maybe"}, format="json").status_code == 400


def test_test_reminder_is_encrypted_and_signed_for_every_device(vapid, push_post):
    user = make_user(profile={"language": "en"})
    client = client_for(user)
    subscribe(client)
    subscribe(client, "https://updates.push.services.mozilla.com/wpush/v2/x")
    body = client.post("/api/v1/me/push/test").json()
    assert body["ok"] == 2 and body["error"] == 0
    calls = {c.args[0]: c.kwargs for c in push_post.call_args_list}
    assert set(calls) == {FCM, "https://updates.push.services.mozilla.com/wpush/v2/x"}
    kwargs = calls[FCM]
    headers = kwargs["headers"]
    assert headers["content-encoding"] == "aes128gcm" and headers["ttl"] == str(12 * 3600)
    assert headers["authorization"].startswith("vapid t=") and f"k={vapid}" in headers["authorization"]
    assert b"Reminders work" not in kwargs["data"]  # cifrado: el texto no viaja en claro
    assert PushSubscription.objects.get(endpoint=FCM).last_ok_at is not None


def test_a_subscription_the_browser_dropped_is_deleted(vapid, push_post):
    user = make_user()
    client = client_for(user)
    subscribe(client)
    push_post.response.status_code = 410
    body = client.post("/api/v1/me/push/test").json()
    assert body["gone"] == 1 and body["devices"] == 0


def test_a_failing_push_service_keeps_the_subscription(vapid, push_post):
    client = client_for(make_user())
    subscribe(client)
    push_post.response.status_code = 500
    body = client.post("/api/v1/me/push/test").json()
    assert body["error"] == 1 and body["devices"] == 1


# ---------------------------------------------------------------- cron


def test_cron_without_a_configured_secret_is_off(settings):
    settings.BFF_SHARED_SECRET = ""
    res = APIClient().post(CRON, {}, format="json", HTTP_X_BFF_SECRET="anything")
    assert res.status_code == 503 and res.json() == {"code": "cron_not_configured"}


@pytest.mark.parametrize("header", [None, "", "wrong-secret", SECRET + "x"])
def test_cron_with_a_wrong_secret_is_forbidden(settings, header):
    settings.BFF_SHARED_SECRET = SECRET
    extra = {} if header is None else {"HTTP_X_BFF_SECRET": header}
    res = APIClient().post(CRON, {}, format="json", **extra)
    assert res.status_code == 403


def test_cron_ignores_user_tokens(settings):
    settings.BFF_SHARED_SECRET = SECRET
    client = client_for(make_user())  # un JWT válido no sirve de nada aquí
    assert client.post(CRON, {}, format="json").status_code == 403


def test_cron_with_the_secret_runs_the_tick(settings, vapid):
    settings.BFF_SHARED_SECRET = SECRET
    res = APIClient().post(CRON, {}, format="json", HTTP_X_BFF_SECRET=SECRET)
    assert res.status_code == 200
    body = res.json()
    assert body["enabled"] is True and body["sent"] == 0 and body["tick"].endswith(":00:00+00:00")


def test_cron_without_vapid_keys_sends_nothing(settings, push_post):
    settings.BFF_SHARED_SECRET = SECRET
    settings.VAPID_PUBLIC_KEY = settings.VAPID_PRIVATE_KEY = settings.VAPID_SUBJECT = ""
    body = APIClient().post(CRON, {}, format="json", HTTP_X_BFF_SECRET=SECRET).json()
    assert body["enabled"] is False and not push_post.called


def test_payload_language_follows_the_profile(vapid, push_post):
    from notifications import push, reminders

    user = make_user(profile={"language": "es"})
    subscribe(client_for(user))
    push.send_to_profile(user.profile, reminders.test_payload(user.profile))
    assert push_post.called
    # El contenido va cifrado; se comprueba el payload que se cifra.
    assert json.loads(json.dumps(reminders.test_payload(user.profile)))["title"] == "Avisos de FightLab"
