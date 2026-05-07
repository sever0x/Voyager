const { Observation } = require("./base.js");

class ReactiveEvents extends Observation {
    constructor(bot) {
        super(bot);
        this.name = "recentReactiveEvents";
        if (!bot.recentReactiveEvents) {
            bot.recentReactiveEvents = [];
        }
    }

    observe() {
        return this.bot.recentReactiveEvents.slice();
    }
}

module.exports = ReactiveEvents;
