// Sub bass boost for full-range systems, followed by a safety limiter.
// It sits after the main compressor so the extra bass doesn't make it pump. Boosted bass easily pushes
// the output past full scale, where the browser hard-clips, so the limiter catches peaks while the boost is on.
window.createAudioKarateSubBass = window.createAudioKarateSubBass || (function() {
    const Q = 0.9; // A broad bump around the frequency, not a shelf, so inaudible rumble below isn't boosted
    const LIMITER = { threshold: -1, ratio: 20, knee: 0, attack: 0.001, release: 0.1 };
    const TIME_CONSTANT = 0.1;

    return function createSubBass(context) {
        const boost = context.createBiquadFilter();
        boost.type = 'peaking';
        boost.Q.value = Q;
        boost.gain.value = 0;
        boost.frequency.value = 50;

        const limiter = context.createDynamicsCompressor();
        limiter.knee.value = LIMITER.knee;
        limiter.attack.value = LIMITER.attack;
        limiter.release.value = LIMITER.release;
        limiter.threshold.value = 0;
        limiter.ratio.value = 1; // Starts off, ratio 1 passes everything through untouched

        const makeupCancel = context.createGain();

        boost.connect(limiter).connect(makeupCancel);

        let latestRequest = 0;

        async function set(gain, frequency, instant) {
            const request = ++latestRequest;
            const on = gain > 0;
            const makeup = on ? await window.measureAudioKarateMakeup(LIMITER, 1000) : 1;
            if (request !== latestRequest) return; // A newer change arrived while measuring

            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(boost.gain, gain);
            apply(boost.frequency, frequency);
            apply(limiter.threshold, on ? LIMITER.threshold : 0);
            apply(limiter.ratio, on ? LIMITER.ratio : 1);
            apply(makeupCancel.gain, 1 / makeup);
        }

        return {
            input: boost,
            output: makeupCancel,
            set,
            get reduction() { return limiter.reduction; }
        };
    };
})();
