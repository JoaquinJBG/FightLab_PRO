# Food products

> Part of FightLab's evidence annex. Rules for rating packaged supermarket products (phase 13: the private chain catalogue and the Open Food Facts products). Rules, not a literature review. Source IDs refer to sources.md in this folder. This content belongs to FightLab and is licensed CC BY 4.0; it is not part of ai-personal-coach. Every source was opened during research; EUR-Lex returned an empty page, so the regulation was read in the legislation.gov.uk copy of the text as adopted. Evidence checked on 2026-11-09.

## How to read this file

Grades are used as in combat-sports.md. These rules rest on public labelling schemes and law, not on outcome trials: the schemes say how to classify a product per 100 g, not what happens to someone who eats it. How FightLab combines them into good, fair, avoid, no data and not applicable is a FightLab convention and is labelled as such. The rating looks at 100 g or 100 ml, never at the portion eaten.

## Rating packaged products

### Rate packaged products with Nutri-Score and UK traffic lights
**Rule:** FightLab rates a packaged product from two public schemes. The Nutri-Score grade (A to E, 2023 algorithm) is taken as given by the user's file or by Open Food Facts; FightLab does not recompute it. The UK front-of-pack traffic lights colour sugars, saturates, salt and fat per 100 g for foods and per 100 ml for drinks, with high meaning above 22.5 g sugars, 5 g saturates and 1.5 g salt per 100 g for foods, and above 11.25 g, 2.5 g and 0.75 g per 100 ml for drinks. FightLab convention: good is Nutri-Score A or B with no red for sugars, saturates or salt (without a grade, only when all three are known and none is red); avoid is Nutri-Score D or E, a red for sugars or saturates, or two reds; fair is the rest; no data is no grade and a missing value; not applicable covers alcohol, soft drinks, coffee and tea, baby food, sweets, sweeteners and seasonings. The sugar of whole or dried fruit does not count as a red unless the name says sugar, syrup, chocolate or honey. Present the rating as a label reading per 100 g, not as a judgement on a portion or a diet.
**Evidence:** The UK guidance from the Department of Health and the Food Standards Agency (2016) gives, per 100 g of food, low at or below 3.0 g fat, 1.5 g saturates, 5.0 g sugars and 0.3 g salt, and high above 17.5 g, 5.0 g, 22.5 g and 1.5 g; per 100 ml of drink, low at or below 1.5 g, 0.75 g, 2.5 g and 0.3 g, and high above 8.75 g, 2.5 g, 11.25 g and 0.75 g. Energy is not colour coded. The sugar colour uses total sugars, and the guidance names milk and dried fruit among the sources of naturally occurring sugars. It also sets a red per portion (above 30% of the reference intake for foods in portions over 100 g, above 15% for drinks in portions over 150 ml); FightLab does not apply the portion criterion because its files give values per 100 g only. The Nutri-Score Scientific Committee updated the algorithm in 2022 for general foods and in 2023 for drinks; Open Food Facts documents a 2023 computation of the score alongside the older one during the transition.
**Grade:** moderate
**Applies to:** Packaged foods and drinks with a nutrition label, rated per 100 g or 100 ml. Not fresh loose produce, meat or fish without a label, and not a person's whole diet.
**Individual variation / conflicts:** Both schemes classify products, not people; a product rated avoid that is eaten in small amounts, such as a cured cheese in a sandwich, can fit a plan. The traffic light uses total sugars and cannot separate added sugar from the sugar of milk or fruit; the fruit exception is a FightLab convention that the guidance does not make. The Nutri-Score 2023 algorithm is applied from different dates in different countries, so older labels and some databases may still carry the earlier grade. The thresholds that combine the two schemes into good, fair and avoid are a FightLab convention with no outcome evidence behind them.
**Sources:** [F145], [F146], [F147]

### Rate oils, nuts and seeds by Nutri-Score alone
**Rule:** For oils, nuts and seeds, FightLab does not count the saturates traffic light and relies on the Nutri-Score grade. Without a grade such a product is rated no data, not good.
**Evidence:** The 2022 update report of the Nutri-Score Scientific Committee created a separate category for fats, oils, nuts and seeds. In it, the energy component is energy from saturates (one point per 120 kJ, up to 10 points), and saturates are scored as a share of total fat (0 points below 10%, 10 points at 64% or more), so oils and nuts whose fat is mostly unsaturated score better than under the general rule. The UK saturates light, by contrast, looks only at grams per 100 g and turns red above 5 g for olive oil and walnuts alike.
**Grade:** moderate
**Applies to:** Vegetable oils, nuts, seeds and nut butters, rated per 100 g (oils are labelled per 100 ml in some shops; FightLab keeps the unit of the label).
**Individual variation / conflicts:** The category treatment comes from the committee report, a technical consensus of the scheme's own authors, not from outcome trials. Detecting the category depends on the shop category, the Open Food Facts category tags or, without either, on words in the name, which can misclassify a product.
**Sources:** [F146], [F147]

### Flag labels whose energy does not match the macros
**Rule:** FightLab marks a product for review when its stated kcal per 100 g differ by more than 15% from 4 kcal per g of protein and carbohydrate, 9 per g of fat and 2 per g of fibre (differences under 8 kcal are accepted). The flag does not change the rating; it tells the user that the label or the file may hold an error. Products rated not applicable are not checked.
**Evidence:** Annex XIV of Regulation (EU) No 1169/2011 sets the energy conversion factors for labels: 4 kcal per g of carbohydrate (except polyols) and of protein, 9 kcal per g of fat, 2 kcal per g of fibre, 2.4 kcal per g of polyols, 7 kcal per g of alcohol and 0 for erythritol. The 15% margin and the 8 kcal floor are FightLab conventions taken from the user's own data checks, not from the regulation.
**Grade:** moderate
**Applies to:** Labels from the EU and the UK expressed per 100 g or 100 ml.
**Individual variation / conflicts:** Polyols, erythritol, alcohol and organic acids carry other factors, so sweeteners, sugar-free sweets and drinks with alcohol can be flagged although the label is right. Missing fibre on a label also inflates the gap for pulses.
**Sources:** [F148]
