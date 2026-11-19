"""Datos inventados con la forma de los de producción (beta, a90f4b5).

Se ejecuta con el código de `feat/beta-cloud` sobre una base de datos vacía ya migrada:
    python manage.py shell -c "exec(open('<ruta>/seed_beta.py', encoding='utf-8').read())"
No lee nada de producción: todo es de mentira. Ver README.md de esta carpeta.
"""
from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO

from django.contrib.auth import get_user_model
from django.utils import timezone
from PIL import Image

from activities.models import Activity
from ai.models import AIUsage
from profiles.models import BiometricsLog, ProgressPhoto, UserProfile
from userstate.models import UserState

User = get_user_model()
now = timezone.now()
today = timezone.localdate()


def jpeg(color):
    buf = BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def user(email, *, verified=True, staff=False, **profile):
    u = User.objects.create_user(email=email, password="seed-Password-123", is_active=verified)
    u.is_email_verified = verified
    u.is_staff = staff
    u.save()
    p, _ = UserProfile.objects.get_or_create(user=u)  # la beta lo crea con una señal
    for k, v in profile.items():
        setattr(p, k, v)
    p.save()
    return u, p


ana, ana_p = user(
    "ana@seed.test", date_of_birth=date(1995, 4, 2), gender="FEMALE", height_cm=168,
    dominant_stance="ORTHODOX", timezone="Europe/Madrid",
)
luis, luis_p = user(
    "luis@seed.test", date_of_birth=date(1988, 11, 20), gender="MALE", height_cm=181,
    dominant_stance="SOUTHPAW", timezone="Europe/Madrid", preferred_units="IMPERIAL",
)
sin_verificar, sin_verificar_p = user("pendiente@seed.test", verified=False)
admin, admin_p = user("admin@seed.test", staff=True, gender="OTHER")
User.objects.filter(pk=admin.pk).update(role="ADMIN")

# Biometría: peso, grasa, FC, VFC, sueño y perímetros
for i, (kg, fat) in enumerate([(62.4, 22.1), (62.0, 21.8), (61.7, None), (61.5, 21.2)]):
    BiometricsLog.objects.create(
        profile=ana_p, timestamp=now - timedelta(days=7 * i), weight_kg=Decimal(str(kg)),
        body_fat_pct=Decimal(str(fat)) if fat else None, resting_heart_rate=52 + i, hrv_ms=70 - i,
        sleep_quality_score=80, waist_cm=Decimal("68.5"), hip_cm=Decimal("94.0"),
    )
BiometricsLog.objects.create(
    profile=luis_p, timestamp=now - timedelta(days=2), weight_kg=Decimal("84.30"), neck_cm=Decimal("39.0"),
    chest_cm=Decimal("104.0"), arm_cm=Decimal("36.5"), thigh_cm=Decimal("58.0"),
)
BiometricsLog.objects.create(
    profile=luis_p, timestamp=now - timedelta(days=1), resting_heart_rate=58, source="GARMIN",
    external_id="garmin-123", raw_payload={"device": "fenix"},
)

# Fotos de progreso guardadas en Postgres (bytea)
ProgressPhoto.objects.create(profile=ana_p, data=jpeg((200, 30, 30)), content_type="image/jpeg",
                             width=64, height=48, taken_at=today - timedelta(days=30))
ProgressPhoto.objects.create(profile=ana_p, data=jpeg((30, 200, 30)), content_type="image/jpeg",
                             width=64, height=48, taken_at=today)
ProgressPhoto.objects.create(profile=luis_p, data=jpeg((30, 30, 200)), content_type="image/jpeg",
                             width=64, height=48, taken_at=today - timedelta(days=3))

# Actividades. GYM con los tres formatos de `detail` que manda la beta (completo, compacto y sin
# desglose porque no cabía) y uno con una serie ilegible; deporte y MMA.
FULL = {"focus": "Pierna", "volume_kg": 2310, "exercises": [
    {"name": "Sentadilla", "sets": [{"kg": 100, "reps": 5}, {"kg": 100, "reps": 5}, {"kg": 102.5, "reps": 4}]},
    {"name": "Dominadas", "sets": [{"kg": 0, "reps": 8}, {"kg": 0, "reps": 7}]},
]}
COMPACT = {"focus": None, "volume_kg": 1180, "ex": [
    {"n": "Press banca", "s": [[60, 10], [62.5, 8]]},
    {"n": "Fondos", "s": [[0, 12]]},
]}
CUT = {"focus": "Torso", "volume_kg": 25000}
ODD = {"focus": None, "volume_kg": 500, "exercises": [
    {"name": "Remo", "sets": [{"kg": "x", "reps": 10}, {"kg": 50, "reps": 10}, {"kg": 50, "reps": 0}]},
]}


def act(profile, cid, kind, days_ago, **kw):
    return Activity.objects.create(
        profile=profile, source="MANUAL", external_id=cid, kind=kind,
        started_at=now - timedelta(days=days_ago, hours=2), duration_sec=kw.pop("duration_sec", 3600),
        rpe=kw.pop("rpe", 7), **kw,
    )


act(ana_p, "c-gym-full", "GYM", 1, title="Pierna", detail=FULL)
act(ana_p, "c-gym-compact", "GYM", 3, title="Torso", detail=COMPACT)
act(ana_p, "c-gym-cut", "GYM", 5, title="Torso", detail=CUT)
act(luis_p, "c-gym-odd", "GYM", 2, detail=ODD)
act(luis_p, "c-gym-bare", "GYM", 4, detail=None)
act(ana_p, "c-sport", "SPORT", 2, title="Carrera", kcal=420, note="10 km suaves", detail={"sport": "run", "km": 10})
act(ana_p, "c-mma", "MMA", 0, title="Sparring", rpe=9, detail={"rounds": 5, "round_min": 5})
for d in range(6, 30, 2):  # historial de 4 semanas para las métricas de carga
    act(luis_p, f"c-hist-{d}", "MMA", d, duration_sec=5400, rpe=6)

# Estado local con backup en el servidor (app userstate)
for key, value in [
    (f"nutri_{today.isoformat()}", {"meals": [{"name": "Avena", "kcal": 350, "p": 12, "c": 60, "f": 6}]}),
    (f"water_{today.isoformat()}", {"ml": 1750}),
    ("nutri_goal", {"goal": "perder"}),
    ("weigh", {"date": (today + timedelta(days=20)).isoformat(), "target": 61.2, "category": "-61 kg"}),
    ("gym_week", {"days": [1, 3, 5]}),
    ("gym_sessions", [{"ts": 1, "exercises": FULL["exercises"]}]),
    ("profile_extra", {"discipline": "MMA"}),
    ("coach_fb", {"up": 3, "down": 1}),
    (f"coach_dismissed_{today.isoformat()}", ["acwr"]),
    ("coach_memory", {"lesion": "Molestia en el hombro derecho", "fase": "Fight camp",
                      "fecha_pelea": (today + timedelta(days=20)).isoformat(), "tono": "directo"}),
]:
    UserState.objects.create(profile=ana_p, key=key, value=value, updated_at=now)
UserState.objects.create(profile=luis_p, key="nutri_goal", value={"goal": "ganar"}, updated_at=now)

# Uso de la IA
AIUsage.objects.create(user=ana, kind="chat", date=today, count=4, input_tokens=5100, output_tokens=900)
AIUsage.objects.create(user=luis, kind="food", date=today - timedelta(days=1), count=1, input_tokens=1500, output_tokens=300)

print("seed ok:", User.objects.count(), "usuarios,", Activity.objects.count(), "actividades")
