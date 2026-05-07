const { Observation } = require("./base.js");

class ReactiveEvents extends Observation {
    constructor(bot) {
        super(bot);
        this.name = "reactiveEvents";
        if (!bot.reactiveEvents) {
            bot.reactiveEvents = [];
        }
    }

    observe() {
        return this.bot.reactiveEvents.slice();
    }
}

module.exports = ReactiveEvents;
