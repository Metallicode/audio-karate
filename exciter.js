// Aural exciter: generates new harmonics from the top of the spectrum and blends a little back in,
// for more presence and air than a treble boost gives. A crossover at the tune frequency splits the signal;
// the high band is saturated, filtered to drop the low-frequency byproducts, and mixed back in parallel.
// The dry signal is the crossover's two bands summed, so the wet one is in phase with it and never cancels.
window.createAudioKarateExciter = window.createAudioKarateExciter || (function() {
    const BUTTERWORTH_Q = -3.0103;  // Lowpass/highpass Q is in dB, this is 1/sqrt(2)
    const CLEANUP_RATIO = 0.25;     // The byproduct filter sits well below the tune so it barely shifts the phase
    const DRIVE = 4;
    const BIAS = 0.2;               // Asymmetry adds even (warm) harmonics alongside the odd (bright) ones
    const MAX_MIX = 0.5;            // Wet level at 100%
    const TIME_CONSTANT = 0.1;

    // Saturation curve, normalised so quiet signals pass at unity gain and loud ones get rounded off
    const CURVE = (() => {
        const size = 4096;
        const curve = new Float32Array(size);
        const offset = Math.tanh(DRIVE * BIAS);
        const slope = DRIVE * (1 - offset * offset);
        for (let i = 0; i < size; i++) {
            const x = i / (size - 1) * 2 - 1;
            curve[i] = (Math.tanh(DRIVE * (x + BIAS)) - offset) / slope;
        }
        return curve;
    })();

    // Oversampling (needed to keep the harmonics from aliasing) delays the wet signal. The dry signal is
    // delayed to match or the two comb. Measured once in frames, since it doesn't depend on the sample rate.
    const latencyFrames = (() => {
        const ctx = new OfflineAudioContext(1, 2048, 48000);
        const impulse = ctx.createBuffer(1, 1, 48000);
        impulse.getChannelData(0)[0] = 0.01;
        const source = ctx.createBufferSource();
        source.buffer = impulse;
        const shaper = ctx.createWaveShaper();
        shaper.curve = new Float32Array([-1, 1]); // Identity, only the oversampling delay is left
        shaper.oversample = '4x';
        source.connect(shaper).connect(ctx.destination);
        source.start();
        return ctx.startRendering().then(buffer => {
            const data = buffer.getChannelData(0);
            let peak = 0;
            data.forEach((v, i) => { if (Math.abs(v) > Math.abs(data[peak])) peak = i; });
            return peak;
        });
    })();

    return function createExciter(context) {
        const input = context.createGain();
        const output = context.createGain();

        const filter = (type, frequency) => {
            const f = context.createBiquadFilter();
            f.type = type;
            f.frequency.value = frequency;
            f.Q.value = BUTTERWORTH_Q;
            return f;
        };

        // Linkwitz-Riley crossover (two Butterworths per band), so the bands sum back flat
        const low = [filter('lowpass', 3000), filter('lowpass', 3000)];
        const high = [filter('highpass', 3000), filter('highpass', 3000)];

        const dryDelay = context.createDelay(0.1);
        latencyFrames.then(frames => { dryDelay.delayTime.value = frames / context.sampleRate; });

        const shaper = context.createWaveShaper();
        shaper.curve = CURVE;
        shaper.oversample = '4x';
        const cleanup = filter('highpass', 3000 * CLEANUP_RATIO);
        const mix = context.createGain();
        mix.gain.value = 0; // Starts off

        input.connect(low[0]).connect(low[1]).connect(dryDelay);
        input.connect(high[0]).connect(high[1]).connect(dryDelay);
        dryDelay.connect(output);
        high[1].connect(shaper).connect(cleanup).connect(mix).connect(output);

        function set(amount, frequency, instant) {
            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(mix.gain, amount / 100 * MAX_MIX);
            [...low, ...high].forEach(f => apply(f.frequency, frequency));
            apply(cleanup.frequency, frequency * CLEANUP_RATIO);
        }

        return { input, output, set };
    };
})();
