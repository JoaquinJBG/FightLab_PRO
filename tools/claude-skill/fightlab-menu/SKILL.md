---
name: fightlab-menu
description: Use when the user asks for this week's FightLab menu, "menú de la semana", "prepárame el menú de FightLab", or to plan, check or upload a FightLab menu with their own Claude. Downloads their menu context from FightLab with their personal token, writes the `schema: 1` JSON, checks it with FightLab's engine and uploads it.
argument-hint: "[días, inicio, comidas, tupper]"
---

# fightlab-menu

Prepares a FightLab menu with the user's own Claude (their subscription: FightLab pays for no AI),
checks it with FightLab's engine and uploads it to their account. Every kcal and macro figure comes
from FightLab: never compute, estimate or round them yourself.

## Setup (once)

The helper is `fightlab_menu.py`, in this skill's base directory (shown when the skill loads).
It uses only the Python standard library. Run it with the first that works:
`python`, `py -3`, or `uv run --no-project python`. Below, `menu` means
`<python> "<skill dir>/fightlab_menu.py"`.

It needs two settings, which the user keeps on their own PC (never in a repository):

- `FIGHTLAB_URL`: the address shown in FightLab, Profile → My AI (it ends in `/api/ext`), or the
  file `~/.config/fightlab/url`.
- `FIGHTLAB_TOKEN`: their personal token (`flm_…`), or the file `~/.config/fightlab/token`.

If one is missing, the helper says so: tell the user to follow `docs/menus-con-tu-ia.md` of the
FightLab repository and stop. Never ask the user to paste the token into the chat, never write it
into a command line, a file in a repository or your reply.

## Steps

1. **What menu.** Unless the user said it, ask once: how many days (1 to 14, default 7), the
   start date (default: the day after their last menu), the meals (breakfast, lunch, dinner,
   snack) and which go in a lunchbox. Reply in the user's language.
2. **Context.** Run `menu context --days N [--start YYYY-MM-DD] [--meals a,b] [--tupper c] --out
   <temp dir>/fightlab-context.json` (a temporary directory, not a repository). If FightLab
   answers `no_calorie_targets` or `profile_incomplete`, tell the user what the app needs (the
   reasons it printed) and stop. Read the file: `instructions` are the rules, and the rest is the
   data (targets, tastes, recipes, kitchen, `foods` with values per 100 g or 100 ml,
   `avoid_dishes`, `recent_menus`, `chain_catalogue` and the `format` skeleton).
3. **Write the menu.** Follow `instructions` exactly. Use only food names from `foods`; never a
   food from `tastes.allergies` or `tastes.intolerances`; respect the diners' restrictions per
   meal and the kitchen equipment. Reuse dishes the user rated (`recipes`) and vary from
   `recent_menus`. Write the JSON object to `<temp dir>/fightlab-menu.json`, with
   `"id"` = `request.id`.
4. **Check.** Run `menu check <temp dir>/fightlab-menu.json --context <temp dir>/fightlab-context.json`.
   It lists each day with FightLab's totals and what is `under`, `over` or `missing`, unknown
   foods, repeated dishes and blocking tastes. Fix only what it names (swap a food, change grams
   using the engine's totals as the guide) and check again. Stop after 5 rounds and tell the user
   which days still fail and why.
5. **Show.** Give the user a short table: day, dishes per meal, and OK or not. Mention any note
   it printed (a disliked or untried food you kept, and why).
6. **Upload.** Run `menu upload <temp dir>/fightlab-menu.json`. If it says another menu already
   starts that day, ask the user whether to replace it; only after a clear yes, run it again
   with `--replace-start` (it says how many valid days the saved menu and the new one have).
   Uploading the same `id` again replaces that menu (what was ticked on the shopping list
   stays). FightLab only saves the days that meet the targets; if none does, it saves nothing,
   keeps the user's menu and lists why each day fails.
7. **Finish.** Tell the user it is in FightLab → Nutrition → Menu (marked "Your AI"), with the
   days that meet the targets. Delete the two temporary files.

## Rules

- The context is the user's personal data: keep it in the temporary directory, never commit it,
  never send it anywhere but FightLab.
- No free meal unless the user asks for one; if FightLab refuses it (`free_meal_refused`), drop it
  and tell the user plainly.
- Do not argue with an allergy or intolerance flag: replace the food.
- If the helper prints `ERROR:`, show that line to the user and stop.
