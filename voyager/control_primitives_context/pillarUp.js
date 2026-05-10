// Place solid blocks underfoot while jumping to ascend vertically — emergency escape from ground-level threats.
// pillarUp(bot, "cobblestone", 4); // build a 4-block pillar using cobblestone
async function pillarUp(bot, material, height = 4) {
    // material: solid block name from inventory, e.g. "cobblestone", "dirt", "gravel", "sand", "stone"
    // height: number of blocks to ascend (default 4)
    // Returns when the pillar is complete or material runs out.
    // Use when mobs are pursuing and there is no shelter nearby.
    // Prefer "cobblestone" over "dirt" — dirt is too easy to knock off.
}
