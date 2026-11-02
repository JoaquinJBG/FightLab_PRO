// Reglas del anexo de combate (`backend/knowledge_fightlab/combat-sports.md`) que cita la UI
// junto a los números y textos de carga, corte, conmoción y gasto (E.5). La clave es la de
// `KnowledgeRule.key` y el grado el del anexo: el chip abre la regla real del servidor.
// `backend/coaching/tests/test_frontend_rules.py` comprueba que cada clave existe con ese grado.

import type { Grade } from "./evidence";

export type RuleRef = { key: string; grade: Grade };

const rule = (slug: string, grade: Grade): RuleRef => ({ key: `combat-sports/${slug}`, grade });

export const COMBAT_RULES = {
  // Carga
  sessionRpe: rule("session-rpe-is-a-valid-general-measure-of-internal-load", "moderate"),
  rpeCombat: rule("treat-session-rpe-as-perceived-load-in-grappling-mma-boxing-and-judo", "emerging"),
  ratio28: rule("show-the-load-ratio-only-after-28-days-of-history", "emerging"),
  comparison: rule("present-load-as-a-neutral-comparison-with-the-recent-average", "emerging"),
  notPredictor: rule("acwr-is-not-a-validated-injury-predictor", "emerging"),
  combatStudies: rule("acwr-is-barely-studied-in-combat-sports", "emerging"),
  notSafeZone: rule("the-0-8-1-3-sweet-spot-is-not-a-safe-zone", "emerging"),
  monotony: rule("monotony-and-strain-are-descriptive-indices", "emerging"),
  pmc: rule("a-pmc-display-is-a-labelled-fightlab-convention", "emerging"),
  // Corte y pesaje
  plannedWeight: rule("prefer-planned-weight-management-to-acute-dehydration", "moderate"),
  rwlCommon: rule("rapid-weight-loss-is-common-but-not-safe-because-of-it", "moderate"),
  regainNotRecovery: rule("weight-regained-after-the-weigh-in-is-not-proof-of-recovery", "moderate"),
  cutDeaths: rule("dehydration-based-cuts-have-been-linked-to-deaths", "moderate"),
  noSafePercentage: rule("performance-effects-of-rapid-weight-loss-are-mixed-with-no-safe-percentage", "emerging"),
  recoveryConsensus: rule("post-weigh-in-recovery-guidance-is-general-consensus-only", "emerging"),
  noWaterLoading: rule("do-not-promote-water-loading-diuretics-or-iv-fluids", "emerging"),
  weighInRules: rule("weigh-in-rules-are-not-a-safety-guarantee", "emerging"),
  minorsCut: rule("no-weight-cut-content-for-minors-and-refer-repeated-cutters", "moderate"),
  cutEmergency: rule("collapse-or-confusion-during-a-cut-is-an-emergency", "moderate"),
  // Conmoción
  stopAfterHeadBlow: rule("stop-training-after-a-suspected-head-injury", "strong"),
  redFlags: rule("red-flags-after-a-head-blow-mean-emergency-care", "strong"),
  relativeRest: rule("early-rest-after-a-concussion-is-relative", "strong"),
  returnSteps: rule("return-to-contact-follows-a-graded-clinician-supervised-plan", "strong"),
  clearance: rule("no-sparring-until-symptom-free-with-exertion-and-cleared", "strong"),
  feelingNormal: rule("feeling-normal-after-sparring-does-not-rule-out-head-injury", "emerging"),
  noContact: rule("a-head-blow-with-symptoms-sets-no-contact-and-refers", "strong"),
  headgear: rule("do-not-present-headgear-as-concussion-protection", "moderate"),
  // Gasto energético
  compendium: rule("use-2024-compendium-mets-as-combat-intensity-anchors", "moderate"),
  metsRange: rule("mets-classify-intensity-but-do-not-give-individual-kcal", "moderate"),
  wearables: rule("wearable-kcal-are-rough-and-unvalidated-in-combat-sports", "moderate"),
} as const satisfies Record<string, RuleRef>;

export type CombatRuleId = keyof typeof COMBAT_RULES;
