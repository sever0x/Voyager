const { goals: { GoalBlock } } = require("mineflayer-pathfinder");

async function escapeFromHazard(bot) {
    if (bot.pathfinder) bot.pathfinder.setGoal(null);

    const pos = bot.entity.position;
    const offsets = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [2, 0], [-2, 0], [0, 2], [0, -2],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
    ];

    for (const [dx, dz] of offsets) {
        const candidate = pos.offset(dx, 0, dz);
        const floor = bot.blockAt(candidate.offset(0, -1, 0));
        const foot = bot.blockAt(candidate);
        const head = bot.blockAt(candidate.offset(0, 1, 0));

        const hazardNames = ["lava", "fire", "magma_block"];
        if (
            floor && !hazardNames.includes(floor.name) &&
            foot && foot.name === "air" &&
            head && head.name === "air"
        ) {
            try {
                await bot.pathfinder.goto(
                    new GoalBlock(
                        Math.floor(candidate.x),
                        Math.floor(candidate.y),
                        Math.floor(candidate.z)
                    )
                );
            } catch (_) {
                bot.setControlState("jump", true);
                await bot.waitForTicks(5);
                bot.setControlState("jump", false);
            }
            return;
        }
    }

    bot.setControlState("jump", true);
    await bot.waitForTicks(5);
    bot.setControlState("jump", false);
}

module.exports = { escapeFromHazard };
