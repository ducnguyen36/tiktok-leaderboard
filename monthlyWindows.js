// Pure month-window math for the monthly leaderboard reset + grace-period display.
// All Date construction is server-local (Vietnam, TZ=Asia/Ho_Chi_Minh) time.

const MONTHLY_RESET_HOUR = 7; // 07:00 on the 1st; decoupled from the daily resetHour

/**
 * @param {Date} now
 * @param {number} resetHour - hour-of-day the monthly window starts on the 1st (e.g. 7)
 * @returns {{monthlyStart: Date, prevMonthlyStart: Date, graceEnd: Date,
 *            inGrace: boolean, displayStart: Date, displayEnd: Date|null}}
 */
function computeMonthlyWindows(now, resetHour) {
    // Active accumulating-month start: most recent "1st @ resetHour" that is <= now.
    let monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1, resetHour, 0, 0, 0);
    if (now < monthlyStart) {
        // 00:00–resetHour on the 1st: new month hasn't started; active window is still last month.
        monthlyStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, resetHour, 0, 0, 0);
    }

    const prevMonthlyStart = new Date(
        monthlyStart.getFullYear(), monthlyStart.getMonth() - 1, 1, resetHour, 0, 0, 0
    );

    // Display grace ends at 00:00:00 on the 2nd of monthlyStart's calendar month.
    const graceEnd = new Date(
        monthlyStart.getFullYear(), monthlyStart.getMonth(), 2, 0, 0, 0, 0
    );
    const inGrace = now < graceEnd;

    return {
        monthlyStart,
        prevMonthlyStart,
        graceEnd,
        inGrace,
        displayStart: inGrace ? prevMonthlyStart : monthlyStart,
        displayEnd: inGrace ? monthlyStart : null,
    };
}

/**
 * Daily + yesterday windows (server-local Vietnam time), matching the daily reset logic.
 * Extracted so the gift-load lower bound can be reasoned about and unit-tested.
 * @param {Date} now
 * @param {number} resetHour - the daily reset hour (independent of MONTHLY_RESET_HOUR)
 * @returns {{dailyStart: Date, yesterdayStart: Date, yesterdayEnd: Date}}
 */
function computeDailyWindows(now, resetHour) {
    const dailyStart = new Date(now);
    dailyStart.setHours(resetHour, 0, 0, 0);
    if (now < dailyStart) dailyStart.setDate(dailyStart.getDate() - 1);

    const yesterdayStart = new Date(dailyStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const yesterdayEnd = new Date(dailyStart); // yesterday ends where today starts
    return { dailyStart, yesterdayStart, yesterdayEnd };
}

module.exports = { MONTHLY_RESET_HOUR, computeMonthlyWindows, computeDailyWindows };
