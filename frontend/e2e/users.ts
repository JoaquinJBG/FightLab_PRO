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
  combat: "e2e-combat@fightlab.test", // anexo de combate (E.5): golpe en la cabeza, carga y corte
  // Fase 5 (check-in): cada uno cambia su propio estado, así que no se comparten.
  checkin: "e2e-checkin@fightlab.test",
  checkinCardiac: "e2e-checkin-cardiac@fightlab.test",
  checkinEmergency: "e2e-checkin-emergency@fightlab.test",
  checkinFat: "e2e-checkin-fat@fightlab.test",
  // Fase 6 (plan de la semana): con series de press banca y MMA registrados; y con un SÍ en el
  // PAR-Q+ (review_before_vigorous y no_all_out_sprints).
  plan: "e2e-plan@fightlab.test",
  planParq: "e2e-plan-parq@fightlab.test",
  // Fase 7 (revisión semanal): 4 semanas de pesajes bajando despacio, ingesta en el check-in y el
  // press banca estancado; y el mismo con SCOFF positivo (no_weight_targets).
  review: "e2e-review@fightlab.test",
  reviewScoff: "e2e-review-scoff@fightlab.test",
  // Fase 8 (menús): uno normal (pone una alergia) y uno con SCOFF positivo (menú a mantenimiento).
  menu: "e2e-menu@fightlab.test",
  menuScoff: "e2e-menu-scoff@fightlab.test",
  // Fase 9: importar CSV y "Última vez" desde el servidor; y un SÍ en el PAR-Q+ para el aviso de
  // sesión vigorosa (review_before_vigorous).
  gymImport: "e2e-import@fightlab.test",
  vigorous: "e2e-vigorous@fightlab.test",
  // Fase 10: importar el historial (con un check-in ya hecho hace 4 días, para el conflicto); y
  // con SCOFF positivo (no_weight_targets: peso, cintura y kcal no se importan).
  history: "e2e-history@fightlab.test",
  historyScoff: "e2e-history-scoff@fightlab.test",
  // Fase 11 (Hoy): plan de la semana activo con gimnasio hoy y un menú con dos comidas para hoy.
  today: "e2e-today@fightlab.test",
  // F17 (biblioteca de ejercicios): crea, edita y borra sus propios ejercicios.
  exercises: "e2e-exercises@fightlab.test",
};
