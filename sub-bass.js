// Sub bass boost for full-range systems. It sits after the main compressor so the extra bass doesn't
// make it pump, and the limiter after it catches the peaks it adds.
window.createAudioKarateSubBass = window.createAudioKarateSubBass || (function() {
    const Q = 0.9; // A broad bump around the frequency, not a shelf, so inaudible rumble below isn't boosted
    const TIME_CONSTANT = 0.1;

    return function createSubBass(context) {
        const boost = context.createBiquadFilter();
        boost.type = 'peaking';
        boost.Q.value = Q;
        boost.gain.value = 0;
        boost.frequency.value = 50;

        function set(gain, frequency, instant) {
            const now = context.currentTime;
            const apply = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, TIME_CONSTANT);
            apply(boost.gain, gain);
            apply(boost.frequency, frequency);
        }

        return { input: boost, output: boost, set };
    };
})();
