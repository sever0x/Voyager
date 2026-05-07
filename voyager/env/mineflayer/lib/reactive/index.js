const { PRIORITY, POLL_INTERVAL_MS } = require("./priorities");
const { checkCritical } = require("./rules");
const { escapeFromHazard } = require("./actions");

function initReactiveEngine(bot) {
    const abortFlag = { current: null };
    bot.reactiveAbortFlag = abortFlag;
    bot.reactiveEvents = [];

    function emitEvent(event) {
        bot.reactiveEvents.push({
            ...event,
            timestamp: Date.now(),
            outcome: "triggered",
        });
    }

    let criticalInProgress = false;

    bot.on("physicTick", () => {
        if (criticalInProgress) return;
        const result = checkCritical(bot);
        if (!result) return;

        criticalInProgress = true;
        abortFlag.current = PRIORITY.CRITICAL;
        if (bot.pathfinder) bot.pathfinder.setGoal(null);
        emitEvent(result);

        const action =
            result.action === "escape_hazard"
                ? escapeFromHazard(bot)
                : Promise.resolve();

        action
            .catch(() => {})
            .finally(() => {
                abortFlag.current = null;
                criticalInProgress = false;
            });
    });

    const p1 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.HIGH) return;
        // Phase 2: health ≤ 3 hearts, drowning checks
    }, POLL_INTERVAL_MS[PRIORITY.HIGH]);

    const p2 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.MEDIUM) return;
        // Phase 2: hunger ≤ 4, hostile mob ≤ 6 blocks checks
    }, POLL_INTERVAL_MS[PRIORITY.MEDIUM]);

    const p3 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.LOW) return;
        // Phase 2: hunger ≤ 8, hostile mob ≤ 15 blocks checks
    }, POLL_INTERVAL_MS[PRIORITY.LOW]);

    bot._reactiveIntervals = [p1, p2, p3];

    bot.once("end", () => {
        bot._reactiveIntervals.forEach(clearInterval);
    });
}

module.exports = { initReactiveEngine };
