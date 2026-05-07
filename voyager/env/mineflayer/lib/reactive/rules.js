function checkCritical(bot) {
    if (bot.entity.isInLava) {
        return { priority: 0, trigger: "inLava", action: "escape_hazard" };
    }

    const isOnFire =
        Array.isArray(bot.entity.metadata) &&
        bot.entity.metadata.length > 0 &&
        (bot.entity.metadata[0] & 0x01) !== 0;
    if (isOnFire) {
        return { priority: 0, trigger: "onFire", action: "escape_hazard" };
    }

    if (bot.entity.position.y < 0) {
        return { priority: 0, trigger: "void", action: "none" };
    }

    return null;
}

module.exports = { checkCritical };
