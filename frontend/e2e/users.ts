// Usuarios del E2E: los recrea global-setup.ts en cada ejecución.
export const PASSWORD = "e2e-Pass-2026!";
// Verificados y sin perfil ni cribado: recorren el onboarding.
export const USERS = {
  scoffPositive: "e2e-scoff@fightlab.test",
  english: "e2e-english@fightlab.test",
  cardiac: "e2e-cardiac@fightlab.test",
};
// Con el onboarding hecho (perfil, cribado y un peso): prueban Nutrición, pesaje y Home (fase 4).
export const READY_USERS = {
  plain: "e2e-nutri@fightlab.test",
  scoff: "e2e-nutri-scoff@fightlab.test", // SCOFF positivo: no_deficit y no_weight_targets
  noSex: "e2e-nutri-nosex@fightlab.test", // gender OTHER y sin equation_sex
  noTraining: "e2e-nutri-notraining@fightlab.test", // síntomas cardiacos: no_training
};
