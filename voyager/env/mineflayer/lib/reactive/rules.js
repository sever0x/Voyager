const FIRE_BLOCKS = new Set(["fire", "soul_fire"]);

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

module.exports = { checkCritical, isInFireBlock, checkHunger };
