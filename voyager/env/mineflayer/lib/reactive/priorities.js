const PRIORITY = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
    STRATEGIC: 4,
};

const POLL_INTERVAL_MS = {
    [1]: 200,
    [2]: 500,
    [3]: 2000,
};

class AbortError extends Error {
    constructor(priority, reason) {
        super(`Aborted [P${priority}]: ${reason}`);
        this.name = "AbortError";
        this.priority = priority;
        this.reason = reason;
    }
}

function checkAbort(abortFlag) {
    if (abortFlag.current !== null) {
        throw new AbortError(abortFlag.current, "abort flag set");
    }
}

module.exports = { PRIORITY, POLL_INTERVAL_MS, AbortError, checkAbort };
