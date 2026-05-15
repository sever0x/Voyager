const { HOSTILE_MOBS } = require("../reactive/rules");

const TRANSPARENT_BLOCKS = new Set([
    "air", "cave_air", "void_air",
    "glass", "glass_pane", "iron_bars",
    "oak_leaves", "birch_leaves", "spruce_leaves", "jungle_leaves",
    "acacia_leaves", "dark_oak_leaves", "mangrove_leaves",
]);

function isSolid(block) {
    if (!block || TRANSPARENT_BLOCKS.has(block.name)) return false;
    if (block.name.endsWith("_door")) {
        if (block.name.startsWith("iron")) return true;
        const props = block.getProperties ? block.getProperties() : {};
        return props.open === "false" || props.open === false;
    }
    return true;
}

function checkSheltered(bot) {
    try {
        const pos = bot.entity.position;

        const above = bot.blockAt(pos.offset(0, 2, 0));
        if (!isSolid(above)) return { isSheltered: false, safeToRecordLesson: false };

        const neighbors = [
            bot.blockAt(pos.offset(1, 1, 0)),
            bot.blockAt(pos.offset(-1, 1, 0)),
            bot.blockAt(pos.offset(0, 1, 1)),
            bot.blockAt(pos.offset(0, 1, -1)),
        ];
        if (neighbors.filter(isSolid).length < 3) {
            return { isSheltered: false, safeToRecordLesson: false };
        }

        const lightBlock = bot.blockAt(pos.offset(0, 1, 0));
        if (!lightBlock || lightBlock.light < 8) {
            return { isSheltered: false, safeToRecordLesson: false };
        }

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
