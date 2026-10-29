import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { USERS, PASSWORD } from "./users";

/** Crea (o reinicia) los usuarios del E2E ya verificados y sin perfil ni cribado, con el
 * `manage.py` del backend. `E2E_PYTHON` es el intérprete del venv del backend; el entorno
 * (base de datos, PYTHONPATH…) es el mismo con el que corre Django. */
export default function globalSetup() {
  const python = process.env.E2E_PYTHON ?? "python";
  const backend = join(__dirname, "..", "..", "backend");
  const code = `
from django.contrib.auth import get_user_model
from profiles.models import UserProfile
User = get_user_model()
for email in ${JSON.stringify(Object.values(USERS))}:
    User.objects.filter(email=email).delete()
    u = User.objects.create_user(email=email, password=${JSON.stringify(PASSWORD)}, is_active=True)
    u.is_email_verified = True
    u.save()
    UserProfile.objects.get_or_create(user=u)
`;
  execFileSync(python, ["manage.py", "shell", "-c", code], { cwd: backend, stdio: "inherit" });
}
