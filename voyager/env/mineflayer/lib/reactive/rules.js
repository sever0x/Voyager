const FIRE_BLOCKS = new Set(["fire", "soul_fire"]);

const HOSTILE_MOBS = new Set([
    "zombie", "skeleton", "creeper", "spider", "cave_spider",
    "enderman", "witch", "pillager", "vindicator", "phantom",
    "drowned", "husk", "stray", "blaze", "ghast", "slime",
    "magma_cube", "zombie_villager", "zombie_pigman", "piglin_brute",
]);

function isInFireBlock(bot) {
    const pos = bot.entity.position;
    const feet = bot.blockAt(pos);
    const below = bot.blockAt(pos.offset(0, -1, 0));
    return (feet && FIRE_BLOCKS.has(feet.name)) || (below && FIRE_BLOCKS.has(below.name));
}

function checkCritical(bot) {
    if (bot.entity.isInLava) {
        return { priority: 0, trigger: "inLava", action: "escape_hazard" };
    }

    if (isInFireBlock(bot)) {
        return { priority: 0, trigger: "onFire", action: "escape_hazard" };
    }

    if (bot.entity.position.y < 0) {
        return { priority: 0, trigger: "void", action: "none" };
    }

    return null;
}

function checkHunger(bot) {
    if (bot.food <= 4) {
        return { priority: 2, trigger: "hunger_critical", action: "eat_food" };
    }
    if (bot.food <= 8) {
        return { priority: 3, trigger: "hunger_low", action: "eat_food" };
    }
    return null;
}

function checkHostileMobs(bot, radius) {
    const mobs = Object.values(bot.entities).filter(
        (e) =>
            e.displayName &&
            e.name !== "player" &&
            e.name !== "item" &&
            HOSTILE_MOBS.has(e.name) &&
            e.position != null &&
            e.position.distanceTo(bot.entity.position) <= radius
    );
    return mobs.length > 0 ? mobs : null;
}

function hasWeapon(bot) {
    const held = bot.heldItem;
    if (held && (held.name.includes("sword") || held.name.includes("axe"))) return true;
    return bot.inventory.items().some(
        (i) => i.name.includes("sword") || i.name.includes("axe")
    );
}

function decideFightOrFlee(bot, mobs) {
    if (bot.health < 16) return "flee";

    const closeCreeper = mobs.find(
        (m) =>
            m.name === "creeper" &&
            m.position.distanceTo(bot.entity.position) < 5
    );
    if (closeCreeper) return "flee";

    if (!hasWeapon(bot)) return "flee";

    const spiders = mobs.filter(
        (m) => m.name === "spider" || m.name === "cave_spider"
    );
    if (spiders.length >= 1) return "flee";

    return "fight";
}

module.exports = { checkCritical, isInFireBlock, checkHunger, checkHostileMobs, decideFightOrFlee };
