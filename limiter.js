// Safety limiter at the end of the chain. The sub boost and the exciter both add level, which easily pushes
// the output past full scale where the browser hard-clips, so it catches peaks while either is on.
// Otherwise it's off, so the sound is unchanged for anyone not using them.
window.createAudioKarateLimiter = window.createAudioKarateLimiter || (function() {
    const LIMITER = { threshold: -1, ratio: 20, knee: 0, attack: 0.001, release: 0.1 };
    const TIME_CONSTANT = 0.1;

    return function createLimiter(context) {
        const limiter = context.createDynamicsCompressor();
        limiter.knee.value = LIMITER.knee;
        limiter.attack.value = LIMITER.attack;
        limiter.release.value = LIMITER.release;
        limiter.threshold.value = 0;
        limiter.ratio.value = 1; // Starts off, ratio 1 passes everything through untouched

        const makeupCancel = context.createGain();

        limiter.connect(makeupCancel);

        let latestRequest = 0;

        async function set(on, instant) {
            const request = ++latestRequest;
            const makeup = on ? await window.measureAudioKarateMakeup(LIMITER, 1000) : 1;
            if (request !== latestRequest) return; // A newer change arrived while measuring

            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(limiter.threshold, on ? LIMITER.threshold : 0);
            apply(limiter.ratio, on ? LIMITER.ratio : 1);
            apply(makeupCancel.gain, 1 / makeup);
        }

        return {
            input: limiter,
            output: makeupCancel,
            set,
            get reduction() { return limiter.reduction; }
        };
    };
})();
