// Detección de mensajes de seguridad en el chat del coach (F3). Antes de cualquier consejo de
// carga, el chat por reglas mira si el atleta habla de un golpe en la cabeza, de señales
// cardiacas (pecho, mareo, desmayo), de fiebre o de dolor o una lesión, en español o en inglés.
// En ese caso contesta con la misma regla que usan el check-in y el cribado, nunca con un
// «dale duro». La lista gemela del servidor (`backend/ai/chat_safety.py`) hace lo mismo para la
// ruta con IA: si se cambia una, hay que cambiar la otra (las dos llevan las mismas frases de prueba).
//
// Ante la duda se marca: un falso positivo solo cambia la respuesta por un aviso prudente.

export type SafetyTopic = "headBlow" | "cardiac" | "illness" | "pain";

/** Minúsculas, sin tildes y con el apóstrofo recto, para que «lesión» y «lesion» cuenten igual. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2018\u2019]/g, "'");
}

// Golpe en la cabeza o conmoción (anexo de combate E.5).
const HEAD = [
  /golpe\w* (muy )?(fuerte )?(en|a|de) la cabeza/,
  /cabezazo/,
  /me (dieron|pegaron|golpearon|metieron|cazaron)\b.{0,30}\bcabeza/,
  /conmocion/,
  /noque/,
  /\bk\.?o\.?\b/,
  /aturdid/,
  /groggy/,
  /vi las estrellas/,
  /concuss/,
  /knock(ed)? (me )?out/,
  /\bko'?d\b/,
  /\b(hit|blow|knock|bang|bump|kick|punch|shot)\w* (to |on |in )?(the |my )?head/,
  /\bhead (blow|hit|knock|injur|trauma|shot)/,
  /\bdazed\b/,
  /saw stars/,
];
// Síntomas en la cabeza que, tras contacto, se tratan como un posible golpe en la cabeza.
const HEAD_SYMPTOM = /cabeza|headache|\bhead\b/;
const CONTACT = /sparring|golpe|combate|pelea|patada|punetazo|pegaron|\bhit\b|punch|kick|fight|bout|rolling|\broll\b/;

// Señales cardiacas: «para y consulta» (recovery-habits, Cardiac warning symptoms).
const CARDIAC = [
  /\bmare(o|os|ad[oa]s?|a|an)\b/,
  /desmay/,
  /perdi el conocimiento/,
  /(dolor|opresion|presion|pinchazo)\w* (en el |de |del )?pecho/,
  /palpitacion/,
  /taquicardia/,
  /falta (el|de) aire/,
  /me ahogo/,
  /no puedo respirar/,
  /dizz/,
  /faint/,
  /light ?headed/,
  /chest (pain|tight|pressure|hurts)/,
  /pain in (my|the) chest/,
  /palpitation/,
  /(racing|pounding) heart|heart (is )?(racing|pounding)/,
  /short(ness)? of breath/,
  /can'?t breathe/,
  /passed out|blacked out/,
];

// Fiebre o malestar general: no entrenar (recovery-habits, Fever and systemic illness).
const ILLNESS = [/fiebre/, /febril/, /\bgripe\b/, /fever/, /\bflu\b/];

// Dolor nuevo o lesión (la señal «Dolor nuevo o una lesión» del check-in).
const PAIN = [
  /\bduel(e|en|o)\b/,
  /\bdolor/,
  /dolorid/,
  /lesion/,
  /hecho dano|hice dano/,
  /\btorc(i|io|ido|ida|edura)\b/,
  /esguince/,
  /\btiron\b/,
  /rotura/,
  /fractura/,
  /luxacion/,
  /molestia/,
  /pinchazo/,
  /hinchad/,
  /inflamad/,
  /\bpain/,
  /\bhurt/,
  /\binjur/,
  /sprain/,
  // «strain» a secas es la tensión de la carga (monotonía y strain): solo cuenta como lesión así
  /\bstrained\b|\b(muscle|hamstring|groin|calf|back) strain/,
  /pulled (a|my) /,
  /tweak/,
  /swollen|swelling/,
  /\btorn\b/,
  /fractur/,
  /dislocat/,
  /\b(head|back|neck|knee|stomach)?aches?\b|\baching\b/,
];
// «Sore» solo cuenta como dolor si va con una articulación o zona (las agujetas no son lesión).
const SORE = /\bsore\b/;
const BODY_PART = /knee|shoulder|elbow|wrist|ankle|hip|back|neck|rib|hand|foot|finger|toe|shin/;

// Frases negadas que no son dolor («sin dolor», «no me duele nada», «pain-free»).
const NEGATED = [
  /no me duelen? nada/,
  /sin (ningun )?dolor(es)?/,
  /sin (ninguna )?lesion(es)?/,
  /no tengo (ningun )?dolor/,
  /ningun dolor/,
  /nada de dolor/,
  /no estoy lesionad[oa]/,
  /\bno (pain|injur(y|ies))\b/,
  /pain[- ]free/,
  /without (any )?pain/,
  /not (injured|hurt)\b/,
  /(doesn'?t|don'?t|does not|do not) hurt/,
  /nothing hurts/,
];

const any = (res: RegExp[], text: string) => res.some((re) => re.test(text));

/** El tema de seguridad del mensaje, o `null`. Por orden de gravedad: golpe en la cabeza,
 * señales cardiacas, fiebre y dolor o lesión. */
export function detectSafetyTopic(text: string): SafetyTopic | null {
  const low = normalize(text);
  if (any(HEAD, low) || (HEAD_SYMPTOM.test(low) && CONTACT.test(low))) return "headBlow";
  if (any(CARDIAC, low)) return "cardiac";
  if (any(ILLNESS, low)) return "illness";
  const plain = NEGATED.reduce((acc, re) => acc.replace(new RegExp(re.source, "g"), " "), low);
  if (any(PAIN, plain) || (SORE.test(plain) && BODY_PART.test(plain))) return "pain";
  return null;
}
