(function() {
    if (window.AudioKarateEngine) {
        console.log("Audio Karate: Engine already running.");
        return;
    }

    const frameId = Math.random().toString(36).slice(2); // Lets the popup tell frames apart on the meter port
    const hooked = new WeakSet(); // Media elements routed through the chain
    const failed = new WeakSet(); // Media elements that couldn't be routed

    let context = null;
    let nodes = null;     // One processing chain per frame, shared by every media element in it
    let settings = null;  // Stays null until the popup sends settings

    function buildChain() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        context = new AudioContext();
        nodes = {};

        nodes.hpFilter = context.createBiquadFilter();
        nodes.hpFilter.type = 'highpass';

        nodes.preGain = context.createGain();

        nodes.deEsser = context.createBiquadFilter();
        nodes.deEsser.type = 'peaking';
        nodes.deEsser.frequency.value = 7000;
        nodes.deEsser.Q.value = 1.0;

        nodes.compressor = context.createDynamicsCompressor();
        nodes.compressor.knee.value = 10;

        // Chain
        nodes.hpFilter.connect(nodes.preGain);
        nodes.preGain.connect(nodes.deEsser);
        nodes.deEsser.connect(nodes.compressor);
        nodes.compressor.connect(context.destination);
    }

    // Web Audio outputs silence for media from another origin that wasn't loaded with CORS,
    // and routing can't be undone, so those elements are left alone.
    function isCrossOrigin(el) {
        if (el.srcObject || el.crossOrigin) return false;
        try {
            const url = new URL(el.currentSrc);
            return url.protocol.startsWith('http') && url.origin !== location.origin;
        } catch (e) {
            return false; // No source yet, or blob:/data: which are same-origin
        }
    }

    function hook(el) {
        if (hooked.has(el) || failed.has(el)) return;
        if (!el.srcObject && !el.currentSrc) return; // Nothing loaded yet, picked up again on play
        if (isCrossOrigin(el)) return;

        const isNewChain = !context;
        if (isNewChain) buildChain();

        try {
            context.createMediaElementSource(el).connect(nodes.hpFilter);
            hooked.add(el);
            if (isNewChain) applySettings(settings, true);
        } catch (e) {
            // Already attached to another AudioContext (the page's own, or an older copy of this extension)
            console.error("Audio Karate:", e);
            failed.add(el);
            if (isNewChain) {
                context.close();
                context = null;
                nodes = null;
            }
        }
    }

    function hookAll() {
        document.querySelectorAll('video, audio').forEach(hook);
    }

    function resume() {
        if (context && context.state === 'suspended') context.resume();
    }

    function getState() {
        const elements = [...document.querySelectorAll('video, audio')];
        return {
            settings: settings,
            media: elements.length,
            hooked: elements.filter(el => hooked.has(el)).length,
            failed: elements.filter(el => failed.has(el)).length,
            blocked: elements.filter(el => !hooked.has(el) && isCrossOrigin(el)).length
        };
    }

    function update(newSettings) {
        settings = newSettings;
        hookAll();
        resume();
        if (context) applySettings(settings);
        return getState();
    }

    // Media that starts later (single-page sites swapping players, lazy-loaded audio) gets picked up when it plays
    document.addEventListener('play', (e) => {
        if (!settings || !(e.target instanceof HTMLMediaElement)) return;
        hook(e.target);
        resume();
    }, true);

    // LISTENER FOR THE VISUALIZER PORT
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== "meter-connection") return;

        // While the popup is open, loop to send data
        let animationId;
        const loop = () => {
            if (nodes) {
                // .reduction is a float (e.g. -3.5) represents gain reduction in dB
                port.postMessage({ frame: frameId, reduction: nodes.compressor.reduction });
            }
            animationId = requestAnimationFrame(loop);
        };

        loop(); // Start loop

        // Stop loop when popup closes
        port.onDisconnect.addListener(() => {
            cancelAnimationFrame(animationId);
        });
    });

    function applySettings(s, instant) {
        const n = nodes;
        const now = context.currentTime;
        const timeConstant = 0.1;
        // A freshly built chain jumps straight to its values instead of ramping from the defaults
        const set = (param, value) => instant ? (param.value = value) : param.setTargetAtTime(value, now, timeConstant);

        if (s.bypass) {
            // SOFT BYPASS: Set values to neutral rather than disconnecting nodes
            // This prevents clicking artifacts
            set(n.preGain.gain, 1); // 0dB
            set(n.hpFilter.frequency, 0); // Off
            set(n.deEsser.gain, 0); // Off
            set(n.compressor.threshold, 0); // No compression
            set(n.compressor.ratio, 1); // 1:1 ratio
        } else {
            // ACTIVE MODE
            const linearGain = Math.pow(10, s.preGain / 20);
            set(n.preGain.gain, linearGain);
            set(n.hpFilter.frequency, s.hpFilter ? 80 : 0);
            set(n.deEsser.gain, s.deEsser ? -6 : 0);
            set(n.compressor.threshold, s.threshold);
            set(n.compressor.ratio, s.ratio);
            set(n.compressor.attack, s.attack);
            set(n.compressor.release, s.release);
        }
    }

    window.AudioKarateEngine = { update, getState };
})();
