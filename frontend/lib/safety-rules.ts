// Reglas de seguridad de la base del motor (`recovery-habits.md`) que cita el chat por reglas
// cuando el atleta habla de dolor, mareo o fiebre (F3). Son las mismas que usa el check-in para
// sus señales de alarma (`backend/coaching/redflags.py`). La clave es la de `KnowledgeRule.key`
// y el grado el de la regla: `backend/coaching/tests/test_frontend_rules.py` comprueba los dos.

import type { RuleRef } from "./combat-rules";

export const SAFETY_RULES = {
  // Dolor nuevo o lesión: «para y consulta» con dolor agudo, que empeora o con síntomas neurológicos
  newPain: { key: "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain", grade: "moderate" },
  // Pecho, mareo, desmayo, falta de aire o palpitaciones
  cardiac: { key: "recovery-habits/cardiac-warning-symptoms-stop-and-refer", grade: "moderate" },
  // Fiebre o malestar general
  illness: { key: "recovery-habits/fever-and-systemic-illness-do-not-train", grade: "moderate" },
} as const satisfies Record<string, RuleRef>;
