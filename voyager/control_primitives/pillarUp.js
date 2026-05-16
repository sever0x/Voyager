async function pillarUp(bot, material, height = 4) {
    if (typeof material !== "string") {
        throw new Error("material for pillarUp must be a string");
    }
    if (typeof height !== "number" || height < 1) {
        throw new Error("height for pillarUp must be a positive number");
    }

    const itemData = mcData.itemsByName[material];
    if (!itemData) {
        throw new Error(`Unknown material: ${material}`);
    }
    const item = bot.inventory.findInventoryItem(itemData.id, null);
    if (!item) {
        bot.chat(`No ${material} to pillar with`);
        return;
    }

    await bot.equip(item, "hand");

    for (let i = 0; i < height; i++) {
        bot.setControlState("jump", true);
        await bot.waitForTicks(6);
        const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
        if (blockBelow) {
            try {
                await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
            } catch (_) {}
        }
        bot.setControlState("jump", false);
        await bot.waitForTicks(3);
    }
    bot.save("pillar_built");
}
