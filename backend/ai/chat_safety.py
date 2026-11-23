"""Mensajes de seguridad en el chat del coach con IA (F3).

Es la lista gemela de `frontend/lib/chat-safety.ts` (el chat por reglas): si el atleta habla de
un golpe en la cabeza, de señales cardiacas (pecho, mareo, desmayo), de fiebre o de dolor o una
lesión, en español o en inglés, el servidor añade al texto de sistema una nota de seguridad que va
antes que cualquier consejo de carga, con la misma regla que usan el check-in y el cribado. Las
claves de esas reglas se dan por recuperadas en el turno, para que el modelo pueda citarlas.
Si se cambia una lista, hay que cambiar la otra (las dos llevan las mismas frases de prueba).

Ante la duda se marca: un falso positivo solo añade un aviso prudente.
"""
import re
import unicodedata

from coaching import redflags

HEAD_BLOW, CARDIAC, ILLNESS, PAIN = "headBlow", "cardiac", "illness", "pain"
# Por orden de gravedad: gana el primero que aparezca en la conversación.
ORDER = (HEAD_BLOW, CARDIAC, ILLNESS, PAIN)


def normalize(text: str) -> str:
    """Minúsculas, sin tildes y con el apóstrofo recto."""
    folded = unicodedata.normalize("NFD", text.lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return folded.replace("‘", "'").replace("’", "'")


def _all(*patterns: str) -> list[re.Pattern]:
    return [re.compile(p) for p in patterns]


HEAD = _all(
    r"golpe\w* (muy )?(fuerte )?(en|a|de) la cabeza",
    r"cabezazo",
    r"me (dieron|pegaron|golpearon|metieron|cazaron)\b.{0,30}\bcabeza",
    r"conmocion",
    r"noque",
    r"\bk\.?o\.?\b",
    r"aturdid",
    r"groggy",
    r"vi las estrellas",
    r"concuss",
    r"knock(ed)? (me )?out",
    r"\bko'?d\b",
    r"\b(hit|blow|knock|bang|bump|kick|punch|shot)\w* (to |on |in )?(the |my )?head",
    r"\bhead (blow|hit|knock|injur|trauma|shot)",
    r"\bdazed\b",
    r"saw stars",
)
HEAD_SYMPTOM = re.compile(r"cabeza|headache|\bhead\b")
CONTACT = re.compile(r"sparring|golpe|combate|pelea|patada|punetazo|pegaron|\bhit\b|punch|kick|fight|bout|rolling|\broll\b")

CARDIAC_RES = _all(
    r"\bmare(o|os|ad[oa]s?|a|an)\b",
    r"desmay",
    r"perdi el conocimiento",
    r"(dolor|opresion|presion|pinchazo)\w* (en el |de |del )?pecho",
    r"palpitacion",
    r"taquicardia",
    r"falta (el|de) aire",
    r"me ahogo",
    r"no puedo respirar",
    r"dizz",
    r"faint",
    r"light ?headed",
    r"chest (pain|tight|pressure|hurts)",
    r"pain in (my|the) chest",
    r"palpitation",
    r"(racing|pounding) heart|heart (is )?(racing|pounding)",
    r"short(ness)? of breath",
    r"can'?t breathe",
    r"passed out|blacked out",
)

ILLNESS_RES = _all(r"fiebre", r"febril", r"\bgripe\b", r"fever", r"\bflu\b")

PAIN_RES = _all(
    r"\bduel(e|en|o)\b",
    r"\bdolor",
    r"dolorid",
    r"lesion",
    r"hecho dano|hice dano",
    r"\btorc(i|io|ido|ida|edura)\b",
    r"esguince",
    r"\btiron\b",
    r"rotura",
    r"fractura",
    r"luxacion",
    r"molestia",
    r"pinchazo",
    r"hinchad",
    r"inflamad",
    r"\bpain",
    r"\bhurt",
    r"\binjur",
    r"sprain",
    # «strain» a secas es la tensión de la carga (monotonía y strain): solo cuenta como lesión así
    r"\bstrained\b|\b(muscle|hamstring|groin|calf|back) strain",
    r"pulled (a|my) ",
    r"tweak",
    r"swollen|swelling",
    r"\btorn\b",
    r"fractur",
    r"dislocat",
    r"\b(head|back|neck|knee|stomach)?aches?\b|\baching\b",
)
SORE = re.compile(r"\bsore\b")
BODY_PART = re.compile(r"knee|shoulder|elbow|wrist|ankle|hip|back|neck|rib|hand|foot|finger|toe|shin")

NEGATED = _all(
    r"no me duelen? nada",
    r"sin (ningun )?dolor(es)?",
    r"sin (ninguna )?lesion(es)?",
    r"no tengo (ningun )?dolor",
    r"ningun dolor",
    r"nada de dolor",
    r"no estoy lesionad[oa]",
    r"\bno (pain|injur(y|ies))\b",
    r"pain[- ]free",
    r"without (any )?pain",
    r"not (injured|hurt)\b",
    r"(doesn'?t|don'?t|does not|do not) hurt",
    r"nothing hurts",
)


def _any(patterns: list[re.Pattern], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def detect_topic(text: str) -> str | None:
    """El tema de seguridad de un mensaje, o None (mismo criterio que el chat por reglas)."""
    low = normalize(text)
    if _any(HEAD, low) or (HEAD_SYMPTOM.search(low) and CONTACT.search(low)):
        return HEAD_BLOW
    if _any(CARDIAC_RES, low):
        return CARDIAC
    if _any(ILLNESS_RES, low):
        return ILLNESS
    plain = low
    for pattern in NEGATED:
        plain = pattern.sub(" ", plain)
    if _any(PAIN_RES, plain) or (SORE.search(plain) and BODY_PART.search(plain)):
        return PAIN
    return None


def conversation_topic(messages: list[dict]) -> str | None:
    """El tema más grave de lo que ha escrito el atleta en la conversación que llega al modelo."""
    found = {
        detect_topic(m["content"])
        for m in messages
        if isinstance(m, dict) and m.get("role") == "user" and isinstance(m.get("content"), str)
    }
    return next((topic for topic in ORDER if topic in found), None)


# Las reglas de cada tema: las del check-in (`coaching/redflags.py`) y, para la cabeza, las del
# anexo de combate (E.5). Son las mismas que cita el chat por reglas.
RULES: dict[str, tuple[str, ...]] = {
    HEAD_BLOW: (
        "combat-sports/stop-training-after-a-suspected-head-injury",
        "combat-sports/red-flags-after-a-head-blow-mean-emergency-care",
    ),
    CARDIAC: (redflags.CARDIAC,),
    ILLNESS: (redflags.FEVER,),
    PAIN: (redflags.INJURY,),
}

_WHAT = {
    HEAD_BLOW: (
        "a possible blow to the head or head symptoms after contact. Tell them not to train today, "
        "even if they feel fine, and no sparring or contact until a doctor has assessed them; with neck "
        "pain, repeated vomiting, a seizure, confusion or a worsening headache, emergency care now and "
        "do not stay alone. Point to Training > MMA > 'Report a blow to the head'"
    ),
    CARDIAC: (
        "chest pain or pressure, dizziness, fainting, breathlessness or palpitations. Tell them to stop "
        "and not train today, and to see a doctor before training again; with chest pain at rest, "
        "fainting, or chest pain with breathlessness and sweating, call the emergency number now"
    ),
    ILLNESS: (
        "a fever or feeling unwell all over. Tell them not to train until they are better"
    ),
    PAIN: (
        "new pain or an injury. Tell them not to load that area or train through the pain; if the pain "
        "is sharp, getting worse, or there is numbness or weakness, stop and see a doctor. Suggest logging "
        "it in the check-in (warning signs, 'new pain or an injury') so the plan takes load off it until a "
        "GP or physiotherapist assesses it"
    ),
}


def safety_note(topic: str) -> str:
    """Nota de seguridad para el texto de sistema: va antes que cualquier consejo de carga."""
    cites = " and ".join(f"[[regla:{key}]]" for key in RULES[topic])
    return (
        f"The athlete has mentioned {_WHAT[topic]}. This comes before any load, intensity or "
        "readiness advice: never tell them to train hard, push through or that they have room, "
        f"whatever the load and recovery data say. Cite {cites}."
    )
