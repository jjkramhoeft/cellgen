# Game Resources and Trade: What Games Use, Why, and a Resource Set for the Generator

*Research date: 2026-11-10. Scope: the same question as `patch-resources.md` (what does the land give, and where), asked from a **game-design** point of view. §2 surveys how RPGs, grand strategy, 4X, RTS and city or colony builders choose, place, consume and trade resources. §3 distils a cross-game taxonomy and the typical resource counts. §4 collects the economic-geography ideas that games use or approximate (comparative advantage, transport cost, central places, von Thünen rings, location theory) and how designers applied them. §5 proposes a game-level resource set of 37 resources in three tiers for `sandboxes/sandbox4`, maps it onto the ~370 rows of `patch-resources.md` §4, assigns each to a level of the map hierarchy, and sketches deterministic models for "thriving", deliberate deficits, prices and flows. The constraint carried over from the earlier notes is that the map is infinite, lazily evaluated and bit-exact.*

**How to read the citations**

- Each claim cites the source that owns it, by key. The keys are listed in §7. For games, the order of trust is: developer material (manual, dev blog, dev diary, in-game encyclopedia), then the established community wiki that reads the game files (the Paradox wikis, the Factorio and RimWorld wikis), then everything else.
- **[unverified]** means the claim is general or bibliographic knowledge that was not checked against a primary text in this pass. Many fandom and wiki.gg wikis refused the fetch tool (§7.4), so several game descriptions in §2 rest on general knowledge and are marked accordingly.
- **[partially verified]** means the primary source exists and is cited, but only part of the claim was confirmed, for example from an abstract, a search-index excerpt, or a secondary source that quotes the primary.
- Wiki numbers are for the game version the wiki page states (for example EU4 1.30–1.31, Victoria 3 1.10–1.13). Games are patched often, so treat them as typical values, not current ones.
- The game-resource set in §5 and every "Design note" are my own engineering judgement, not sourced claims.
- Row numbers like `#343` refer to the catalogue in `docs/research/patch-resources.md` §4; `F1`–`F28` to its fantasy table (§5 there).

**Code locations used below** (working tree at commit `b94e28d`)

| Hook | File, lines | What it gives an economy pass |
|---|---|---|
| Map hierarchy | `sandboxes/sandbox4/src/world/world.ts` L1–30; `README.md` L67–71 | Regions on a 128 km lattice, elevation zones on 32 km, patches on 8 km. Patches are "also meant for towns, ore, factions"; elevation zones are "also meant for factions" |
| Resource catalogue | `docs/research/patch-resources.md` §4, §6, §7 | ~370 real resources with zone, biome and rarity columns; potentials vs deposits (§7.1); per-biome exports and imports (§6.3) |
| Coast | `src/world/rivers.ts` L237 (`isCoastPatch`) | Port candidates; sea transport |
| Dry flat zones | `src/world/rivers.ts` L272 (`isSparseFlat`) | Desert plains: salt flats, caravans |
| River flow | `src/world/rivers.ts` L139–145, L858–860 | `flow` = attractors reached upstream, a drainage-area proxy; parent links give downstream direction. Navigability and water power |
| Prosperity | `src/world/climate.ts` L8–9, L105–107 | A unitless 1–100 noise field "there for later use (settlements, roads)". §5.6 proposes deriving it from resources instead |
| Travel days | `README.md` L131 | Ruler: horse 32–48 km/day, marching legion 24–32, hiker 16–24 |
| Planned features | `README.md` "Resources", "City Locations", "Trade network" | All three marked "Not done yet"; trade network is to use "River, Ocean and roads" |

**Added since `b94e28d`** (lines at commit `397f779`)

| Hook | File, lines | What it gives an economy pass |
|---|---|---|
| Lakes | `src/world/lakes.ts` L57–82 (`Lake`), L189 (`get`), L237 (`lakeAt`); commit `4766597` | River-fed lakes per region, each with a host patch, area and the river's flow. Fish, reeds and lake transport; a lake on a navigable river extends it |
| Mangrove | `src/world/biomes.ts` L85, L90–95, L343; commit `dc52798` | Biome `mangrove` (MG) on warm, not-desert coasts of flat and lowland zones. Mangrove timber, charcoal and tannin bark; poor farmland |
| Coast per merged patch | `src/world/biomes.ts` L238 (`BiomeInfo.coastal`), L298 (`isCoastal`) | The coast test for a merged patch, cached with its biome |
| Supernatural | `src/world/climate.ts` L121–123 (`supernaturalAt`); commit `397f779` | A 0–100 noise field (10 km features) for magic. A ready input for the fantasy goods of `patch-resources.md` §5 |

---

## 1. Overview

Six findings shape everything below.

1. **Games use few resources, and give each one a job.** The genres differ in how many goods they show (4 in Age of Empires II, about 20 in Patrician IV, about 30 in EU4, about 50 in Civilization VI and Victoria 3), but each resource has one dominant role: feed people, build things, keep people content, field armies (§2, §3.3).
2. **Placement is a terrain or biome rule plus a hash.** Civilization places each resource on listed terrains and features; EU4 draws a province's trade good from weights modified by terrain and climate; CK3 restricts each economic building to listed terrains; Anno gives each island a random set of "fertilities" and fixed "lodes" (§2). The catalogue in `patch-resources.md` already supports this kind of rule.
3. **Deficits are designed in.** Anno makes "not every plant … grow on any island" (ANNO-S); Patrician IV lets each city produce only "4–5 goods for export" and gives each of 8 regions one product made nowhere else (P4); Victoria 3 shows how shortages cut output (V3-M). Trade exists because no place has everything.
4. **Trade is a graph with costs, not a free exchange.** EU4 routes trade value downstream through a fixed directed graph of nodes (EU4-T). Victoria 3 limits market access by infrastructure (V3-M). Humankind only counts a deposit if an unbroken supply path reaches the capital (HK). Bannerlord's villagers walk their goods to the nearest town (MB2-E, MB2-V).
5. **Prices are a clamped function of supply and demand.** Victoria 3 uses price = base × (1 + 0.75 × clamp((buy − sell) / min(buy, sell), ±1)) (V3-M); Patrician IV and Bannerlord describe the same idea in words (P4, MB2-E). This formula uses only + − × ÷ and a clamp, so it is bit-exact.
6. **The real geography gives the same structure for free.** Water transport is an order of magnitude cheaper than land (SMITH); places specialise by comparative, not absolute, advantage (RIC); land use forms rings by transport cost (THU); market centres form a hierarchy by threshold and range (CHR); weight-losing processing sits at the raw material (WEB). §5 builds the generator's economy on these rules.

---

## 2. What games do: a survey

### 2.1 Grand strategy and 4X

| Game | Resources (grouped) | Tiers | Placement on the map | Consumption | Trade |
|---|---|---|---|---|---|
| **Civilization VI** (Gathering Storm) | 11 **bonus** (Bananas, Cattle, Copper, Crabs, Deer, Fish, Maize, Rice, Sheep, Stone, Wheat); 34 **luxury** (incl. Salt, Silk, Spices, Furs, Ivory, Wine, Whales, plus 4 made only by corporations or city-states: Cosmetics, Jeans, Perfume, Toys); 7 **strategic** (Horses, Iron, Niter, Coal, Oil, Aluminum, Uranium); 2 artifacts (CIV6-R) | One tier: tile yields, no chains | Per-resource list of terrains and features: Wheat on Plains and (Desert/Plains) Floodplains; Silk on Woods; Iron on Hills variants of Desert, Grassland, Plains, Tundra; Niter on flat Desert, Grassland, Plains, Tundra and floodplains (CIV6-R) | Bonus: tile yield (Wheat +1 Food). Luxury: Amenities (Silk lists "+4 Amenities") (CIV6-R). Strategic: stockpiled; "Fuel" (Coal, Oil, Uranium) is burned for city Power, "Material" (Horses, Iron, Niter, Aluminum) pays for units; a mine gives "+2 Iron per turn" (CIV6-C, CIV6-R) | Diplomatic barter; consumables are bartered "as a lump sum" (CIV6-C). Trade routes are separate yield links between cities [unverified] |
| **Civilization V** | Bonus, luxury, strategic, same split | One tier | Terrain lists | Each *distinct* luxury gives empire-wide Happiness (+4 is the commonly cited value); extra copies add nothing except as trade goods; strategic tiles give a fixed *quantity* that caps how many units use it [partially verified: fan wiki and guides via search index] | Barter between civs |
| **Europa Universalis IV** | 31 trade goods: food (Grain, Fish, Livestock, Wine, Salt), materials (Naval supplies, Wool, Cloth, Copper, Iron, Tropical wood, Glass, Paper, Coal), colonial and luxury (Fur, Ivory, Spices, Cloves, Tea, Cocoa, Coffee, Cotton, Sugar, Tobacco, Dyes, Silk, Incense, Chinaware, Gems), Slaves, and Gold (EU4-TG) | One good per province; manufactories boost it | Each province produces **one** good. Colonies draw it from base weights × terrain and climate modifiers: Grain weight 35, excluded in desert, glacier, coastline, arctic; Wool 30, up in deserts, highlands, drylands, arid; Fur 15, excluded in tropical and arid, up with severe winters; Fish 20, needs a port; Naval supplies 15, up in forest, woods, hills, jungle; Salt 5, mostly deserts, marshes, mountains (EU4-TG) | No consumption by pops. Goods give trade value (production × price). Gold turns into ducats directly and causes inflation; mines can deplete. Price changes come from scripted events, e.g. Naval supplies +50 % with "Permanent Navies" (EU4-TG) | **Trade nodes**: a fixed directed graph; every land province belongs to one node; trade value flows downstream to end nodes (English Channel, Genoa, Venice). Countries split a node's value by **trade power**; merchants either *collect* (turn value into money) or *steer* (push it downstream). Provincial power 0.2 per development; estuary +10; centres of trade +5/+10/+25 (EU4-T) |
| **Crusader Kings III** | No tradable goods. Holdings give gold and levies; tribal "Wanua" holdings give Barter Goods (CK3-H) | Building chains per holding | Each barony's dominant **terrain** decides which economic buildings it can hold: Farmlands → farms and manor houses; Steppe → horse herds; Forest, Taiga, Jungle → forestry; Mountains, Desert Mountains → quarries; Wetlands → peat quarries; Desert, Drylands, Oasis → camelry, desert agriculture (CK3-B). Development −50 % in Desert, +20 % in Farmlands (CK3-H) | Gold, levies, development | None; specialisation is by terrain-locked buildings only |
| **Victoria 3** | 52 goods in 5 classes: 9 **staple** (Grain, Fish, Wood, Fabric, Clothes, Furniture, Groceries, Paper, Merchant Marine), 17 **luxury** (Meat, Fruit, Sugar, Tea, Coffee, Tobacco, Wine, Liquor, Opium, Porcelain, Gold, Fine art, Luxury clothes, Luxury furniture, Automobiles, Radios, Telephones), 18 **industrial** (Coal, Iron, Copper, Lead, Sulfur, Hardwood, Dye, Silk, Rubber, Oil, Glass, Tools, Steel, Engines, Fertilizer, Explosives, Clippers, Steamers), 5 **military**, 3 **local** (Services, Transportation, Electricity) (V3-G) | Buildings with 2–5 production methods each (V3-DD, partially verified) | Per-state resource potentials and arable land [unverified: not read in this pass] | Pops buy goods for 15 **needs** (Basic Food, Heating, Crude Items, Simple Clothing … Luxury Drinks, Leisure). Each need accepts several goods (Basic Food: Grain, Fish, Meat, Fruit, Groceries). Needs appear and fade with **wealth**: Simple Clothing disappears after wealth 14, Basic Food after 29; Luxury Items and Luxury Drinks start at 15 and grow "exponentially" (V3-N). Buildings consume industrial goods | One price per **market**: price = base × [1 + 0.75 × clamp((BUY − SELL) / min(BUY, SELL), ±1)], so 25–175 % of base. Shortage when buy ≥ 2 × sell: input-using buildings lose 5 % output, +1 %/day to −50 %. **Market access** = infrastructure / usage. Local price = MAPI × market price + (1 − MAPI) × state price. World trade via ports, trade centres and convoys (V3-M) |
| **Old World** | Stockpiled national yields (Food, Wood, Stone, Iron, plus Orders, Training, Civics, Science, Money) and luxuries [partially verified: search-index excerpt of the official wiki] | Improvements on tile resources | Tile resources [unverified] | Units and buildings cost the four material yields; luxuries go to cities, diplomacy and specialists [partially verified] | Money buys missing materials at a market [partially verified]. Designer Soren Johnson treats **Orders** as the scarce resource for issuing commands (OW-SJ) |
| **Humankind** | Strategic and luxury deposits, manufactured resources (Weapons, Pharmaceuticals) (HK) | Deposit → extractor; manufactories | Per era; "average and maximum vary by resource type, as does the rarity of deposits" [partially verified: developer reply quoted on forum] | **Access-based, not stockpiled.** One copy of a strategic resource lets you build; each missing copy raises the industry cost instead of blocking. Luxuries: a non-stacking *diversification* bonus for the first copy, smaller *cumulative* bonuses per copy, and a *wondrous* bonus from a manufactory (HK) | Resources travel by domestic trade routes, territory by territory, to the capital, and count only if the path is unbroken. Crossing neutral or foreign land exposes them to "poaching" (HK) |
| **Total War: Warhammer II / Three Kingdoms** | Trade resources tied to provinces (wine, timber, gems, salt, spices and similar) [unverified] | Resource buildings | Fixed per province on the campaign map [unverified] | Income | Trade agreements need capitals **connected by road or water**; a resource is only traded to a partner that lacks it; income depends on production, number of partners and base value [partially verified: fan wiki via search index] |

### 2.2 City, colony and trade builders

| Game | Resources (grouped) | Tiers | Placement | Consumption | Trade |
|---|---|---|---|---|---|
| **Anno 1800** | Old World and New World goods; Old World tiers farmers → workers → artisans → engineers → investors; New World jornaleros, obreros (ANNO-T, partially verified for the tier names) | Long chains; each tier unlocks more | **Fertilities**: crops grow only on islands with the matching fertility, "a simplification" of soil and weather; harder difficulty makes them rarer. **Lodes** (iron in mountains, clay pits) are fixed, random per game, and "won't deplete" (ANNO-S) | Each residential tier has needs; fulfilling them is the "core gameplay idea" and the tier threshold that unlocks buildings; each tier supplies its own workforce (ANNO-T) | Ships on trade routes between islands; scarcity is meant to drive "expansion, trade, diplomacy, and conflict" (ANNO-S). New World crops (coffee, cocoa, sugar, tobacco, cotton, rubber) exist only in the New World, so Old World luxury needs force inter-session trade [unverified] |
| **Anno 1404** | Occident and Orient; Occident luxury needs (spices, indigo and similar) are produced only in the Orient [unverified] | Chains of 2–4 steps [unverified] | Island fertilities, as in 1800 [unverified] | Needs tiers (peasants → citizens → patricians → noblemen) [unverified] | Ships; the Occident/Orient split is the designed complementarity [unverified] |
| **Patrician IV** | 20 goods. **Basic**: Wood, Bricks, Grain, Hemp, Wool, Metal, Honey, Salt. **Refinement**: Metal goods (2 Metal + 1 Wood), Mead (2 Honey), Clothing (1 Cloth). **Regional**: Beer, Stockfish (3 Hemp + 1.5 Salt), Cheese, Cloth (2 Wool), Pitch (1.5 Wood), Pelts (0.5 Hemp + 0.5 Metal goods), Meat (1.5 Salt), Wine. Spices are imported from outside the Hanse (P4) | 3 tiers | "There are 8 different regions … Each region features one product which can only be produced there." Each city "can only produce 4–5 goods for export" and imports the rest (P4) | Three citizen classes (poor, well-off, rich) each consume "a bit of each product daily" (P4) | Prices "determined by supply and demand": a city needing 200 barrels of grain with 50 in stock pays a high price, which drops as you deliver. All goods move by ship (P4) |
| **Mount & Blade II: Bannerlord** | Village goods (horses, fish, cheese, grain, …), town workshop goods (MB2-V, MB2-W) | Village raw → town workshop: Brewery grain → beer; Mill grain → flour; Olive press; Pottery clay → pottery; Smithy iron → weapons and armour; Tannery hides → leather; Weavery wool → cloth; Linen weaver flax → linen (MB2-W) | Villages choose among production types, but "the distribution … is based on the region of the village" (MB2-V, partially verified) | Each town spends a daily budget per goods category, scaled by prosperity; consumption raises food stores, productivity (tools), militia and garrison (MB2-E) | Villagers carry goods to their town; raiding villages or stopping peasants starves the town's workshops (MB2-V, partially verified). Prices are set per category per town from supply and demand; repeated purchases raise the price ("the next-best offer") (MB2-E). Workshops compete; a player can corner inputs or flood a market (MB2-W) |
| **Manor Lords** | Food (berries, game, crops), timber, stone, clay, iron and processed goods [partially verified: guides] | Short chains | Every region has deposits of each kind but in different amounts; one or two **rich** deposits per region (crown icon); iron deposits deplete unless deep-mined; per-crop fertility overlay [partially verified: guides via search index] | Burgage needs [unverified] | Trading post on the King's Road; trade routes cost Regional Wealth; regions cannot gift goods to each other [partially verified]. A proposed rework ties routes to locations so each city imports and exports a few goods, and a rival can be cut off from iron [partially verified: press summary of dev diary] |
| **Banished** | Food (crops, orchards, livestock, fish, game, gathered), logs, firewood, stone, iron, tools, clothing, herbs, alcohol [unverified] | 2 steps (log → firewood; iron + log → tools; leather or wool → coat) [unverified] | Map tiles: forests, stone and iron deposits [unverified] | Food, warmth (firewood), tools, clothing; no money [unverified] | **Barter only.** Merchants arrive by boat with small stocks, specialise (general, food, seed), and requested goods "will cost more" (BAN). The trading post is the only source of new seeds and livestock [partially verified] |
| **Farthest Frontier** | Food variety, firewood, tools, clothing, building materials; soil fertility per tile; ore deposits [unverified] | 2–3 steps | Per-tile fertility; deposits [unverified] | Needs tiers per house level [unverified] | Trading post with visiting traders [unverified] |
| **Frostpunk** | Coal, Wood, Steel, Raw food → Food rations, **Steam cores** (rare, found only by expeditions) [partially verified: Wikipedia and reviews via search index] | 1–2 steps | Fixed resource piles and deposits in the crater [partially verified] | Heat (coal → generator) is the binding need; generator upgrades consume more coal [partially verified] | None (scouting only) |
| **Settlers II / IV** | About 30 goods: wood → boards; stone; grain → flour → bread; pigs → meat; fish; coal + iron ore → iron → tools, weapons; gold → coins [unverified] | 3–4 steps | Ore, coal, granite and gold inside mountains, found by geologists; fish in water; trees regrow [unverified] | Mines need food; soldiers need weapons; tools let new workers start [unverified] | Carriers along a road-and-flag network; donkeys and ships add capacity. No prices [unverified] |
| **Age of Empires II** | 4 resources: Food, Wood, Gold, Stone [unverified] | None | Fixed patches: forests, gold and stone mines, berries, animals, fish; mines deplete [unverified] | Units, buildings, technologies | Market buys and sells at prices that move with each trade; trade carts between markets earn gold that grows with distance [unverified] |
| **Stronghold** | Wood, stone, iron, pitch; food (apples, cheese, meat, bread from wheat → flour); hops → ale; weapons and armour [unverified] | 2–3 steps | Map deposits (rock, iron, pitch); fertile grass for farms [unverified] | Popularity rises with food variety and ale coverage, falls with taxes [unverified] | Fixed-price market [unverified] |
| **Foundation**, **Songs of Syx** | Village and city builders with food, wood, stone, iron chains. Songs of Syx makes the capital depend on "villages, towns, lumber camps, castles and ports" and frames growth as "diplomacy, trade and war" (SOS) | — | — | — | Details not read in this pass |

### 2.3 Colony and RPG worlds

| Game | Resources | Tiers | Placement | Consumption | Trade |
|---|---|---|---|---|---|
| **Factorio** | Ores on Nauvis: iron, copper, coal, stone, uranium; crude oil (fluid); water (FAC) | Deep chains (ore → plate → intermediate → science pack) | **Patches**, tuned by frequency, size and richness. A fixed **starting area** always holds at least one patch each of coal, iron, copper and stone; outside it, richness grows with distance from spawn (FAC) | Factories, research | None (no trade partner) |
| **RimWorld** | Food (raw and meals), plant matter, five material kinds (woody, leathery, fabric, stony, metallic), medicine, crafted goods, exotic items (RW-R) | 2–3 steps | Ore veins in rock, biome-dependent plants and animals [unverified] | Colonists' food, comfort, work | Faction settlements (largest stock, restock ~30 days), land caravans, orbital traders. Colonies sell at about **60 %** and buy at about **140 %** of market value; Social skill improves this; some goods carry a 2× markup (RW-T) |
| **Dwarf Fortress** | Hundreds of materials; stone, ore, wood, plants, animals | Ore → smelter (needs fuel: charcoal or coke) → bars → forge [unverified] | Ores sit in specific geological layers (sedimentary, igneous, metamorphic) as veins, clusters and inclusions [unverified: wiki rate-limited] | Dwarf needs, military | Caravans once per season from civilisations; prices by material and quality [unverified] |
| **Kenshi** | Ores (iron, copper), stone, fabric, food crops; towns with regional price multipliers [unverified] | Ore → plates → weapons, armour [unverified] | Ore nodes; crops by biome fertility [unverified] | Hunger | Town shops with region-dependent prices [unverified] |
| **Skyrim** | Ore veins (iron, corundum, silver, gold, orichalcum, moonstone, quicksilver, malachite, ebony), alchemy ingredients [unverified: UESP refused] | Ore → ingot → smithing; ingredients → potions [unverified] | Veins in mines and caves; respawn after some days [unverified] | Crafting | Merchants with a limited gold purse that restocks; Speech skill moves the buy/sell spread [unverified] |

### 2.4 What the survey shows

- **Strategy games separate resources by job, not by realism.** Civilization VI's 52 resources sit in three jobs (yield, amenity, unit or power) (CIV6-R, CIV6-C). EU4 makes every good do one thing (trade value) and adds a few special effects (EU4-TG). Victoria 3 groups 52 goods into 15 needs, so pops care about *needs* and substitute between goods (V3-N).
- **City builders separate resources by chain position.** Patrician IV's three tiers (basic, refinement, regional) (P4), Bannerlord's village → workshop split (MB2-W) and Anno's tiers (ANNO-T) all make a short raw → processed → finished chain the unit of play.
- **Every game that wants trade gives places different endowments.** Anno: fertilities and lodes (ANNO-S); Patrician: regional products (P4); EU4: one good per province from terrain-weighted draws (EU4-TG); CK3: terrain-locked buildings (CK3-B); Bannerlord: regional village types (MB2-V).
- **Every game that simulates trade charges for distance or access.** EU4 by node graph and trade range (EU4-T), Victoria 3 by infrastructure-limited access and convoys (V3-M), Total War by road or sea connection (TW, partially verified), Humankind by unbroken supply paths (HK), Manor Lords by route cost (ML, partially verified).
- **Depletion is a design choice.** Anno 1800 dropped lode depletion "unlike in Anno 2070" (ANNO-S); EU4 gold mines can deplete (EU4-TG); Manor Lords' iron depletes unless deep-mined (ML). For a generated world that is a backdrop to play, non-depleting deposits with a yield class are simpler (Design note).

---

## 3. Common patterns and taxonomy

### 3.1 By game role

| Role | What it does in play | Examples | Real-world analogue (catalogue §) |
|---|---|---|---|
| **Basic / bonus** | Raises a local yield; not traded or barely traded | Civ VI bonus resources; EU4 Grain and Livestock; Banished food | Staple crops, pasture, fish (§4.1–4.7) |
| **Strategic** | Gates units, buildings or technology; hard or soft requirement | Civ VI Iron, Horses, Niter, Coal (CIV6-C); Humankind strategic deposits (HK) | Iron, copper and tin, horses, saltpetre, timber for ships (§4.5, §4.16) |
| **Luxury** | Contentment, growth or prestige; usually diminishing returns per copy | Civ V/VI luxuries; Humankind diversification bonus (HK); Victoria 3 luxury goods (V3-G) | Spices, silk, furs, wine, dyes, gems (§4.9–4.11, §4.17) |
| **Industrial / intermediate** | Input to another building | Victoria 3 industrial goods (V3-G); Patrician refinement goods (P4); Bannerlord workshop inputs (MB2-W) | Charcoal, iron bars, cloth, leather, lime |
| **Military** | Consumed by armies | Victoria 3 military goods (V3-G); Bannerlord arms for garrisons (MB2-E) | Arms, armour, horses, preserved food |
| **Money-like** | Converts directly to currency or causes inflation | EU4 Gold (EU4-TG); Victoria 3 Gold at a fixed price (V3-G) | Gold and silver (§4.16) |

### 3.2 By physical kind and by need

A second axis, the one city builders and Victoria 3 use, groups by what a good *is* and which need it serves:

| Kind | Needs it serves (Victoria 3 names, V3-N) | Typical deficit region |
|---|---|---|
| **Food** (staple, protein, perishable) | Basic Food → Luxury Food | Mountains, deserts, big cities |
| **Material** (timber, stone, clay, fibre) | Crude Items, Household Items; construction | Steppe and desert (timber), plains (stone) |
| **Fuel** (wood, charcoal, peat, dung, coal) | Heating; smelting, lime, pottery, salt boiling | Steppe, desert, tundra, deforested plains |
| **Metal** (iron, copper, tin, silver, gold) | Tools, arms; money | Everywhere without ore, i.e. most lowlands |
| **Preservative** (salt) | Food storage, herds | Humid inland regions |
| **Prestige** (spices, stimulants, furs, dyes, gems, fine cloth) | Stimulants, Luxury Drinks, Luxury Items | Everywhere outside their climate belt |

**Needs tiers.** Victoria 3 makes the tiers explicit with wealth thresholds: subsistence needs (Basic Food, Simple Clothing, Crude Items) appear first and fade as wealth rises; constant needs (Heating, Intoxicants) grow and level off; luxury needs (Luxury Items, Luxury Drinks, Luxury Food, Services, Leisure) start at wealth 15–20 and grow faster as wealth rises (V3-N). Anno does the same by residential tier (ANNO-T), Patrician IV by three citizen classes (P4).

**Chain depth.** Strategy games mostly stop at one step (Civilization, EU4, Old World). Trade simulators use two or three: Patrician IV's deepest chain is wool → cloth → clothing (P4); Bannerlord's workshops are all one step (MB2-W). Factory games go deep (Factorio). The Kaiserpunk team "opted to limit the number of input resources for a single output" but placed "no limitation … on how long a production chain can be" (KP). **Design note:** for a world generator, depth 3 (raw → intermediate → finished) is enough to place every processing site, and a cap of 2–3 inputs per output keeps chains readable.

### 3.3 Typical counts

| Game | Player-facing resource or goods count | Grouping |
|---|---|---|
| Age of Empires II | 4 [unverified] | none |
| Old World | 4 material yields + luxuries [partially verified] | 2 |
| Frostpunk | ~6 [partially verified] | none |
| Patrician IV | 20 (8 basic, 3 refined, 8 regional, spices) (P4) | 3 tiers |
| EU4 | 31 (EU4-TG) | 1 tier, 4–5 informal groups |
| Settlers II | ~30 [unverified] | chains |
| Civilization VI (GS) | 52 + 2 artifacts (CIV6-R) | 3 classes |
| Victoria 3 | 52 (V3-G) | 5 classes × 15 needs |
| Anno 1800 | 100+ [unverified] | per tier and per world |

**Why designers keep the number down.** Few designers state a number in public, but the sources agree on the reasons:

- Each resource must create a decision. Sid Meier's GDC 2012 talk revisits his definition of a game as a series of interesting decisions (GDC-SM; the talk itself was not watched, [partially verified: session listing and press]). A resource that never changes a choice is noise.
- Amplitude reworked Humankind to "diminish the effect an abundance or scarcity of any given resource will have", and centralised trade to keep it "readable" (HK).
- Victoria 3 hides 52 goods behind 15 needs and substitution (V3-N): the player reasons about needs, the simulation about goods.
- Working memory holds only a handful of items at once: Miller 1956 ("seven, plus or minus two") and Cowan 2001 (about four chunks) [unverified: not read in this pass]. That supports **6–8 visible categories** even when there are 30–50 goods underneath.

**Design note.** Two numbers follow: about **6–8 groups** the player thinks in, and **20–40 goods** the simulation tracks. §5 uses 7 groups and 37 goods.

### 3.4 Scarcity by design

| Technique | Game example | Effect |
|---|---|---|
| Endowment lists per terrain or biome | Civ VI terrain lists (CIV6-R); CK3 terrain buildings (CK3-B) | Places differ predictably |
| Weighted random draw with terrain multipliers | EU4 colony goods (EU4-TG) | Variety within a climate |
| One unique product per region | Patrician IV (P4) | Guarantees at least one export per region |
| Few export goods per place | Patrician IV "4–5 goods for export" (P4); Manor Lords proposal (ML) | Guarantees imports |
| Missing-world goods | Anno: Old World luxuries grown only in the New World [unverified]; Patrician spices from outside the Hanse (P4) | Long-distance luxury trade |
| Safe start, rich frontier | Factorio starting area always has coal, iron, copper and stone; richness grows with distance (FAC) | Basics nearby, wealth far away |
| Rarer with difficulty | Anno fertilities and lodes (ANNO-S) | A tuning knob |
| Soft gating | Humankind: a missing copy raises cost instead of blocking (HK) | Deficits hurt, never stall |

---

## 4. What makes regions thrive and trade believable

### 4.1 Comparative advantage (Ricardo 1817)

Ricardo's example: England needs the labour of 100 men a year for its cloth and 120 for its wine; Portugal needs 90 and 80. Portugal is better at both, yet both gain if England makes cloth and Portugal wine (RIC, ch. 7). Trade follows *relative* cost, not absolute.

- **In games.** Anno's fertilities and Patrician's regional goods give absolute advantages (one place can, the other cannot) (ANNO-S, P4). Comparative advantage appears when every place *can* make most things, but at different costs: Bannerlord's regional village types (MB2-V) and CK3's terrain-limited buildings (CK3-B) come closest.
- **Design note.** The catalogue's potentials (§7.1 there: suitability 0–1 per patch) already give relative costs. A region exports what its potential is *relatively* best at, measured by a location quotient (§5.5), even when a neighbour is better at everything.

### 4.2 Transport cost: water beats land

- Adam Smith: a broad-wheeled waggon with two men and eight horses takes about six weeks to carry near four tons between London and Edinburgh; a ship with six or eight men carries "two hundred ton weight" between London and Leith in about the same time (SMITH, Book I ch. 3). Per ton, the land route needs about 12–17 times the crew (0.5 men per ton against 0.03–0.04), before counting eight horses.
- ORBIS (Scheidel): in the Roman network "cost, rather than distance, is the principal determinant of connectivity"; the model prices road (14 modes), river (25 rivers, dearer upstream) and sea (wind- and season-dependent) separately (ORBIS-15). Scheidel 2013 shows the sea-freight ceilings in Diocletian's Price Edict track simulated sailing days (ORBIS-13).
- The widely repeated Roman sea : river : land cost ratio of about **1 : 5 : 28** is attributed to ORBIS or the Price Edict, but I could not find it in Scheidel's own text [unverified].
- Masschaele 1993 finds 14th-century English land carriage about **twice** the cost of river carriage, cheaper than often assumed [partially verified: secondary summaries; the article is paywalled].

**Design note.** Use mode costs per km of roughly **sea 1, river downstream 2–3, river upstream 4–6, road 10–20, trackless land 20–40**. The ratios matter more than the values; keep them as parameters.

### 4.3 Location theory: where processing happens (Weber 1909)

Weber's *material index* is the weight of the localised inputs divided by the weight of the product. Above 1, the plant moves to the raw material; below 1, to the market (WEB, via Rodrigue's *Geography of Transport Systems* §2.3, which calls transport "the most important element of the model").

- Smelting, charcoal-making, salt boiling and lime-burning lose weight, so they sit at the ore, forest, brine or limestone. Brewing and baking add water or need freshness, so they sit at the market.
- **In games.** Patrician IV's salter consumes 4 wood a day per 4 salt (P4): a fuel-hungry, weight-losing step. Bannerlord puts the smithy in town and the iron in villages (MB2-W), which is a game simplification of the opposite rule.

### 4.4 Rings around a market (von Thünen 1826)

Von Thünen's isolated city on a uniform plain gets concentric land-use rings because rent falls with distance: **R = Y(p − c) − Y f m**, with yield Y, price p, cost c, freight rate f and distance m (THU, via Rodrigue). Perishable and heavy goods (market gardening, milk, firewood) take the closest land; extensive uses (field crops, then ranching) lie farther out; ranching is last because animals walk to market [partially verified: Rodrigue gives the formula and the near-market examples; the exact ring order is from secondary summaries].

- **Design note.** Two direct uses: (1) perishable food (produce, milk) should not be tradeable beyond a zone; (2) firewood and timber are bulk goods that only travel by river or sea beyond a day's haul. Timber deficits around big cities are realistic.

### 4.5 Central places, market towns and fairs (Christaller 1933)

- **Threshold** is the smallest market that makes a good or service viable; **range** is the farthest distance consumers travel for it. Higher-order places offer more goods, are fewer and lie farther apart (CHR, Britannica; Rodrigue).
- Christaller's K = 3 (marketing) system nests three lower-order market areas in each higher-order one; the K = 4 (transport) system puts lower-order centres on the roads between higher ones; K = 7 is administrative [partially verified: Rodrigue gives K = 3 and K = 4; K = 7 from secondary sources]. His scheme had seven orders, from the small market town (*Marktort*, ~1,000 people) to the regional capital (*Landstadt*, >500,000) [partially verified: quoted in Rodrigue via search index].
- Skinner applied the model to rural China: periodic market towns each serve a **standard marketing area** of about 18 villages, ideally in two hexagonal rings of 6 and 12; markets met from every other day to once in ten days (SKIN) [partially verified: secondary summaries].
- Market fairs (for example the Champagne fairs) concentrated long-distance trade at a few times and places [unverified].
- **In games.** EU4's trade nodes are a coarse hierarchy: provinces feed a node, nodes feed downstream nodes, and end nodes collect (EU4-T). Bannerlord's villages feed one town each (MB2-V). Manor Lords' regions are separate economies joined by routes (ML).

### 4.6 Core and periphery (Krugman 1991)

With low transport costs, strong economies of scale or a large manufacturing share, manufacturing concentrates in one region (the core) and the other stays agricultural (the periphery); with high transport costs it spreads evenly (KRU) [partially verified: NBER working-paper abstract]. **Design note:** a pre-industrial world with expensive land transport should have many small manufacturing towns, with concentration only at sea and river hubs.

### 4.7 Complementarity and universal deficits

The catalogue's §6 already lists the classic pairs: steppe livestock ↔ farmland grain, mountain metal and stone ↔ lowland food, forest timber, furs and tar ↔ salt and cloth, tropical spices ↔ salt and iron. Three goods are short almost everywhere:

| Good | Why it is short | Sources (catalogue rows) |
|---|---|---|
| **Salt** | Needed by people and herds, and for preserving; produced only on dry warm coasts, playas, salt beds and brine springs | #166–171 |
| **Iron** | Ore is common but smelting needs ore **and** fuel in one place | #343–347 + #323–324 |
| **Timber and fuel** | Absent in steppe, desert, tundra and around large towns; heavy, so only moves by water | #247–278, #323–330 |

These are general claims from economic history (for example Braudel's *Structures of Everyday Life*) that were not checked in this pass [unverified].

### 4.8 Carrying capacity and the food surplus

A place grows beyond a village only if its farmers produce more food than they eat, and towns are fed from their hinterland. Boserup 1965 argues the reverse causation too: population pressure drives agricultural intensification [unverified]. **In games** this is the Anno and Victoria 3 rule that a tier's needs must be met before it grows (ANNO-T, V3-N), and Bannerlord's town food stores filled by village deliveries (MB2-E).

### 4.9 How games approximate these ideas

| Idea | Game approximation | Simplification |
|---|---|---|
| Comparative advantage | Terrain-weighted endowments (EU4-TG, CK3-B) | Usually absolute advantage, not relative cost |
| Transport cost | Trade range, node graph (EU4-T); infrastructure access (V3-M); road or water connection (TW) | Binary (connected or not) or one scalar |
| Central places | Village → town (MB2-V); province → node (EU4-T) | One or two levels, fixed |
| Von Thünen | Fertility falls off around a town only implicitly; Manor Lords and Banished place fields near storage [unverified] | Mostly absent |
| Weber | Processing building placement left to the player | Absent from the simulation |
| Price formation | Clamped supply/demand ratio (V3-M); per-town budget (MB2-E); stock vs need (P4); fixed spread (RW-T) | Local, smooth, bounded |

---

## 5. Recommendation for the generator (Design note)

Everything in §5 is my own design, built on the sources above and on the catalogue. Numbers are starting calibrations.

### 5.1 Principles

1. **Two layers.** The catalogue's ~370 rows stay as the *realism layer*: they decide *what* a patch holds and give names and flavour ("this valley's grain is rye"). A smaller *game layer* of 37 resources is what settlements, prices and trade use. Each catalogue row maps to exactly one game resource (§5.3).
2. **Seven groups for the player.** Food, Materials, Fuel, Metals, Salt, Luxuries, Animals. The player reasons in groups; the simulation tracks resources (§3.3).
3. **Three tiers.** Raw (from the land), intermediate (one processing step, placed by Weber's rule), finished (consumed by people and armies). At most 3 inputs per output (§3.2, KP).
4. **Potentials, deposits, enablers.** As in the catalogue §7.1: potentials are suitability scores every patch has; deposits are rare hashed point resources; enablers (river, coast, harbour, water power) multiply both.
5. **Deterministic and local.** Every value is a pure function of the seed, the parameters and a bounded neighbourhood, using only + − × ÷ and comparisons (bit-exactness rule, `biomes-and-climate.md` §7).

### 5.2 The game resource set (37)

**Tier 1, raw (23).**

| Group | Game resource | Kind | Value | Notes |
|---|---|---|---|---|
| Food | **Grain** | Potential | Bulk | Storable staple; the main traded food |
| Food | **Produce** | Potential | Subsistence | Roots, pulses, vegetables; perishable, not traded beyond its zone (§4.4) |
| Food | **Orchard** | Potential | Bulk/Trade | Olive, vine, dates, fruit, nuts, palms; feeds Drink & oil |
| Food | **Livestock** | Potential | Bulk | Meat, milk, hides, wool; the pastoral staple |
| Food | **Fish** | Potential | Bulk | River and sea |
| Food | **Wild food & game** | Potential | Subsistence | Forage, hunting; carrying capacity for thin populations; not traded |
| Materials | **Timber** | Potential | Bulk | Construction, ships, charcoal |
| Materials | **Stone** | Deposit (common in Hi/Mo) | Bulk | Quarries; deficit in flat land |
| Materials | **Clay & earth** | Potential | Bulk | Bricks, pottery, adobe; nearly everywhere |
| Materials | **Fibre** | Potential | Bulk/Trade | Flax, hemp, cotton, jute |
| Fuel | **Fuel** | Potential + deposit (coal, peat) | Bulk | Firewood, peat, dung, coal |
| Salt | **Salt** | Deposit (coast potential in dry warm climates) | Trade | Deliberately sparse |
| Metals | **Iron ore** | Deposit | Bulk | Bog, laterite, ironstone, mountain ores |
| Metals | **Copper ore** | Deposit | Trade | |
| Metals | **Tin** | Deposit | Trade/Luxury | Very rare; never with copper (§5.5) |
| Metals | **Silver & lead** | Deposit | Luxury | |
| Metals | **Gold** | Deposit (placers along rivers) | Luxury | Money-like |
| Luxuries | **Gems & pearls** | Deposit | Luxury | |
| Luxuries | **Spices & incense** | Potential (Tr, TS, DF, RF) | Luxury | |
| Luxuries | **Stimulants & sugar** | Potential (hiT, Te-w, Tr) | Trade/Luxury | Tea, coffee, cacao, tobacco, sugar, honey (Victoria 3 puts sugar under Stimulants, V3-N) |
| Luxuries | **Furs & ivory** | Potential (Bo, Sp, TU, SV) | Luxury | |
| Luxuries | **Dyes** | Potential / deposit | Trade | |
| Animals | **Horses & pack animals** | Potential (GR, CS, HD, CD) | Strategic | Cavalry, caravans, ploughs |

**Tier 2, intermediate (8).** Placed where the material index says (§4.3).

| Resource | Inputs | Placed at | Why it matters |
|---|---|---|---|
| **Charcoal** | Timber | Forest patch | Turns timber into smelting fuel; deforests over time (optional) |
| **Iron** | Iron ore + Fuel (charcoal) | Where ore and fuel are within a short haul | Iron needs two places, so it creates trade |
| **Bronze** | Copper ore + Tin + Fuel | Copper or tin site, or a trade hub | Long-distance tin route |
| **Cloth** | Fibre or Livestock (wool) | Fibre or flock zone; water power (#379) bonus | Main manufactured trade good (catalogue §6.1) |
| **Leather** | Livestock + tannin (oak, acacia, mangrove bark) | Pastoral zone with tannin | Pairs steppe with forest |
| **Bricks & lime** | Clay or limestone + Fuel | Clay or limestone site | Turns fuel into building material |
| **Preserved food** | Fish or Livestock + Salt | Fishing coasts, dairy zones | The main salt sink |
| **Naval stores** | Timber (pine, larch, fir) | Conifer forest near water | Ships; a classic boreal export |

**Tier 3, finished (6).** Consumed by needs (§5.4).

| Resource | Inputs | Typical site |
|---|---|---|
| **Tools** | Iron + Timber | Market towns |
| **Arms & armour** | Iron (or Bronze) + Timber + Leather | Towns, fortresses |
| **Clothing** | Cloth + Leather | Towns |
| **Drink & oil** | Grain (ale) or Orchard (wine, olive oil) | At the market (water-adding, §4.3) or at the orchard (wine, oil) |
| **Fine goods** | Gold/Silver or Gems or Dyes + Cloth (silk) or kaolin | Cities (high threshold, §4.5) |
| **Coin** | Silver or Gold | Capitals (optional; a money supply) |

Optional **fantasy layer** (toggle): three game resources over the catalogue's F1–F28. *Star metal* (F1, F2, F13) behaves like a strategic metal; *Arcane reagents* (F3, F6, F8, F9, F10, F17, F18, F19, F25, F26) like a luxury; *Wonder materials* (F5, F11, F12, F14, F15, F16, F20–F24, F27) like fine goods. F4 and F28 are site enablers, not goods. They inherit their real parent's placement, as the catalogue recommends.

### 5.3 Mapping: game resource ← catalogue rows ← map rules

Zone, biome and belt codes as in `patch-resources.md` §4.0. "Level" says where the value is computed (§5.4).

| Game resource | Catalogue rows | Placement rule (from the catalogue's conditions) | Level |
|---|---|---|---|
| Grain | #1–18 | Max ECOCROP trapezoid over the grain crops that fit `t`, `p`, `height`; floodplain and river irrigation bonus; best in Fl, Lo | Patch potential → zone sum |
| Produce | #19–46 | Same, over roots, pulses, vegetables | Patch potential (zone-local only) |
| Orchard | #47–78, #35–39 (oilseeds) | Tree-crop trapezoids; olive and vine in WS, BL Te-w; dates in HD, TS with `riv`; palms on Tr `cst` | Patch potential |
| Livestock | #94–97, #102–104, #106, #108–112 | Pasture by biome: GR, CS, SV, WS, Hi, Mo; yak and camelids by height; poor in RF, TA, IC | Patch potential |
| Fish | #143–155, #165 | River `flow` above a threshold; `cst`; ocean-zone adjacency; cold shelf and upwelling bonuses; a lake in the patch (`Lake.patch`, by area; #147); crabs and oysters in MG (#153) | Patch potential |
| Wild food & game | #79–93, #113–121 | Forest and tundra biomes; low on farmed land | Patch potential |
| Timber | #247–278 | Forest biomes (TA, MF, BL, TR, DF, RF); mangrove poles in MG (#276); thin in WS, SV; none in HD, CD, GR, CS, TU, IC | Patch potential |
| Stone | #294–307 | Common deposit in Hi, Mo; uncommon in Lo; rare in Fl (glacial boulders only) | Patch deposit |
| Clay & earth | #291–293, #308–309 | Fl, Lo, `fp`; kaolin (#309) as a rare deposit | Patch potential |
| Fibre | #212–226 | Flax, hemp in MF, BL, GR; cotton in SV, TS (irrigated), DF; jute on tropical `fp` | Patch potential |
| Fuel | #323–330, #286 | Wood in forests; mangrove charcoal in MG (#276); peat in Bo/Te Hu–PHu flats (*peat bog*); dung in CS, GR, CD, Mo; coal as a deposit on *clastic basin* | Potential + deposit |
| Salt | #166–171 | Solar salt on `cst` in Ar–SAr warm belts; playa salt in `isSparseFlat` Arid zones; rock salt and brine on *evaporite* bedrock | Patch deposit |
| Iron ore | #343–347 | Bog iron in TA, MF, BL wet flats; laterite in RF, SV, DF; skarn and BIF by bedrock | Patch deposit |
| Copper ore | #337–340, #365 | Mo, Hi; *volcanic arc*, *ophiolite*, *clastic basin* | Patch deposit |
| Tin | #341–342 | VR lode on *granite intrusion*; stream tin downstream along rivers | Patch deposit (river-propagated) |
| Silver & lead | #336, #348–350 | Mo, Hi; *fold belt*, *carbonate platform* | Patch deposit |
| Gold | #332–335 | Placers where the river leaves Mo/Hi zones (catalogue §7.3 placer rule); lodes in Mo | Patch deposit (river-propagated) |
| Gems & pearls | #159–162, #363–376 | VR deposits by bedrock; pearls on warm `cst` | Patch deposit |
| Spices & incense | #177–190, #198, #200–211 | RF, DF lowland; incense in TS, HD uplands | Patch potential (rare) |
| Stimulants & sugar | #107, #174–175, #191–197 | Tea and coffee in `hiT`; cacao in RF; tobacco in BL Te-w; sugar cane on Tr `fp`; honey widespread (low value) | Patch potential |
| Furs & ivory | #122–139, #142 | Furs in TA, TU, MF; ivory in SV, RF, DF and on polar coasts | Patch potential |
| Dyes | #156–158, #161, #230–239 | Woad, madder in Te; indigo in Tr; cochineal, kermes, murex rare | Potential / deposit |
| Horses & pack animals | #98–101, #105 | GR, CS (horses); HD, CD (camels); Mo (mules) | Zone aggregate |
| Enablers (not goods) | #378–385 | River, navigable river, water power, springs, aquifer, harbour; a lake (`Lake.patch`) as fresh water and a sheltered landing | Patch flags |

Tanning bark (#241–245, including mangrove bark #243 in MG), resins (#205), plant ash (#320) and limestone (#297) feed the intermediates and need no separate game resource.

### 5.4 Which level of the hierarchy owns what

| Level | Size | Owns | Economic analogue |
|---|---|---|---|
| **Patch** (8 km, ~50–65 km²) | ~1 village and its fields | Potentials (0–1 per raw resource), 0–3 deposit slots, enabler flags | A village territory: walking distance to fields |
| **Elevation zone** (32 km, ~16 patches, ~1,000 km²) | Half a day's walk from centre to edge (hiker 16–24 km/day, `README.md` L131) | Production profile (sum of patch outputs), population capacity, the **market town** (lowest central place), processing sites (Weber) | A market area (§4.5), and the unit Bannerlord and EU4 attach goods to (one village type; one province good) |
| **Region** (128 km, ~16 zones) | 3–4 days by horse across | **Trade balance**, prices, the **city** (higher central place), its signature export, river systems (computed per region already) | A city's hinterland; an EU4 trade node |
| **Neighbourhood of regions** (k-ring, k = 1–2) | | Price formation and flows (§5.7) | The market reach |

Rules of thumb:

- **Settlement need (zone).** A zone supports a market town when its food surplus feeds at least a threshold population (Christaller's threshold, §4.5).
- **Processing (zone).** Put each intermediate in the zone that holds both inputs within one zone step, by the material index (§4.3).
- **Trade (region).** Balances and prices live at region level, so the map's existing per-region computations (rivers, terrain fill) set the locality.

### 5.5 Making regions thrive, and making trade inevitable

**Thriving.** A region thrives when it meets four basic needs and has one export.

| Need | Satisfied when (per region, per year) | Source of the idea |
|---|---|---|
| Food surplus | Grain + Produce + Livestock + Fish + Wild food ≥ 1.2 × population need | §4.8; Anno/Victoria needs (ANNO-T, V3-N) |
| Building material | Timber or Stone or Clay & earth within the region | Catalogue §6.1 |
| Fuel | Fuel ≥ heating need (scaled by belt: none in Tr, high in Bo) + smelting need | §3.2; Victoria 3 Heating (V3-N) |
| Salt | Salt within the market reach (§5.7) | §4.7 |
| One export | A tradeable resource with location quotient LQ ≥ 1.5 | §4.1; Patrician regional goods (P4) |

A possible score that could replace or feed the `prosperity` noise field (`climate.ts` L105–107):

```
thrive = min(foodRatio, fuelRatio, 1) × (materialOK ? 1 : 0.5) × (saltOK ? 1 : 0.7)
       × (1 + exportValue / population) × access
access = 1 + 0.5 × coast + 0.5 × navigableRiver    (all + − × ÷)
```

**Location quotient.** For resource r and region R: LQ = (S_rR / S_R) / (S_r* / S_*), where * is the expected share over the world. The map is infinite, so compute the world shares once from a fixed calibration window (like the fixed parameter baseline of the sandbox4 tests, commit `5c506dd`) and store them as constants.

**Guaranteeing trade.** Six rules, each a check the generator can test:

1. **Salt is sparse.** Tune salt probabilities so that at least half of all regions have no salt deposit (test on a fixed window). Inland humid regions must import it.
2. **Iron needs two inputs.** Iron ore deposits are common in some biomes, but iron bars need Fuel in the same or the next zone. Treeless ore regions export ore; forest regions without ore import it.
3. **Bronze needs two distant metals.** Copper and tin come from different bedrock classes (volcanic arc or ophiolite vs granite intrusion; catalogue §7.3), so no zone has both. Tin stays very rare.
4. **Luxuries are climate-locked.** Spices only in the tropical belt, furs in boreal and subpolar, stimulants in tropical highlands and warm temperate. The temperature field's feature size (110 km by default, `biomes-and-climate.md` code table) makes belts change over a few regions, so luxuries are typically 2–5 regions from their consumers.
5. **Every region has a signature export.** If no tradeable resource reaches LQ ≥ 1.5, raise the hashed draw of one deposit or potential in that region until one does (the Patrician rule, P4). Mark it in the inspector.
6. **Every region has a deficit.** Check that each region lacks at least one of {Salt, Iron, Timber, Fuel, Stone, a luxury}. With rules 1–4 this holds almost always; the check documents it.

### 5.6 Needs tiers for settlements

| Tier | Settlement | Needs (game resources) | Analogue |
|---|---|---|---|
| Subsistence | Village (patch) | Grain or Produce or Livestock or Fish or Wild food; Fuel; Salt; Clay & earth or Timber or Stone | Victoria 3 Basic Food, Heating, Crude Items (V3-N) |
| Comfort | Market town (zone) | + Tools, Clothing, Drink & oil, Preserved food, Bricks & lime | Victoria 3 Standard Clothing, Household Items, Intoxicants |
| Luxury | City (region) | + Spices & incense, Stimulants & sugar, Furs & ivory, Dyes, Fine goods, Horses | Victoria 3 Luxury Drinks, Luxury Items |
| Military (any) | Garrisons, armies | Arms & armour, Horses, Preserved food; Naval stores and Timber for fleets | Bannerlord garrison and militia (MB2-E); Civ VI Material resources (CIV6-C) |

Use substitution as Victoria 3 does: a need accepts any good in its list (V3-N). That keeps 37 resources from turning into 37 separate shortages.

### 5.7 Price and flow models for a deterministic, lazy map

The full spatial equilibrium (every market's price depends on every other market's) is global, so it does not fit a lazily evaluated, order-independent infinite map. Two local models do.

**Model A: market-potential price (single pass, order-independent).** Each region's price for resource r depends only on the static supply and demand of regions in its k-ring, weighted by transport cost. It never reads another region's *computed* price, so the result does not depend on evaluation order.

```
w_ij  = 1 / (1 + c_ij / c0)                      c_ij = cheapest transport cost i→j (§4.2 mode costs)
S_i   = Σ_j w_ij × supply_rj                      over j in the k-ring of i (k = 1 or 2)
D_i   = Σ_j w_ij × demand_rj
x     = (D_i − S_i) / min(D_i, S_i)               guard: min = 0 → x = ±1
p_ri  = base_r × (1 + 0.75 × clamp(x, −1, 1))     Victoria 3's market formula (V3-M)
```

The weighting is a market-potential index in the spirit of Harris 1954 [unverified]; the price function is Victoria 3's (V3-M). Everything is + − × ÷ and comparisons.

**Model B: flows between neighbouring markets (one bounded iteration).** For each pair of adjacent regions (i, j), resource r flows from i to j when the price gap exceeds the transport cost: p_rj − p_ri > t_ij × weight_r. This is the arbitrage condition of spatial price equilibrium (Samuelson 1952 [unverified]). To stay order-independent:

- Allocate each exporter's surplus to its importers **in proportion** to their positive margin (gap − cost), not greedily in some visiting order.
- Run a fixed number of rounds (1–3), each round reading only the previous round's state, over a bounded neighbourhood.
- Cache per region like the river pass, so a region's flows are a pure function of its k-ring.

**Value density.** Give each resource a base value and a weight class: Bulk (grain, timber, stone, fuel, salt, ore), Trade (cloth, iron, wine), Luxury (spices, furs, fine goods). With the mode costs of §4.2, bulk goods then travel far only by water, luxuries go anywhere, and von Thünen-like rings appear around cities without being placed (§4.4).

**Starting calibration.**

| Value tier | Base price | Weight per unit | Land reach before cost = value | Sea reach |
|---|---|---|---|---|
| Subsistence | 1 | 1 | under 1 zone | not traded |
| Bulk | 2 | 1 | ~1 zone (≈ 1 day) | many regions |
| Trade | 5 | 0.5 | ~1 region | far |
| Luxury | 20 | 0.1 | many regions | anywhere |

### 5.8 Generation order

1. Per patch: potentials and deposits (catalogue §7.1–7.2), enabler flags. Already pure functions of the patch.
2. Per zone: sum outputs; population capacity from food; pick the market-town patch (best access × food); place intermediates by input co-location.
3. Per region: balances, LQ, signature export (rule 5), deficits (rule 6), city site, `thrive`.
4. Per region with its k-ring: prices (Model A), then flows (Model B). Rivers and coasts give the cheap edges; roads come later (`README.md` "Trade network").
5. Inspector: show the 7 groups, the signature export, the biggest deficit and the main trade partner.

### 5.9 Open questions

1. **Population model.** Food potential → people needs a yield per km² per staple and biome. The catalogue gives occurrence, not yield (its §7.5 question 5).
2. **Market reach k.** k = 1 (neighbour regions, ~128–256 km) is cheap; k = 2 lets luxuries cross climate belts but multiplies cost by about 3. Should sea links count as k = 1 regardless of distance?
3. **Roads.** Until roads exist, should land cost be uniform, or depend on zone type (flat cheap, mountains dear)?
4. **Depletion and time.** Static deposits (Anno 1800, ANNO-S) or depleting ones (EU4 gold, Manor Lords iron)? A generator for a backdrop probably wants static yield classes.
5. **Technology.** Coal, late metals (catalogue #358–362) and Victoria-style industry need a technology level. Leave dormant or omit?
6. **Bedrock attribute.** Rules 2–3 (iron, bronze) need the catalogue's proposed bedrock class (§7.3 there). Without it, deposits stay climate-and-zone hashes and tin/copper separation must be enforced by a separate hash salt.
7. **Fantasy share.** Should the fantasy layer's three game resources be a toggle, and should they ever be a region's signature export?
8. **Player-facing count.** Seven groups and 37 resources is a guess from §3.3. It should be tested with the inspector before it is fixed.

---

## 6. Quick reference

| If the map has… | The game layer gives… |
|---|---|
| Flat or lowland, temperate, river | Grain surplus, Clay, Fibre, a market town; exports Grain or Cloth; imports Stone, Salt, Iron |
| Hills or mountains | Stone, ores, Livestock, water power; imports Grain and Salt; exports metals |
| Boreal forest | Timber, Fuel, Furs, Naval stores, bog Iron; imports Salt and Grain |
| Steppe, cold or hot desert | Horses, Livestock, Salt (playas); imports Timber, Fuel, Grain, Iron |
| Tropical lowland | Spices, Stimulants, Dyes, Timber; imports Salt, Iron, Cloth |
| Tropical highland (`hiT`) | Stimulants (tea, coffee), Grain (highland crops) |
| Dry warm coast | Solar Salt, Fish, Preserved food, a port |
| River mouth on a flat coast | Port + navigable river: the region's trade hub and likely city |
| Warm flat or lowland coast with mangrove (MG) | Fish and shellfish, Timber (poles), Fuel (charcoal), tanning bark; imports Grain, Salt, Iron |
| Lake on a river (`Lake.patch`) | Fish, fresh water, reeds; a natural market and a stop for river transport |

---

## 7. Sources

### 7.1 Games: developer material and community wikis read

- **CIV6-R** — Civilopedia (Gathering Storm ruleset), resources list and resource pages for Iron, Silk, Wheat, Niter. https://www.civilopedia.net/gathering-storm/resources (counts: 11 bonus, 34 luxury, 7 strategic, 2 artifacts); e.g. https://www.civilopedia.net/gathering-storm/resources/resource_iron. civilopedia.net reproduces the in-game Civilopedia; it is not run by Firaxis.
- **CIV6-C** — Civilopedia, "Consumable Resources" concept page (Fuel vs Material; stockpile; power; barter "as a lump sum"). https://www.civilopedia.net/gathering-storm/concepts/consumeable_resources
- **EU4-TG** — Europa Universalis IV Wiki, "Trade goods" (verified for 1.30–1.31; read to character 100,000 of 127,000). https://eu4.paradoxwikis.com/Trade_goods
- **EU4-T** — Europa Universalis IV Wiki, "Trade" (read to character 100,000 of 163,000). https://eu4.paradoxwikis.com/Trade
- **CK3-H**, **CK3-B** — Crusader Kings III Wiki, "Holdings" and "Buildings" (terrain chart). https://ck3.paradoxwikis.com/Holdings, https://ck3.paradoxwikis.com/Buildings
- **V3-G**, **V3-N**, **V3-M** — Victoria 3 Wiki, "Goods", "Needs" (some sections verified for 1.10/1.13), "Market" (verified for 1.13). https://vic3.paradoxwikis.com/Goods, /Needs, /Market
- **V3-DD** — Victoria 3 dev diaries #4 (Goods), #5 (Buildings and production methods), #9 (National markets), Paradox forum. Not read (browser check); "2–5 production methods per building" from a press summary [partially verified].
- **ANNO-T** — Anno Union, "DevBlog: Residential Tiers", 22 Feb 2018, Christian Schneider and Manuel Reinher. https://www.anno-union.com/en/devblog-residential-tiers/
- **ANNO-S** — Anno Union, "DevBlog: Treasures of the soil", 16 Feb 2018 (fertilities, lodes, no depletion, scarcity by difficulty). Read from the tag listing https://www.anno-union.com/tag/devblog-en/page/12/
- **P4** — *Patrician IV* manual (Kalypso Media), PDF from rune-soft.com, printed pp. 12 (Trading Goods; Supply and Demand), 19–24 (Production Buildings, regional goods). https://www.rune-soft.com/upload/documents/Manual_PDF_Patrician4%20.pdf
- **MB2-E** — TaleWorlds, *Bannerlord* developer blog "Economy and Trade", 26 Apr 2019, read as reposted by GameBanshee. http://www.gamebanshee.com/k4cr3
- **MB2-W** — TaleWorlds, *Bannerlord* developer blog "Productive Enterprises", 11 May 2018, GameBanshee repost. http://www.gamebanshee.com/k46hy
- **MB2-V** — TaleWorlds developer blogs 2015 ("The Passage of Time") and 2018 on village production types by region. **[partially verified: quoted via search index; taleworlds.com refused the fetch]**
- **HK** — Amplitude Studios, *Humankind* "Resources and Economy Preview", 3 Aug 2023. https://community.amplitude-studios.com/amplitude-studios/humankind/blogs/906-resources-and-economy-preview
- **FAC** — Factorio Wiki (official, Wube), "Map generator". https://wiki.factorio.com/Map_generator
- **RW-R**, **RW-T** — RimWorld Wiki, "Resources" and "Trade". https://rimworldwiki.com/wiki/Resources, https://rimworldwiki.com/wiki/Trade
- **BAN** — Banished Wiki (banished-wiki.com), "Trade". https://banished-wiki.com/wiki/Trade
- **KP** — Overseer Games, "Five pillars of gameplay in Kaiserpunk", 18 Nov 2023. https://www.overseer-games.com/news/five-pillars-of-gameplay-in-kaiserpunk
- **OW-SJ** — Soren Johnson, *Designer Notes*, "This Old World", 4 May 2020 (Orders). https://www.designer-notes.com/?p=1613
- **SOS** — *Songs of Syx* Steam store page (developer description). https://store.steampowered.com/app/1162750/Songs_of_Syx/
- **GDC-SM** — Sid Meier, "Interesting Decisions", GDC 2012. https://gdcvault.com/play/1015756/Interesting **[partially verified: session listing and press coverage; video not watched]**
- **GDC-EC** — Edward Castronova, "Building Sustainable Game Economies: The Three Design Pillars", GDC 2023 (session page only). https://gdcvault.com/play/1028982/Building-Sustainable-Game-Economies-The
- **ML** — Manor Lords regions, deposits, trade routes: guides and a press summary of a dev diary (PCGamesN, Game8, GameSpot) via search index **[partially verified]**.
- **TW** — Total War: Warhammer trade rules from the fan wiki via search index **[partially verified]**.

### 7.2 Economics and geography

- **SMITH** — Adam Smith, *An Inquiry into the Nature and Causes of the Wealth of Nations*, 1776, Book I, ch. 3. Library of Economics and Liberty. https://www.econlib.org/library/Smith/smWN.html
- **RIC** — David Ricardo, *On the Principles of Political Economy and Taxation*, 1817, ch. 7 "On Foreign Trade". Library of Economics and Liberty. https://www.econlib.org/library/Ricardo/ricP2a.html
- **THU** — J. H. von Thünen, *Der isolierte Staat*, 1826. Read through J.-P. Rodrigue, *The Geography of Transport Systems*, "Von Thünen's Regional Land Use Model" (rent formula, assumptions) and *Encyclopaedia Britannica*, "Johann Heinrich von Thünen". https://transportgeography.org/contents/chapter8/urban-land-use-transportation/von-thunen-regional-land-use/ **[partially verified: original not read]**
- **CHR** — W. Christaller, *Die zentralen Orte in Süddeutschland*, 1933 (trans. C. W. Baskin, *Central Places in Southern Germany*, 1966). Read through *Britannica*, "Central-place theory", and Rodrigue, "Central Places Theory (Market Principle)". https://www.britannica.com/topic/central-place-theory; https://transportgeography.org/contents/chapter2/transport-and-spatial-organization/central-places-theory-market-principle/ **[partially verified: original not read]**
- **WEB** — A. Weber, *Über den Standort der Industrien*, 1909 (trans. C. J. Friedrich 1929). Read through Rodrigue, "Weber's Location Triangle" (6th ed., 2024, §2.3). https://transportgeography.org/contents/chapter2/transport-and-location/weber-location-triangle/ **[partially verified]**
- **SKIN** — G. W. Skinner, "Marketing and Social Structure in Rural China, Part I", *Journal of Asian Studies* 24(1), 1964. https://www.cambridge.org/core/journals/journal-of-asian-studies/article/marketing-and-social-structure-in-rural-china-part-i/20071250B7BC9B70B1C47DF11B608FCA **[partially verified: secondary summaries]**
- **KRU** — P. Krugman, "Increasing Returns and Economic Geography", *Journal of Political Economy* 99(3):483–499, 1991; NBER WP 3275. **[partially verified: working-paper abstract]**
- **ORBIS-15** — W. Scheidel, "Orbis: the Stanford geospatial network model of the Roman world", Princeton/Stanford Working Papers in Classics, v1.0, May 2015 (read from the PDF). https://orbis.stanford.edu/
- **ORBIS-13** — W. Scheidel, "Explaining the maritime freight charges in Diocletian's Price Edict", Princeton/Stanford Working Papers in Classics, v1.0, April 2013 (read from the PDF).
- **MASS** — J. Masschaele, "Transport costs in medieval England", *Economic History Review* 46(2):266–279, 1993. **[partially verified: secondary summaries]**
- Not read, cited as **[unverified]**: G. A. Miller, "The magical number seven, plus or minus two", *Psychological Review* 63, 1956; N. Cowan, "The magical number 4 in short-term memory", *Behavioral and Brain Sciences* 24, 2001; P. A. Samuelson, "Spatial price equilibrium and linear programming", *American Economic Review* 42, 1952; C. D. Harris, "The market as a factor in the localization of industry in the United States", *Annals of the AAG* 44, 1954; E. Boserup, *The Conditions of Agricultural Growth*, 1965; F. Braudel, *Civilization and Capitalism*, vol. 1, 1979.

### 7.3 Repository

- `sandboxes/sandbox4/src/world/{world,rivers,climate}.ts`, `README.md`, at commit `b94e28d` (lines as in the code table).
- `sandboxes/sandbox4/src/world/{lakes,biomes,climate}.ts` at commit `397f779`, for the lakes, the mangrove biome and the supernatural map (the "Added since" table).
- `docs/research/patch-resources.md` (catalogue rows, §6, §7), `docs/research/biomes-and-climate.md` (bit-exactness rule, climate feature sizes).

### 7.4 Not accessible on the research date

- **Fandom wikis** returned HTTP 402 to the fetch tool: Civilization (Civ V and VI resource tables), Anno 1800 and 1404, Banished (fandom), Settlers, Stronghold, Total War, Kenshi, Patrician, Humankind. Rows that depend on them are marked [unverified] or [partially verified].
- **wiki.gg** (Farthest Frontier, Manor Lords) returned HTTP 401; the **Hooded Horse official wiki** (Old World, Manor Lords) returned 403.
- **UESP** (Skyrim ore, merchants) and **taleworlds.com** returned 403.
- **Dwarf Fortress Wiki** returned 429 (rate limit) on every attempt.
- **Paradox forum dev diaries** (Victoria 3 DD #4, #9) stopped at a browser check.
- **GDC Vault videos** were not watched; only session pages.
- **Original texts** of Christaller 1933 / Baskin 1966, von Thünen 1826 / Hall 1966, Weber 1909, Skinner 1964, Krugman 1991 and Masschaele 1993 were not read; secondary or abstract sources stand in.
- The **1 : 5 : 28** Roman transport ratio could not be traced to Scheidel's own text.
- No Game Developer (Gamasutra) **postmortem** on a resource economy (Banished, Anno, Settlers, Victoria 3) was found in this pass.
