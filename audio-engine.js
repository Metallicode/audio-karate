(function() {
    if (window.AudioMasterEngine) {
        console.log("Audio Master: Engine already running.");
        return; 
    }
    
    window.AudioMasterEngine = {
        context: null,
        source: null,
        nodes: {},
        initialized: false,
        settings: {} // Store current settings for un-bypass
    };

    const engine = window.AudioMasterEngine;

    function init() {
        if (engine.initialized) return;

        const mediaElement = document.querySelector('video, audio');
        if (!mediaElement) return;

        if (!mediaElement.crossOrigin) {
            mediaElement.crossOrigin = "anonymous";
        }

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        engine.context = new AudioContext();
        
        try {
            engine.source = engine.context.createMediaElementSource(mediaElement);
            engine.nodes.hpFilter = engine.context.createBiquadFilter();
            engine.nodes.hpFilter.type = 'highpass';
            
            engine.nodes.preGain = engine.context.createGain();
            
            engine.nodes.deEsser = engine.context.createBiquadFilter();
            engine.nodes.deEsser.type = 'peaking';
            engine.nodes.deEsser.frequency.value = 7000;
            engine.nodes.deEsser.Q.value = 1.0; 

            engine.nodes.compressor = engine.context.createDynamicsCompressor();
            engine.nodes.compressor.knee.value = 10; 

            // Chain
            engine.source.connect(engine.nodes.hpFilter);
            engine.nodes.hpFilter.connect(engine.nodes.preGain);
            engine.nodes.preGain.connect(engine.nodes.deEsser);
            engine.nodes.deEsser.connect(engine.nodes.compressor);
            engine.nodes.compressor.connect(engine.context.destination);

            engine.initialized = true;

        } catch (e) { console.error(e); }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === "UPDATE_AUDIO") {
            if (!engine.initialized) init(); 
            if (engine.context && engine.context.state === 'suspended') engine.context.resume();
            
            engine.settings = request.settings; // Save for reference
            applySettings(request.settings);
        }
    });

    // LISTENER FOR THE VISUALIZER PORT
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== "meter-connection") return;
        
        // While the popup is open, loop to send data
        let animationId;
        const loop = () => {
            if (engine.nodes.compressor) {
                // .reduction is a float (e.g. -3.5) represents gain reduction in dB
                port.postMessage({ reduction: engine.nodes.compressor.reduction });
            }
            animationId = requestAnimationFrame(loop);
        };
        
        loop(); // Start loop

        // Stop loop when popup closes
        port.onDisconnect.addListener(() => {
            cancelAnimationFrame(animationId);
        });
    });

    function applySettings(s) {
        if (!engine.context) return;
        const n = engine.nodes;
        const now = engine.context.currentTime;
        const timeConstant = 0.1;

        if (s.bypass) {
            // SOFT BYPASS: Set values to neutral rather than disconnecting nodes
            // This prevents clicking artifacts
            n.preGain.gain.setTargetAtTime(1, now, timeConstant); // 0dB
            n.hpFilter.frequency.setTargetAtTime(0, now, timeConstant); // Off
            n.deEsser.gain.setTargetAtTime(0, now, timeConstant); // Off
            n.compressor.threshold.setTargetAtTime(0, now, timeConstant); // No compression
            n.compressor.ratio.setTargetAtTime(1, now, timeConstant); // 1:1 ratio
        } else {
            // ACTIVE MODE
            const linearGain = Math.pow(10, s.preGain / 20);
            n.preGain.gain.setTargetAtTime(linearGain, now, timeConstant);
            n.hpFilter.frequency.setTargetAtTime(s.hpFilter ? 80 : 0, now, timeConstant);
            n.deEsser.gain.setTargetAtTime(s.deEsser ? -6 : 0, now, timeConstant);
            n.compressor.threshold.setTargetAtTime(s.threshold, now, timeConstant);
            n.compressor.ratio.setTargetAtTime(s.ratio, now, timeConstant);
            n.compressor.attack.setTargetAtTime(s.attack, now, timeConstant);
            n.compressor.release.setTargetAtTime(s.release, now, timeConstant);
        }
    }
})();
