const { HOSTILE_MOBS } = require("../reactive/rules");

const TRANSPARENT_BLOCKS = new Set([
    "air", "cave_air", "void_air",
    "glass", "glass_pane", "iron_bars",
    "oak_leaves", "birch_leaves", "spruce_leaves", "jungle_leaves",
    "acacia_leaves", "dark_oak_leaves", "mangrove_leaves",
]);

function isSolid(block) {
    if (!block) return false;
    if (TRANSPARENT_BLOCKS.has(block.name)) return false;
    // All door types count as walls regardless of open/closed state —
    // a box with doors is still a shelter
    if (block.name.endsWith("_door")) return true;
    // Use boundingBox to exclude tall grass, flowers, etc.
    return block.boundingBox === "block";
}

function hasNearbyLight(bot, pos) {
    // Scan 5x5x5 cube for any block that emits light (torch, lantern, etc.)
    // emittedLight comes from minecraft-data block definitions
    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 3; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
                const b = bot.blockAt(pos.offset(dx, dy, dz));
                if (b && b.emittedLight > 0) return true;
            }
        }
    }
    return false;
}

function checkSheltered(bot) {
    try {
        const pos = bot.entity.position;

        // Solid block directly above head (Y+2 from feet)
        const above = bot.blockAt(pos.offset(0, 2, 0));
        if (!isSolid(above)) return { isSheltered: false, safeToRecordLesson: false };

        // At least 3 of 4 horizontal neighbors solid at eye level (Y+1)
        const neighbors = [
            bot.blockAt(pos.offset(1, 1, 0)),
            bot.blockAt(pos.offset(-1, 1, 0)),
            bot.blockAt(pos.offset(0, 1, 1)),
            bot.blockAt(pos.offset(0, 1, -1)),
        ];
        if (neighbors.filter(isSolid).length < 3) {
            return { isSheltered: false, safeToRecordLesson: false };
        }

        // At least one light-emitting block within 5x5x5 cube
        if (!hasNearbyLight(bot, pos)) {
            return { isSheltered: false, safeToRecordLesson: false };
        }

        // No hostile mobs within 6 blocks (gate for recording a positive lesson)
        const nearby = Object.values(bot.entities).filter(
            (e) =>
                e.name &&
                HOSTILE_MOBS.has(e.name) &&
                e.position &&
                e.position.distanceTo(pos) <= 6
        );
        return { isSheltered: true, safeToRecordLesson: nearby.length === 0 };
    } catch (_) {
        return { isSheltered: false, safeToRecordLesson: false };
    }
}

module.exports = { checkSheltered };
