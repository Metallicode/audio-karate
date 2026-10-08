// Aural exciter: generates new harmonics from the top of the spectrum and blends them in,
// for more presence and air than a treble boost gives. The band above the tune frequency is driven hard
// into an even-symmetric curve, which only creates harmonics (an octave up and beyond) and never adds back
// a copy of the band itself, so it brightens without simply boosting the treble or dulling loud passages.
window.createAudioKarateExciter = window.createAudioKarateExciter || (function() {
    const BUTTERWORTH_Q = -3.0103;  // Lowpass/highpass Q is in dB, this is 1/sqrt(2)
    const DRIVE = 16;               // +24 dB, so the band's usual -50 to -20 dBFS reaches the bend of the curve
    const MAX_MIX = 8;              // Wet level at 100%. On a mix-like spectrum: about +3 dB above 6 kHz at 50%, +7 dB at 100%
    const TIME_CONSTANT = 0.1;

    // tanh(drive * x)^2 / drive: squares quiet signals (pure 2nd harmonic, growing with level)
    // and flattens out on loud ones, so sibilants don't turn harsh. Odd size puts an exact 0 at the centre.
    const CURVE = (() => {
        const size = 8193;
        const curve = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            const x = i / (size - 1) * 2 - 1;
            curve[i] = Math.tanh(DRIVE * x) ** 2 / DRIVE;
        }
        return curve;
    })();

    // Oversampling (needed to keep the harmonics from aliasing) delays the wet signal. The dry signal is
    // delayed to match so the harmonics line up with the transients that made them. Measured once in frames,
    // since it doesn't depend on the sample rate.
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

        // Steep split, so only the top of the spectrum feeds the curve
        const high = [filter('highpass', 3000), filter('highpass', 3000)];

        const dryDelay = context.createDelay(0.1);
        latencyFrames.then(frames => { dryDelay.delayTime.value = frames / context.sampleRate; });

        const shaper = context.createWaveShaper();
        shaper.curve = CURVE;
        shaper.oversample = '4x';
        // Squaring also leaves DC, the band's envelope and low difference tones, none of them above the tune
        const cleanup = [filter('highpass', 3000), filter('highpass', 3000)];
        const mix = context.createGain();
        mix.gain.value = 0; // Starts off

        input.connect(dryDelay).connect(output);
        input.connect(high[0]).connect(high[1]).connect(shaper)
            .connect(cleanup[0]).connect(cleanup[1]).connect(mix).connect(output);

        function set(amount, frequency, instant) {
            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(mix.gain, amount / 100 * MAX_MIX);
            [...high, ...cleanup].forEach(f => apply(f.frequency, frequency));
        }

        return { input, output, set };
    };
})();
