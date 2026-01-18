document.addEventListener('DOMContentLoaded', () => {
    setupListeners();
    injectAudioEngine().then(() => {
        setTimeout(() => {
            updateAudioEngine();
            connectToVisualizer(); // Start the data stream
        }, 200);
    });
});

const presets = {
    movie: { threshold: -24, ratio: 4, attack: 0.05, release: 0.25, hp: true, deess: true },
    speech: { threshold: -35, ratio: 10, attack: 0.003, release: 0.1, hp: true, deess: true },
    music: { threshold: -10, ratio: 2, attack: 0.1, release: 0.5, hp: false, deess: false }
};

function setupListeners() {
    // Bypass Logic
    document.getElementById('bypassBtn').addEventListener('change', (e) => {
        const isBypassed = e.target.checked;
        document.body.classList.toggle('bypassed', isBypassed);
        updateAudioEngine();
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            applyPreset(e.target.id.replace('mode-', ''));
        });
    });

    document.getElementById('advanced-btn').addEventListener('click', () => {
        const panel = document.getElementById('advanced-controls');
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });

    const inputs = ['preGain', 'threshold', 'ratio', 'attack', 'release'];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', updateAudioEngine);
    });

    document.getElementById('hpFilter').addEventListener('change', updateAudioEngine);
    document.getElementById('deEsser').addEventListener('change', updateAudioEngine);
}

// ... [applyPreset function remains same as before] ...
function applyPreset(type) {
    const p = presets[type];
    if (!p) return;
    document.getElementById('threshold').value = p.threshold;
    document.getElementById('ratio').value = p.ratio;
    document.getElementById('attack').value = p.attack;
    document.getElementById('release').value = p.release;
    document.getElementById('hpFilter').checked = p.hp;
    document.getElementById('deEsser').checked = p.deess;
    updateAudioEngine();
}

async function injectAudioEngine() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['audio-engine.js']
    });
}

async function updateAudioEngine() {
    // Update Text UI
    document.getElementById('boost-val').innerText = document.getElementById('preGain').value + ' dB';
    document.getElementById('thresh-val').innerText = document.getElementById('threshold').value + ' dB';
    document.getElementById('ratio-val').innerText = document.getElementById('ratio').value + ':1';
    
    // Check Bypass
    const isBypassed = document.getElementById('bypassBtn').checked;

    const settings = {
        bypass: isBypassed, // New Flag
        preGain: parseFloat(document.getElementById('preGain').value),
        threshold: parseFloat(document.getElementById('threshold').value),
        ratio: parseFloat(document.getElementById('ratio').value),
        attack: parseFloat(document.getElementById('attack').value),
        release: parseFloat(document.getElementById('release').value),
        hpFilter: document.getElementById('hpFilter').checked,
        deEsser: document.getElementById('deEsser').checked
    };

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
        chrome.tabs.sendMessage(tab.id, { command: "UPDATE_AUDIO", settings: settings });
    } catch (e) { /* Tab not ready */ }
}

// THE NEW VISUALIZER CONNECTION
async function connectToVisualizer() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Open a long-lived connection
    const port = chrome.tabs.connect(tab.id, { name: "meter-connection" });
    
    port.onMessage.addListener((msg) => {
        if (msg.reduction) {
            // Update the red bar width
            // Reduction is usually 0 to -20dB. We map 0dB->0%, -20dB->100%
            const db = Math.abs(msg.reduction); 
            const percentage = Math.min((db / 20) * 100, 100);
            document.getElementById('gr-meter').style.width = percentage + "%";
        }
    });
}
