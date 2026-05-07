const { goals: { GoalBlock } } = require("mineflayer-pathfinder");
const { isInFireBlock } = require("./rules");

async function escapeFromHazard(bot) {
    if (bot.pathfinder) bot.pathfinder.setGoal(null);

    const pos = bot.entity.position;

    const safeTarget = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dz]) => pos.offset(dx, 0, dz))
        .find((candidate) => {
            const block = bot.blockAt(candidate);
            return block && !["lava", "fire", "soul_fire", "magma_block"].includes(block.name);
        });

    if (safeTarget) {
        await bot.lookAt(safeTarget.offset(0, 0.5, 0));
    }

    bot.setControlState("sprint", true);
    bot.setControlState("forward", true);

    for (let i = 0; i < 12; i++) {
        bot.setControlState("jump", true);
        await bot.waitForTicks(2);
        bot.setControlState("jump", false);
        await bot.waitForTicks(3);
        if (!bot.entity.isInLava && !isInFireBlock(bot)) break;
    }

    bot.setControlState("forward", false);
    bot.setControlState("sprint", false);
    bot.setControlState("jump", false);
}

module.exports = { escapeFromHazard };
