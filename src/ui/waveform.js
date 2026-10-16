// src/ui/waveform.js — Audio Waveform Visualizer

let waveAnim = null;

export function triggerAudioWaveformAnimation() {
    const ttsBtn = document.getElementById('tts-btn');
    const waves = document.querySelectorAll('.waveform-bar');
    if (!waves || waves.length === 0) return;

    if (ttsBtn) ttsBtn.classList.add('is-playing');

    if (window.anime) {
        if (waveAnim) waveAnim.pause();

        waveAnim = window.anime({
            targets: '.waveform-bar',
            scaleY: () => window.anime.random(0.2, 1.0),
            duration: 170,
            direction: 'alternate',
            loop: 8,
            easing: 'easeInOutQuad',
            complete: () => {
                window.anime({
                    targets: '.waveform-bar',
                    scaleY: 0.22,
                    duration: 220,
                    easing: 'easeOutSine',
                    complete: () => {
                        if (ttsBtn) ttsBtn.classList.remove('is-playing');
                    }
                });
            }
        });
    } else {
        setTimeout(() => {
            if (ttsBtn) ttsBtn.classList.remove('is-playing');
        }, 1400);
    }
}
