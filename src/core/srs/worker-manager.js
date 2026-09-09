import { getState, setUserSrsParams } from '../state.js';
import { showPopup } from '../../ui/modal.js';
import { getSettingFromDB, saveSettingToDB } from '../idb.js';

let isOptimizing = false;

export async function checkAndRunOptimizer() {
    if (isOptimizing) return;
    
    const { reviewLogs } = getState();
    const lastOptimizedLength = await getSettingFromDB('lastOptimizedLength') || 0;

    const logsLen = reviewLogs.logs ? reviewLogs.logs.length : reviewLogs.length;
    // Chạy bộ tối ưu nếu đủ 400 logs VÀ có thêm 200 logs mới so với lần chạy trước
    if (reviewLogs && logsLen >= 400 && logsLen - lastOptimizedLength >= 200) {
        runOptimizer(reviewLogs, lastOptimizedLength);
    }
}

export function runOptimizer(logs, lastOptimizedLength) {
    if (window.Worker) {
        isOptimizing = true;
        console.log("Khởi động Optimizer Worker...");

        const worker = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });

        // Timeout 30 giây
        const timeoutId = setTimeout(() => {
            console.error("Optimizer Worker timeout (>30s). Terminating.");
            isOptimizing = false;
            worker.terminate();
        }, 30000);

        worker.postMessage({ type: 'START_OPTIMIZATION', payload: logs });

        worker.onmessage = async (e) => {
            clearTimeout(timeoutId);
            const { type, payload } = e.data;
            if (type === 'OPTIMIZATION_COMPLETE') {
                console.log("Worker trả về kết quả:", payload);
                const statusData = {
                    timestamp: new Date().toLocaleString(),
                    improved: payload.improved,
                    oldLoss: payload.oldLoss,
                    newLoss: payload.newLoss
                };
                await saveSettingToDB('lastOptimizationStatus', statusData);
                
                if (payload.improved) {
                    await setUserSrsParams(payload.recallParams, payload.lapseParams);
                    // Sync to firebase?
                    import('../sync.js').then(m => m.syncUserSettingsToFirebase());
                    console.log("Bộ nhớ cá nhân hoá đã được cập nhật thành công!");
                } else {
                    console.log("Bộ thông số mặc định vẫn đang tốt hơn. Không cập nhật.");
                }
                
                const logsLen = logs.logs ? logs.logs.length : logs.length;
                await saveSettingToDB('lastOptimizedLength', logsLen);
                isOptimizing = false;
                worker.terminate();
            } else if (type === 'ERROR') {
                console.error("Worker Error:", payload);
                isOptimizing = false;
                worker.terminate();
            }
        };

        worker.onerror = (e) => {
            clearTimeout(timeoutId);
            console.error("Lỗi khởi tạo Worker:", e);
            isOptimizing = false;
            worker.terminate();
        };
    } else {
        console.warn("Trình duyệt không hỗ trợ Web Worker. Bỏ qua CMA-ES.");
    }
}


