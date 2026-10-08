// Split-band de-esser built from native Web Audio nodes (an AudioWorklet can be blocked by the page's CSP).
// The signal is split at the crossover and only the high band goes through a fast compressor,
// so sibilance ("s", "sh", "t") is turned down only when it's loud, without dulling everything else.
window.createAudioKarateDeEsser = window.createAudioKarateDeEsser || (function() {
    const CROSSOVER = 5000;           // Hz, sibilance sits roughly between 5 and 10 kHz
    const BUTTERWORTH_Q = -3.0103;    // Lowpass/highpass Q is in dB, this is 1/sqrt(2)
    const RATIO = 6;
    const KNEE = 6;
    const ATTACK = 0.002;
    const RELEASE = 0.08;
    const TIME_CONSTANT = 0.1;

    // DynamicsCompressorNode adds automatic makeup gain that depends on its threshold, ratio and knee.
    // Left alone it would boost the high band, so it's measured once per threshold and cancelled out.
    const makeupCache = new Map();

    function measureMakeup(threshold) {
        if (!makeupCache.has(threshold)) {
            const ctx = new OfflineAudioContext(1, 12000, 48000);
            const osc = ctx.createOscillator();
            osc.frequency.value = 8000; // In the band the compressor actually sees
            const quiet = ctx.createGain();
            quiet.gain.value = 0.001; // -60 dB, below any threshold the popup offers
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = threshold;
            compressor.ratio.value = RATIO;
            compressor.knee.value = KNEE;
            compressor.attack.value = ATTACK;
            compressor.release.value = RELEASE;
            osc.connect(quiet).connect(compressor).connect(ctx.destination);
            osc.start();

            makeupCache.set(threshold, ctx.startRendering().then(buffer => {
                // Compare RMS over the second half, once the detector has settled
                const data = buffer.getChannelData(0);
                let sum = 0;
                for (let i = data.length / 2; i < data.length; i++) sum += data[i] * data[i];
                const inputRms = 0.001 / Math.SQRT2;
                return Math.sqrt(sum / (data.length / 2)) / inputRms;
            }));
        }
        return makeupCache.get(threshold);
    }

    return function createDeEsser(context) {
        const input = context.createGain();
        const output = context.createGain();

        const filter = (type) => {
            const f = context.createBiquadFilter();
            f.type = type;
            f.frequency.value = CROSSOVER;
            f.Q.value = BUTTERWORTH_Q;
            return f;
        };

        // Linkwitz-Riley crossover (two Butterworths per band), so the bands sum back flat
        const low = [filter('lowpass'), filter('lowpass')];
        const high = [filter('highpass'), filter('highpass')];

        // The compressor delays its output by 6ms of whole frames, the low band has to match or they comb
        const lowDelay = context.createDelay(0.1);
        lowDelay.delayTime.value = Math.floor(0.006 * context.sampleRate) / context.sampleRate;

        const compressor = context.createDynamicsCompressor();
        compressor.knee.value = KNEE;
        compressor.attack.value = ATTACK;
        compressor.release.value = RELEASE;
        compressor.threshold.value = 0;
        compressor.ratio.value = 1; // Starts off, ratio 1 passes the band through untouched

        const makeupCancel = context.createGain();

        input.connect(low[0]).connect(low[1]).connect(lowDelay).connect(output);
        input.connect(high[0]).connect(high[1]).connect(compressor).connect(makeupCancel).connect(output);

        let latestRequest = 0;

        async function set(enabled, threshold, instant) {
            const request = ++latestRequest;
            const makeup = enabled ? await measureMakeup(threshold) : 1;
            if (request !== latestRequest) return; // A newer change arrived while measuring

            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(compressor.threshold, enabled ? threshold : 0);
            apply(compressor.ratio, enabled ? RATIO : 1);
            apply(makeupCancel.gain, 1 / makeup);
        }

        return {
            input,
            output,
            set,
            get reduction() { return compressor.reduction; }
        };
    };
})();
