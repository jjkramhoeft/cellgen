# Sandbox 3

A prototype of Voronoi Cell usages in base map generation

## Features

* Determanistic
* Pannable and Zoomable
* the base unit i meters
* There are tree leves of cells:
  * Large cells called: Regions
    * Default grid size 128 km x 128 km
    * No warping
    * Used to determen ocean seeds. 0-2 ocean seed per region
    * Used to determen medium cell mergers. 2-4 mergers per region
  * Medium cells called: Biomes. Also used for fractions
    * Default grid size 32 km * 32 km
    * Use border warp
    * Used to determen small cell mergers. 2-4 mergers per biome
    * Ocean bioms are choosen randomly (the number of then are take from the region). Each ocean biome has a (default value) 40% chance to be connected to its nearest ocean biome - this connection converts all biomes in the connecting chain to ocean biomes. (more than two ocean seed bioms can be connected this way). Each connected ocean biome has a chance to converts it closest (3 10%, 2 33%, 1 33%, 0 23%) non ocean naibors to ocean bioms (this is to get larger oceans)
    * Some cells (randomly choosen) are join to there nerest naibor to get more variation in cell size
  * Small cells: called: Subbiomes. Used for detajls, Sub biomes, City and Towns, Rare ore deposits, competing factions and more
    * Default grid size 8 km x 8 km
    * Use border warp
    * Some cells (randomly choosen) are join to there nerest naibor to get more variation in cell size
* Adjustable boarder warp and warp frequensy
* Heigt is not included in this sandbox, only land/ocean
* In this sandbox biomes and subbiomes are purly cosmetic  (different colors)

### Recorded size/distance and travel info

not used:

* An average, healthy horse under saddle can comfortably travel 32 to 48 kilometers per day over multiple days of sustainable riding.
* Roman Legionaries: Historically marched about 24 to 32 km per day while carrying armor and equipment.
* Long-Distance / Civilions Hikers: Recreational long-distance hikers average 16 to 24 km per day to maintain energy and set up camp.
