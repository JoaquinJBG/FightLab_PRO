"""Platos de ejemplo del proveedor simulado de menús (`menu_llm.FakeMenuProposer`).

Son platos sencillos de FightLab, sin receta de origen (`source` vacío), escritos con los nombres
exactos de la tabla de alimentos del motor (`foods/base.csv`, sin la capa de una región), así el motor los reconoce con cualquier perfil. Las
cantidades son una ración de partida: el proveedor las escala para acercarse al objetivo y el
motor comprueba cada día. Ningún número de aquí llega al usuario sin pasar por el motor.

Un test comprueba que cada ingrediente existe en la tabla.
"""

# meals: la comida en la que va (cada plato en una sola, 8 por comida, para que un menú de 7 días y
# el siguiente no tengan que repetir); tupper: se puede llevar (frío o recalentable).
DISHES = (
    # ---- desayunos
    {"key": "oats_yogurt_berries", "meals": ("breakfast",), "tupper": False,
     "es": "Avena con yogur griego y frambuesas", "en": "Oats with Greek yoghurt and raspberries",
     "items": (("copos de avena", 50), ("yogur griego desnatado", 250), ("frambuesas", 100),
               ("semillas de chía", 10), ("nueces", 10)),
     "seasoning": {"es": ("canela",), "en": ("cinnamon",)}},
    {"key": "eggs_toast_tomato", "meals": ("breakfast",), "tupper": False,
     "es": "Tostadas integrales con revuelto de huevo y tomate", "en": "Wholemeal toast with scrambled egg and tomato",
     "items": (("pan integral", 80), ("huevo entero, crudo", 60), ("clara de huevo, cruda", 150), ("tomate", 120),
               ("aceite de oliva", 5), ("naranja", 150)),
     "seasoning": {"es": ("sal", "pimienta"), "en": ("salt", "pepper")}},
    {"key": "cottage_kiwi_almonds", "meals": ("breakfast",), "tupper": True,
     "es": "Queso cottage con kiwi, avena y almendras", "en": "Cottage cheese with kiwi, oats and almonds",
     "items": (("queso cottage", 250), ("kiwi", 150), ("almendras", 15), ("copos de avena", 30)),
     "seasoning": {"es": (), "en": ()}},
    {"key": "turkey_avocado_toast", "meals": ("breakfast",), "tupper": False,
     "es": "Tostada de pavo, aguacate y tomate", "en": "Turkey, avocado and tomato toast",
     "items": (("pan integral", 80), ("pechuga de pavo en lonchas", 100), ("aguacate", 40), ("tomate", 100),
               ("fresas", 150)),
     "seasoning": {"es": ("orégano",), "en": ("oregano",)}},
    {"key": "oat_pancakes_banana", "meals": ("breakfast",), "tupper": False,
     "es": "Tortitas de avena y claras con plátano", "en": "Oat and egg-white pancakes with banana",
     "items": (("copos de avena", 50), ("clara de huevo, cruda", 200), ("plátano", 80),
               ("crema de cacahuete", 10), ("semillas de lino", 10)),
     "seasoning": {"es": ("canela",), "en": ("cinnamon",)}},
    {"key": "porridge_banana_chia", "meals": ("breakfast",), "tupper": False,
     "es": "Gachas de avena con plátano y chía", "en": "Porridge with banana and chia",
     "items": (("copos de avena", 50), ("leche semidesnatada", 250), ("proteína de suero en polvo", 30),
               ("plátano", 80), ("semillas de chía", 10)),
     "seasoning": {"es": ("canela",), "en": ("cinnamon",)}},
    {"key": "yogurt_mango_flax", "meals": ("breakfast",), "tupper": True,
     "es": "Yogur griego con mango, avena y lino", "en": "Greek yoghurt with mango, oats and flaxseed",
     "items": (("yogur griego desnatado", 250), ("mango", 120), ("copos de avena", 30), ("semillas de lino", 10),
               ("avellanas", 10)),
     "seasoning": {"es": (), "en": ()}},
    # ---- comidas
    {"key": "lentils_chicken_veg", "meals": ("lunch",), "tupper": True,
     "es": "Lentejas guisadas con pollo y verduras", "en": "Lentil stew with chicken and vegetables",
     "items": (("lentejas, cocidas", 220), ("pechuga de pollo, cruda", 130), ("zanahoria", 80), ("cebolla", 50),
               ("pimiento rojo", 60), ("aceite de oliva", 10)),
     "seasoning": {"es": ("pimentón", "laurel"), "en": ("paprika", "bay leaf")}},
    {"key": "rice_chicken_broccoli", "meals": ("lunch",), "tupper": True,
     "es": "Arroz integral con pollo y brócoli", "en": "Brown rice with chicken and broccoli",
     "items": (("arroz integral, cocido", 170), ("pechuga de pollo, cruda", 160), ("brócoli, cocido", 220),
               ("aceite de oliva", 10), ("pera", 150)),
     "seasoning": {"es": ("ajo en polvo", "limón"), "en": ("garlic powder", "lemon")}},
    {"key": "chickpeas_cod_spinach", "meals": ("lunch",), "tupper": True,
     "es": "Garbanzos con bacalao y espinacas", "en": "Chickpeas with cod and spinach",
     "items": (("garbanzos, cocidos", 180), ("bacalao fresco, crudo", 180), ("espinacas, crudas", 150),
               ("cebolla", 50), ("aceite de oliva", 10)),
     "seasoning": {"es": ("comino", "pimentón"), "en": ("cumin", "paprika")}},
    {"key": "pasta_tuna_courgette", "meals": ("lunch",), "tupper": True,
     "es": "Pasta integral con atún, tomate y calabacín", "en": "Wholemeal pasta with tuna, tomato and courgette",
     "items": (("pasta integral, cruda", 70), ("atún en conserva al natural, escurrido", 120),
               ("salsa de tomate", 150), ("calabacín", 150), ("aceite de oliva", 8), ("manzana", 150)),
     "seasoning": {"es": ("albahaca",), "en": ("basil",)}},
    {"key": "quinoa_salmon_asparagus", "meals": ("lunch",), "tupper": True,
     "es": "Quinoa con salmón y espárragos", "en": "Quinoa with salmon and asparagus",
     "items": (("quinoa, cocida", 180), ("salmón, crudo", 140), ("espárragos", 180), ("alcachofa", 100)),
     "seasoning": {"es": ("eneldo", "limón"), "en": ("dill", "lemon")}},
    {"key": "beef_sweet_potato_beans", "meals": ("lunch",), "tupper": True,
     "es": "Ternera con boniato y judías verdes", "en": "Beef with sweet potato and green beans",
     "items": (("lomo bajo de ternera, crudo", 160), ("boniato, asado", 180), ("judías verdes", 200),
               ("aceite de oliva", 8)),
     "seasoning": {"es": ("romero",), "en": ("rosemary",)}},
    {"key": "beef_chilli_beans", "meals": ("lunch",), "tupper": True,
     "es": "Chili de alubias rojas con ternera magra", "en": "Red bean chilli with lean beef",
     "items": (("alubias rojas, cocidas", 200), ("carne picada de ternera magra, cruda", 130),
               ("salsa de tomate", 150), ("pimiento rojo", 100), ("cebolla", 50), ("aceite de oliva", 6)),
     "seasoning": {"es": ("comino", "chile"), "en": ("cumin", "chilli")}},
    {"key": "couscous_chicken_veg", "meals": ("lunch",), "tupper": True,
     "es": "Cuscús con contramuslo de pollo y verduras", "en": "Couscous with chicken thigh and vegetables",
     "items": (("cuscús, cocido", 150), ("contramuslo de pollo, crudo", 150), ("calabacín", 100),
               ("pimiento rojo", 80), ("garbanzos, cocidos", 80), ("aceite de oliva", 6)),
     "seasoning": {"es": ("comino", "cúrcuma"), "en": ("cumin", "turmeric")}},
    # ---- cenas
    {"key": "hake_potato_salad", "meals": ("dinner",), "tupper": False,
     "es": "Merluza al horno con patata y ensalada", "en": "Baked hake with potato and salad",
     "items": (("merluza, cruda", 220), ("patata, cocida", 180), ("lechuga", 100), ("tomate", 120),
               ("aceite de oliva", 10), ("semillas de chía", 10)),
     "seasoning": {"es": ("perejil", "limón"), "en": ("parsley", "lemon")}},
    {"key": "egg_white_omelette_mushrooms", "meals": ("dinner",), "tupper": False,
     "es": "Tortilla de claras con champiñones y espinacas", "en": "Egg-white omelette with mushrooms and spinach",
     "items": (("huevo entero, crudo", 60), ("clara de huevo, cruda", 220), ("champiñones", 150),
               ("espinacas, crudas", 100), ("pan integral", 60), ("aceite de oliva", 8)),
     "seasoning": {"es": ("sal", "pimienta"), "en": ("salt", "pepper")}},
    {"key": "tofu_stir_fry", "meals": ("dinner",), "tupper": True,
     "es": "Salteado de tofu con verduras y arroz", "en": "Tofu stir-fry with vegetables and rice",
     "items": (("tofu firme", 220), ("brócoli, crudo", 150), ("pimiento rojo", 100), ("arroz integral, cocido", 100),
               ("salsa de soja", 15), ("aceite de oliva", 5)),
     "seasoning": {"es": ("jengibre",), "en": ("ginger",)}},
    {"key": "turkey_quinoa_courgette", "meals": ("dinner",), "tupper": True,
     "es": "Pavo a la plancha con quinoa y calabacín", "en": "Grilled turkey with quinoa and courgette",
     "items": (("pechuga de pavo, cruda", 180), ("quinoa, cocida", 150), ("calabacín", 200), ("aceite de oliva", 8)),
     "seasoning": {"es": ("tomillo",), "en": ("thyme",)}},
    {"key": "mackerel_roast_veg", "meals": ("dinner",), "tupper": False,
     "es": "Caballa al horno con verduras asadas", "en": "Baked mackerel with roast vegetables",
     "items": (("caballa, cruda", 160), ("berenjena", 150), ("pimiento rojo", 100), ("calabacín", 100),
               ("patata, cocida", 150), ("aceite de oliva", 10)),
     "seasoning": {"es": ("ajo", "perejil"), "en": ("garlic", "parsley")}},
    {"key": "squid_potato_salad", "meals": ("dinner",), "tupper": False,
     "es": "Calamar a la plancha con patata y rúcula", "en": "Grilled squid with potato and rocket",
     "items": (("calamar, crudo", 250), ("patata, cocida", 150), ("rúcula", 60), ("tomate", 120),
               ("aceite de oliva", 10), ("semillas de lino", 10)),
     "seasoning": {"es": ("ajo", "perejil"), "en": ("garlic", "parsley")}},
    {"key": "pork_artichoke_quinoa", "meals": ("dinner",), "tupper": True,
     "es": "Solomillo de cerdo con alcachofas y quinoa", "en": "Pork tenderloin with artichokes and quinoa",
     "items": (("solomillo de cerdo, crudo", 180), ("alcachofa", 150), ("quinoa, cocida", 120), ("aceite de oliva", 8)),
     "seasoning": {"es": ("romero",), "en": ("rosemary",)}},
    {"key": "salmon_broccoli_rice", "meals": ("dinner",), "tupper": True,
     "es": "Salmón al horno con brócoli y arroz integral", "en": "Baked salmon with broccoli and brown rice",
     "items": (("salmón, crudo", 150), ("brócoli, cocido", 220), ("arroz integral, cocido", 100), ("aceite de oliva", 5)),
     "seasoning": {"es": ("limón",), "en": ("lemon",)}},
    # ---- tentempiés
    {"key": "yogurt_walnuts_apple", "meals": ("snack",), "tupper": True,
     "es": "Yogur griego con nueces y manzana", "en": "Greek yoghurt with walnuts and apple",
     "items": (("yogur griego desnatado", 200), ("manzana", 150), ("nueces", 15)),
     "seasoning": {"es": ("canela",), "en": ("cinnamon",)}},
    {"key": "hummus_carrot_turkey", "meals": ("snack",), "tupper": True,
     "es": "Hummus con zanahoria y pavo", "en": "Hummus with carrot and turkey",
     "items": (("hummus", 40), ("zanahoria", 150), ("pechuga de pavo en lonchas", 100)),
     "seasoning": {"es": (), "en": ()}},
    {"key": "edamame_mandarin", "meals": ("snack",), "tupper": True,
     "es": "Edamame con mandarina", "en": "Edamame with mandarin",
     "items": (("edamame", 150), ("mandarina", 150), ("yogur griego desnatado", 125)),
     "seasoning": {"es": ("sal",), "en": ("salt",)}},
    {"key": "kefir_oats_strawberries", "meals": ("breakfast",), "tupper": True,
     "es": "Kéfir con avena, fresas y proteína", "en": "Kefir with oats, strawberries and protein",
     "items": (("kéfir", 250), ("copos de avena", 30), ("fresas", 150), ("proteína de suero en polvo", 20)),
     "seasoning": {"es": (), "en": ()}},
    {"key": "cottage_pear_almonds", "meals": ("snack",), "tupper": True,
     "es": "Queso cottage con pera y almendras", "en": "Cottage cheese with pear and almonds",
     "items": (("queso cottage", 200), ("pera", 150), ("almendras", 10)),
     "seasoning": {"es": (), "en": ()}},
    {"key": "rice_cakes_turkey", "meals": ("snack",), "tupper": True,
     "es": "Tortitas de arroz con pavo y tomate", "en": "Rice cakes with turkey and tomato",
     "items": (("tortitas de arroz", 20), ("pechuga de pavo en lonchas", 90), ("tomate", 100), ("manzana", 120)),
     "seasoning": {"es": ("orégano",), "en": ("oregano",)}},
    {"key": "yogurt_blueberries_pistachios", "meals": ("snack",), "tupper": True,
     "es": "Yogur griego con arándanos y pistachos", "en": "Greek yoghurt with blueberries and pistachios",
     "items": (("yogur griego desnatado", 200), ("arándanos", 100), ("pistachos", 15), ("semillas de chía", 5)),
     "seasoning": {"es": (), "en": ()}},
    {"key": "tuna_toast_cucumber", "meals": ("snack",), "tupper": True,
     "es": "Tostada integral con atún y pepino", "en": "Wholemeal toast with tuna and cucumber",
     "items": (("atún en conserva al natural, escurrido", 80), ("pan integral", 40), ("pepino", 100), ("aceite de oliva", 4)),
     "seasoning": {"es": ("pimienta",), "en": ("pepper",)}},
    {"key": "cottage_strawberries_chia", "meals": ("snack",), "tupper": True,
     "es": "Queso cottage con fresas y chía", "en": "Cottage cheese with strawberries and chia",
     "items": (("queso cottage", 200), ("fresas", 150), ("semillas de chía", 10)),
     "seasoning": {"es": (), "en": ()}},
)


# Pasos de batch de los platos de tupper (fase 12): (minutos, aparato, texto es, texto en). El
# aparato es uno de `kitchen.APPLIANCES`; el cronograma los reparte con el menaje del usuario.
# convention (FightLab): tiempos de cocina orientativos de estos platos de ejemplo, no evidencia.
_CHOP = (10, "hands", "Picar la verdura", "Chop the vegetables")
_RICE = (25, "pot", "Cocer el arroz, extenderlo y enfriarlo en menos de 1 h", "Cook the rice, spread it out and chill it within 1 h")
_GRAIN = (15, "pot", "Cocer el cereal y enfriarlo", "Cook the grain and chill it")
_PACK = (10, "hands", "Repartir en tuppers y etiquetar con plato y fecha", "Portion into boxes and label with dish and date")
BATCH_STEPS = {
    "lentils_chicken_veg": (_CHOP, (35, "pressure_cooker", "Guisar las lentejas con las verduras y el pollo", "Stew the lentils with the vegetables and chicken"), _PACK),
    "rice_chicken_broccoli": (_RICE, (12, "frying_pan", "Dorar el pollo", "Brown the chicken"), (8, "microwave", "Brócoli al vapor", "Steam the broccoli"), _PACK),
    "chickpeas_cod_spinach": (_CHOP, (20, "pot", "Sofrito con los garbanzos y las espinacas (el bacalao, el día de comer)", "Soffritto with the chickpeas and spinach (the cod on the day)"), _PACK),
    "pasta_tuna_courgette": ((15, "frying_pan", "Salsa de tomate con calabacín (la pasta, el día de comer)", "Tomato and courgette sauce (cook the pasta on the day)"), _PACK),
    "quinoa_salmon_asparagus": (_GRAIN, (15, "oven", "Salmón y espárragos al horno", "Bake the salmon and asparagus"), _PACK),
    "beef_sweet_potato_beans": ((30, "oven", "Asar el boniato", "Roast the sweet potato"), (12, "frying_pan", "Saltear la ternera con las judías", "Stir-fry the beef with the green beans"), _PACK),
    "beef_chilli_beans": (_CHOP, (40, "pot", "Guisar el chili con las alubias", "Simmer the chilli with the beans"), _PACK),
    "couscous_chicken_veg": (_CHOP, (15, "air_fryer", "Pollo y verduras en la air fryer (74 °C dentro)", "Air-fry the chicken and vegetables (74 °C inside)"), (5, "pot", "Hidratar el cuscús", "Soak the couscous"), _PACK),
    "tofu_stir_fry": (_CHOP, (12, "wok", "Saltear el tofu con las verduras", "Stir-fry the tofu with the vegetables"), _RICE, _PACK),
    "turkey_quinoa_courgette": (_GRAIN, (12, "frying_pan", "Dorar el pavo con el calabacín", "Brown the turkey with the courgette"), _PACK),
    "pork_artichoke_quinoa": (_GRAIN, (20, "oven", "Lomo y alcachofas al horno (63 °C dentro y 3 min de reposo)", "Roast the pork and artichokes (63 °C inside, 3 min rest)"), _PACK),
    "salmon_broccoli_rice": (_RICE, (15, "oven", "Salmón al horno", "Bake the salmon"), (8, "microwave", "Brócoli al vapor", "Steam the broccoli"), _PACK),
}
DEFAULT_BATCH_STEPS = ((20, "pot", "Cocinar el plato", "Cook the dish"), _PACK)


def batch_steps_for(name: str, lang: str) -> list[dict]:
    """Los pasos de batch de un plato de ejemplo por su nombre (en es o en), como `steps_batch`."""
    from coach.text import fold

    key = next((d["key"] for d in DISHES if fold(name) in (fold(d["es"]), fold(d["en"]))), None)
    steps = BATCH_STEPS.get(key, DEFAULT_BATCH_STEPS)
    text = 3 if lang == "en" else 2
    return [{"step": s[text], "min": s[0], "where": s[1]} for s in steps]
