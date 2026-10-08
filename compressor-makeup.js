// DynamicsCompressorNode adds automatic makeup gain that depends on its threshold, ratio, knee and timing.
// Effects that only want the gain reduction (de-esser, limiter) measure it once per setting and cancel it out.
window.measureAudioKarateMakeup = window.measureAudioKarateMakeup || (function() {
    const cache = new Map();

    // params: { threshold, ratio, knee, attack, release }, frequency: a tone in the band the compressor will see
    return function measureMakeup(params, frequency) {
        const key = JSON.stringify([params, frequency]);
        if (!cache.has(key)) {
            const ctx = new OfflineAudioContext(1, 12000, 48000);
            const osc = ctx.createOscillator();
            osc.frequency.value = frequency;
            const quiet = ctx.createGain();
            quiet.gain.value = 0.001; // -60 dB, below any threshold used
            const compressor = ctx.createDynamicsCompressor();
            Object.keys(params).forEach(name => { compressor[name].value = params[name]; });
            osc.connect(quiet).connect(compressor).connect(ctx.destination);
            osc.start();

            cache.set(key, ctx.startRendering().then(buffer => {
                // Compare RMS over the second half, once the detector has settled
                const data = buffer.getChannelData(0);
                let sum = 0;
                for (let i = data.length / 2; i < data.length; i++) sum += data[i] * data[i];
                const inputRms = 0.001 / Math.SQRT2;
                return Math.sqrt(sum / (data.length / 2)) / inputRms;
            }));
        }
        return cache.get(key);
    };
})();
