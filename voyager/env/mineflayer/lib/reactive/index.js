const { PRIORITY, POLL_INTERVAL_MS } = require("./priorities");
const { checkCritical } = require("./rules");
const { escapeFromHazard } = require("./actions");

function initReactiveEngine(bot) {
    const abortFlag = { current: null };
    bot.reactiveAbortFlag = abortFlag;
    bot.recentReactiveEvents = [];

    function emitEvent(event) {
        bot.recentReactiveEvents.push({
            ...event,
            timestamp: Date.now(),
            outcome: "triggered",
        });
    }

    let criticalInProgress = false;
    let escapeInProgress = false;

    function handleCriticalResult(result) {
        if (!criticalInProgress) {
            criticalInProgress = true;
            abortFlag.current = PRIORITY.CRITICAL;
            if (bot.pathfinder) bot.pathfinder.setGoal(null);
            emitEvent(result);
        }
        if (result.action === "escape_hazard" && !escapeInProgress) {
            escapeInProgress = true;
            escapeFromHazard(bot)
                .catch(() => {})
                .finally(() => { escapeInProgress = false; });
        }
    }

    // Priority 0 — position-based detection via physicsTick (works in all game modes)
    bot.on("physicsTick", () => {
        if (criticalInProgress) {
            if (!checkCritical(bot)) {
                criticalInProgress = false;
                escapeInProgress = false;
                abortFlag.current = null;
            }
            return;
        }
        const result = checkCritical(bot);
        if (result) handleCriticalResult(result);
    });

    // Priority 0 supplement — entityHurt for immediate response in Survival mode
    bot.on("entityHurt", (entity) => {
        if (entity !== bot.entity) return;
        const result = checkCritical(bot);
        if (result) handleCriticalResult(result);
    });

    // Priority 1 (200ms) — Phase 2: health ≤ 3 hearts, drowning checks
    const p1 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.HIGH) return;
    }, POLL_INTERVAL_MS[PRIORITY.HIGH]);

    // Priority 2 (500ms) — Phase 2: hunger ≤ 4, hostile mob ≤ 6 blocks checks
    const p2 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.MEDIUM) return;
    }, POLL_INTERVAL_MS[PRIORITY.MEDIUM]);

    // Priority 3 (2000ms) — Phase 2: hunger ≤ 8, hostile mob ≤ 15 blocks checks
    const p3 = setInterval(() => {
        if (abortFlag.current !== null && abortFlag.current <= PRIORITY.LOW) return;
    }, POLL_INTERVAL_MS[PRIORITY.LOW]);

    bot._reactiveIntervals = [p1, p2, p3];

    bot.once("end", () => {
        bot._reactiveIntervals.forEach(clearInterval);
    });
}

module.exports = { initReactiveEngine };
