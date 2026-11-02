import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { USERS, READY_USERS, PASSWORD } from "./users";

/** Crea (o reinicia) los usuarios del E2E ya verificados, con el `manage.py` del backend.
 * `USERS` no llevan perfil ni cribado (recorren el onboarding); `READY_USERS` llevan el onboarding
 * hecho (región, fecha de nacimiento, altura, objetivo, cribado y un peso). `E2E_PYTHON` es el
 * intérprete del venv del backend; el entorno (base de datos, PYTHONPATH…) es el mismo con el que
 * corre Django. */
export default function globalSetup() {
  const python = process.env.E2E_PYTHON ?? "python";
  const backend = join(__dirname, "..", "..", "backend");
  const code = `
from datetime import date
from django.contrib.auth import get_user_model
from django.utils import timezone
from coaching.services import screening_update
from profiles.models import BiometricsLog, UserProfile
User = get_user_model()

def fresh(email):
    User.objects.filter(email=email).delete()
    u = User.objects.create_user(email=email, password=${JSON.stringify(PASSWORD)}, is_active=True)
    u.is_email_verified = True
    u.save()
    return u, UserProfile.objects.get_or_create(user=u)[0]

for email in ${JSON.stringify(Object.values(USERS))}:
    fresh(email)

READY = ${JSON.stringify(READY_USERS)}
CLEAN = {"scoff_yes_count": 0, "scoff_positive": False, "parq_any_yes": False, "parq_followup_yes": False, "cardiac_symptoms": False}
SETUPS = {
    "plain": ({}, {}),
    "scoff": ({}, {"scoff_yes_count": 2}),
    "noSex": ({"gender": "OTHER"}, {}),
    "noTraining": ({}, {"cardiac_symptoms": True}),
    "combat": ({}, {}),
    "checkin": ({}, {}),
    "checkinCardiac": ({}, {}),
    "checkinEmergency": ({}, {}),
    "checkinFat": ({}, {}),
    "plan": ({}, {}),
    "planParq": ({}, {"parq_any_yes": True}),
}
for key, email in READY.items():
    u, p = fresh(email)
    fields, screening = SETUPS[key]
    for name, value in {"date_of_birth": date(1996, 5, 1), "height_cm": 175, "gender": "MALE", "region": "es",
                        "goal": "maintenance", "activity_level": "desk_training", **fields}.items():
        setattr(p, name, value)
    p.save()
    screening_update(p, {**CLEAN, **screening}, origin="onboarding")
    BiometricsLog.objects.create(profile=p, weight_kg=72, resting_heart_rate=55, hrv_ms=80, timestamp=timezone.now())

# Fase 6: dos sesiones de press banca (3 x 10 a 60 kg) y MMA el mismo día de la semana en dos semanas.
from datetime import timedelta
from activities.models import Activity, SetLog
for key in ("plan", "planParq"):
    p = UserProfile.objects.get(user__email=READY[key])
    now = timezone.now()
    for days in (3, 10):
        a = Activity.objects.create(profile=p, kind="GYM", title="Full body", started_at=now - timedelta(days=days), duration_sec=3600, rpe=7)
        SetLog.objects.bulk_create(SetLog(activity=a, exercise="Press banca", exercise_index=0, set_index=i, weight_kg=60, reps=10) for i in range(3))
    for days in (2, 9):
        Activity.objects.create(profile=p, kind="MMA", title="MMA", started_at=now - timedelta(days=days), duration_sec=3600, rpe=7)
`;
  execFileSync(python, ["manage.py", "shell", "-c", code], { cwd: backend, stdio: "inherit" });
}
