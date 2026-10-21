// Roll over before any read/increment, including a tab left open overnight.
export function rolloverDailyStats(stats, today) {
    if (stats.lastDate && stats.lastDate !== today) {
        const history = stats.retentionHistory || [];
        if (stats.todayTotal > 0) {
            history.push({ date: stats.lastDate, correct: stats.todayCorrect || 0, total: stats.todayTotal });
        }
        stats.retentionHistory = history.slice(-3);
        for (const key of ['newCardsDoneToday', 'dueDoneToday', 'learningDoneToday', 'todayCorrect', 'todayTotal']) stats[key] = 0;
    }
    stats.lastDate = today;
    for (const key of ['newCardsDoneToday', 'dueDoneToday', 'learningDoneToday', 'todayCorrect', 'todayTotal']) {
        if (!Number.isFinite(stats[key])) stats[key] = 0;
    }
    return stats;
}
