const { goals: { GoalBlock } } = require("mineflayer-pathfinder");
const { isInFireBlock } = require("./rules");

const FOOD_PRIORITY = [
    "cooked_beef", "cooked_porkchop",
    "cooked_mutton", "cooked_chicken",
    "bread",
    "cooked_salmon", "cooked_cod",
    "apple",
    "beef", "porkchop", "mutton", "chicken", "salmon", "cod",
];

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

async function eatBestFood(bot) {
    const mcData = require("minecraft-data")(bot.version);

    let foodItem = null;
    for (const name of FOOD_PRIORITY) {
        const itemData = mcData.itemsByName[name];
        if (!itemData) continue;
        const item = bot.inventory.findInventoryItem(itemData.id, null);
        if (item) {
            foodItem = item;
            break;
        }
    }

    if (!foodItem) {
        bot.noFood = true;
        bot.recentReactiveEvents.push({
            trigger: "noFood",
            action: "none",
            timestamp: Date.now(),
            outcome: "triggered",
        });
        return;
    }

    bot.noFood = false;
    await bot.equip(foodItem, "hand");
    bot.activateItem();
    await bot.waitForTicks(40);
}

module.exports = { escapeFromHazard, eatBestFood };
