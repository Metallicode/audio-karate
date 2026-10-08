// Mix to mono: (L + R) / 2 on both speakers, for one earbud, a single speaker, or hard-panned old mixes.
// The stereo and mono paths run side by side and crossfade, since switching channel counts live would click.
window.createAudioKarateMono = window.createAudioKarateMono || (function() {
    const TIME_CONSTANT = 0.1;

    return function createMono(context) {
        const input = context.createGain();
        const output = context.createGain(); // Mixes the mono path back up to both channels

        const stereo = context.createGain();

        // A single explicit channel makes the browser do the downmix, which also folds 5.1 down properly
        const mono = context.createGain();
        mono.channelCount = 1;
        mono.channelCountMode = 'explicit';
        mono.channelInterpretation = 'speakers';
        mono.gain.value = 0; // Starts in stereo

        input.connect(stereo).connect(output);
        input.connect(mono).connect(output);

        function set(on, instant) {
            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(stereo.gain, on ? 0 : 1);
            apply(mono.gain, on ? 1 : 0);
        }

        return { input, output, set };
    };
})();
