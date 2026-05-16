const { Vec3 } = require("vec3");
const { isInFireBlock, checkHostileMobs } = require("./rules");

const WEAPON_PRIORITY = [
    "diamond_sword", "iron_sword", "golden_sword", "stone_sword", "wooden_sword",
    "diamond_axe", "iron_axe", "golden_axe", "stone_axe", "wooden_axe",
];

const PILLAR_MATERIALS = ["cobblestone", "dirt", "gravel", "sand", "stone"];

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

async function tryEquipWeapon(bot) {
    const mcData = require("minecraft-data")(bot.version);
    for (const name of WEAPON_PRIORITY) {
        const itemData = mcData.itemsByName[name];
        if (!itemData) continue;
        const item =
            bot.inventory.findInventoryItem(itemData.id, null) ||
            bot.inventory.items().find((i) => i.name === name);
        if (item) {
            try {
                await bot.equip(item, "hand");
                return true;
            } catch (_) {
                continue;
            }
        }
    }
    return false;
}

async function pillarUpReactive(bot, height = 3) {
    const mcData = require("minecraft-data")(bot.version);
    let pillarItem = null;
    for (const name of PILLAR_MATERIALS) {
        const itemData = mcData.itemsByName[name];
        if (!itemData) continue;
        const item =
            bot.inventory.findInventoryItem(itemData.id, null) ||
            bot.inventory.items().find((i) => i.name === name);
        if (item) { pillarItem = item; break; }
    }
    if (!pillarItem) return;

    try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
    await bot.equip(pillarItem, "hand");

    for (let i = 0; i < height; i++) {
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
        bot.setControlState("jump", true);
        await bot.waitForTicks(5);
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (blockBelow) {
            try { await bot.placeBlock(blockBelow, new Vec3(0, 1, 0)); } catch (_) {}
        }
        bot.setControlState("jump", false);
        await bot.waitForTicks(2);
    }
}

async function fleeFromMobs(bot, mobs) {
    const abortFlag = bot.reactiveAbortFlag;
    if (abortFlag && abortFlag.current !== null) return;

    if (bot.pathfinder) bot.pathfinder.setGoal(null);

    const cx = mobs.reduce((s, m) => s + m.position.x, 0) / mobs.length;
    const cz = mobs.reduce((s, m) => s + m.position.z, 0) / mobs.length;

    let lookTarget;
    if (
        bot.home &&
        typeof bot.home.distanceTo === "function" &&
        bot.entity.position.distanceTo(bot.home) <= 50
    ) {
        lookTarget = bot.home;
    } else {
        const dx = bot.entity.position.x - cx;
        const dz = bot.entity.position.z - cz;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        lookTarget = new Vec3(
            bot.entity.position.x + (dx / len) * 12,
            bot.entity.position.y,
            bot.entity.position.z + (dz / len) * 12
        );
    }

    await bot.lookAt(lookTarget.offset(0, 0.5, 0));

    for (let t = 0; t < 8; t++) {
        try { if (bot.pathfinder) bot.pathfinder.setGoal(null); } catch (_) {}
        bot.setControlState("sprint", true);
        bot.setControlState("forward", true);
        await bot.waitForTicks(3);
        bot.setControlState("jump", true);
        await bot.waitForTicks(2);
        bot.setControlState("jump", false);
        if (abortFlag && abortFlag.current !== null) break;
    }

    bot.setControlState("forward", false);
    bot.setControlState("sprint", false);

    if (checkHostileMobs(bot, 10)) {
        await pillarUpReactive(bot);
    }
}

async function fightMob(bot, mob) {
    const FIGHT_TIMEOUT_MS = 15000;
    return new Promise((resolve) => {
        let resolved = false;

        const finish = () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            bot.removeListener("stoppedAttacking", onStopped);
            resolve();
        };

        const timer = setTimeout(() => {
            bot.pvp.stop();
            finish();
        }, FIGHT_TIMEOUT_MS);

        function onStopped() { finish(); }
        bot.once("stoppedAttacking", onStopped);
        bot.pvp.attack(mob);
    });
}

module.exports = { escapeFromHazard, eatBestFood, tryEquipWeapon, pillarUpReactive, fleeFromMobs, fightMob };
