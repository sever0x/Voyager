const { Observation } = require("./base.js");

class Players extends Observation {
    constructor(bot) {
        super(bot);
        this.name = "nearbyPlayers";
    }

    observe() {
        const result = [];
        for (const username in this.bot.players) {
            if (username === this.bot.username) continue;
            const player = this.bot.players[username];
            if (!player.entity) continue;
            const distance = player.entity.position.distanceTo(
                this.bot.entity.position
            );
            result.push({
                username,
                distance: Math.round(distance * 10) / 10,
                position: {
                    x: Math.round(player.entity.position.x * 10) / 10,
                    y: Math.round(player.entity.position.y * 10) / 10,
                    z: Math.round(player.entity.position.z * 10) / 10,
                },
            });
        }
        return result;
    }
}

module.exports = Players;
