import { getState, setUserFsrs7Params, isPreviewMode } from '../state.js';
import { getSettingFromDB, saveSettingToDB } from '../idb.js';

let activeTask = null;
export function optimizerMessage(result) {
    if (result.reason === 'insufficient-data') return `Cần ít nhất 400 lượt ôn hợp lệ. Hiện có ${result.count || 0} lượt.`;
    if (result.reason === 'insufficient-history') return 'Cần thêm lịch sử lặp lại và ít nhất 30 lượt để kiểm tra độc lập.';
    if (result.reason === 'configuration-changed') return 'Bạn đã đổi cấu hình trong lúc tối ưu. Đã giữ cấu hình mới nhất của bạn.';
    if (result.reason === 'preview-only') return 'Đã kiểm tra trong kho demo. Tham số cá nhân của bạn được giữ nguyên.';
    if (result.improved) return `Đã áp dụng bộ 34 tham số mới. Sai số kiểm tra giảm ${((1 - result.newLoss / result.oldLoss) * 100).toFixed(1)}% trên ${result.validationCount} lượt.`;
    return 'Đã kiểm tra: bộ mới chưa tốt hơn trên lịch sử dành riêng để đánh giá. Tiếp tục dùng bộ hiện tại.';
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
        const timeout = setTimeout(() => finish(new Error('Quá thời gian tối ưu. Bạn có thể thử lại.')), 30000);
        const finish = (error, result) => { clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(result); };
        worker.onerror = () => finish(new Error('Không khởi động được bộ tối ưu.'));
        worker.onmessage = async ({ data }) => {
            if (data.type === 'ERROR') { finish(new Error(data.payload)); return; }
            if (data.type !== 'OPTIMIZATION_COMPLETE') return;
            try {
                const result = data.payload;
                // A newer manual configuration made while training always wins.
                if (result.improved && getState().userFsrs7TrainedAt !== baselineTime) {
                    result.improved = false; result.reason = 'configuration-changed';
                }
                if (result.improved && (isPreviewMode() || sessionStorage.getItem('CHEAT_MODE') === 'true')) {
                    result.improved = false; result.reason = 'preview-only';
                }
                if (result.improved && !isPreviewMode() && sessionStorage.getItem('CHEAT_MODE') !== 'true') {
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
