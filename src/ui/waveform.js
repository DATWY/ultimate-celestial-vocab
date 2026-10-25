// src/ui/waveform.js — Audio Waveform Visualizer
//
// Hiệu ứng nút loa giờ bám sự kiện phát thật (playing/ended của Audio,
// onstart/onend của SpeechSynthesis — xem sound.js) thay vì một vòng lặp
// anime.js thời lượng cố định như trước. Toàn bộ animation nằm trong CSS,
// module này chỉ giữ đúng trạng thái class `is-playing`.

let safetyTimer = null;

function getTtsBtn() {
    return typeof document !== 'undefined' ? document.getElementById('tts-btn') : null;
}

export function setWaveformPlaying(playing) {
    const ttsBtn = getTtsBtn();
    if (!ttsBtn) return;
    ttsBtn.classList.toggle('is-playing', !!playing);
    if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
    }
    if (playing) {
        // Lưới an toàn: nếu sự kiện kết thúc không bao giờ đến (trình duyệt
        // nuốt event, tab treo...), hiệu ứng tự tắt sau 15 giây.
        safetyTimer = setTimeout(() => setWaveformPlaying(false), 15000);
    }
}

// Tương thích ngược: coi như "bắt đầu phát" — kết thúc do sự kiện thật lo.
export function triggerAudioWaveformAnimation() {
    setWaveformPlaying(true);
}
