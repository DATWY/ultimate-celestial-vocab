import { getState, setUserFsrs7Params, isPreviewMode } from '../state.js';
import { getSettingFromDB, saveSettingToDB } from '../idb.js';

let activeTask = null;
export function optimizerMessage(result) {
    if (result.reason === 'insufficient-data') return `Cần ít nhất 400 lượt ôn hợp lệ. Hiện có ${result.count || 0} lượt.`;
    if (result.reason === 'insufficient-history') return 'Cần thêm lịch sử lặp lại và ít nhất 30 lượt để kiểm tra độc lập.';
    // AUDIT-6.1: nói rõ vì sao KHÔNG áp dụng — lịch sử đã bị cắt nên không dựng lại được bộ nhớ.
    if (result.reason === 'truncated-history') {
        const dropped = Number(result.truncatedChains || 0);
        return `Chưa áp dụng: lịch sử ôn của ${dropped} thẻ đã bị cắt nên không dựng lại được trạng thái trí nhớ ban đầu. `
            + 'Hãy dùng tiếp một thời gian để tích lũy chuỗi ôn đầy đủ rồi thử lại.';
    }
    if (result.reason === 'configuration-changed') return 'Bạn đã đổi cấu hình trong lúc tối ưu. Đã giữ cấu hình mới nhất của bạn.';
    // AUDIT-R3.1: dữ liệu có nhưng phần ĐÁNG TIN (chuỗi có bằng chứng lượt ôn đầu tiên) chưa đủ
    // để huấn luyện và kiểm tra độc lập ⇒ giữ nguyên bộ đang dùng, nói rõ cần gì.
    if (result.reason === 'insufficient-verified-history') {
        const trusted = Number(result.trustedRows || 0);
        const assumed = Number(result.assumedStartChains || 0);
        return `Chưa áp dụng: chỉ ${trusted} lượt thuộc ${Number(result.verifiedChains || 0)} thẻ có bằng chứng lượt ôn đầu tiên `
            + `(cần ≥400 lượt, ≥100 lượt huấn luyện và ≥30 lượt kiểm tra từ chính phần đó). `
            + `Còn ${assumed} thẻ có lịch sử cũ chưa xác minh được điểm bắt đầu nên không dùng để quyết định. Giữ bộ đang dùng.`;
    }
    // AUDIT-R2.1: không chấm được dữ liệu ngay tại điểm xuất phát ⇒ nói rõ, không báo "cải thiện".
    if (result.reason === 'unscorable') return 'Chưa áp dụng: không chấm được dữ liệu hiện tại để tính gradient. Giữ nguyên bộ tham số đang dùng.';
    if (result.reason === 'preview-only') return 'Đã kiểm tra trong kho demo. Tham số cá nhân của bạn được giữ nguyên.';
    if (result.improved) {
        const ci = Array.isArray(result.gainCiPct) ? result.gainCiPct : null;
        const ciText = ci ? ` (khoảng tin cậy 95%: ${ci[0].toFixed(1)}%…${ci[1].toFixed(1)}%)` : '';
        return `Đã áp dụng bộ 34 tham số mới. Sai số kiểm tra giảm ${Number(result.gainPct || 0).toFixed(1)}%${ciText} trên ${result.validationCount} lượt.`;
    }
    if (result.reason === 'not-significant') {
        return `Bộ mới có tốt hơn trên dữ liệu huấn luyện nhưng chưa đủ bằng chứng trên ${result.validationCount} lượt kiểm tra (cần giảm ≥1% và khoảng tin cậy 95% không chứa 0). Giữ bộ hiện tại.`;
    }
    return 'Đã kiểm tra: bộ mới chưa tốt hơn trên lịch sử dành riêng để đánh giá. Tiếp tục dùng bộ hiện tại.';
}
/**
 * Quyết định ÁP DỤNG một kết quả tối ưu (tách khỏi `runOptimizer` để test được bằng kết quả THẬT
 * của `optimizeParameters`, không cần worker).
 * `apply` chỉ true khi kết quả tự nó đã `improved` và cấu hình chưa bị đổi giữa chừng.
 * Mọi lý do từ chối (truncated-history, insufficient-verified-history, …) đều cho `apply: false`,
 * nên weights đang dùng được giữ nguyên.
 */
export function resolveOptimizationOutcome(result, { baselineTrainedAt, currentTrainedAt, preview = false, cheat = false } = {}) {
    if (!result?.improved) return { improved: false, reason: result?.reason, apply: false };
    // A newer manual configuration made while training always wins.
    if (currentTrainedAt !== baselineTrainedAt) return { improved: false, reason: 'configuration-changed', apply: false };
    if (preview || cheat) return { improved: false, reason: 'preview-only', apply: false };
    return { improved: true, reason: result.reason, apply: true };
}

export async function checkAndRunOptimizer() {
    if (isPreviewMode() || sessionStorage.getItem('CHEAT_MODE') === 'true') return;
    const { reviewLogs } = getState();
    const length = reviewLogs.logs?.length || 0;
    const previous = await getSettingFromDB('lastOptimizationStatus');
    const newCount = reviewLogs.logs?.filter(row => row[3] > (previous?.reviewWatermark || 0)).length || 0;
    if (length >= 400 && newCount >= 200) return runOptimizer();
}
export function runOptimizer() {
    if (activeTask) return activeTask;
    const { reviewLogs, vocabulary, userFsrs7Params, userFsrs7TrainedAt } = getState();
    const baselineTime = userFsrs7TrainedAt;
    const input = structuredClone({ logs: reviewLogs, vocabulary: vocabulary.map(({ id, english, type }) => ({ id, english, type })), params: userFsrs7Params });
    activeTask = new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });
        const timeout = setTimeout(() => finish(new Error('Quá thời gian tối ưu (120 s). Bạn có thể thử lại.')), 120000);
        const finish = (error, result) => { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(result); };
        worker.onerror = () => finish(new Error('Không khởi động được bộ tối ưu.'));
        worker.onmessage = async ({ data }) => {
            if (data.type === 'ERROR') { finish(new Error(data.payload)); return; }
            if (data.type !== 'OPTIMIZATION_COMPLETE') return;
            try {
                const result = data.payload;
                // AUDIT-R3.1: quyết định áp dụng nằm trong MỘT hàm thuần (test được bằng kết quả
                // THẬT của optimizer). Chỉ ghi weights khi `apply`; mọi lý do từ chối đều giữ
                // nguyên bộ đang dùng.
                const outcome = resolveOptimizationOutcome(result, {
                    baselineTrainedAt: baselineTime,
                    currentTrainedAt: getState().userFsrs7TrainedAt,
                    preview: isPreviewMode(),
                    cheat: sessionStorage.getItem('CHEAT_MODE') === 'true'
                });
                result.improved = outcome.improved;
                if (outcome.reason) result.reason = outcome.reason;
                if (outcome.apply) {
                    await setUserFsrs7Params(result.params);
                    import('../sync.js').then(module => module.syncUserSettingsToFirebase());
                }
                await saveSettingToDB('lastOptimizationStatus', { ...result, timestamp: Date.now(), reviewWatermark: Math.max(0, ...(input.logs.logs || []).map(row => row[3] || 0)) });
                if (result.count >= 400) await saveSettingToDB('lastOptimizedLength', input.logs.logs?.length || 0);
                document.dispatchEvent(new CustomEvent('optimizer:complete', { detail: result }));
                finish(null, result);
            } catch (error) { finish(error); }
        };
        worker.postMessage({ type: 'START_OPTIMIZATION', payload: input });
    }).finally(() => { activeTask = null; });
    return activeTask;
}
