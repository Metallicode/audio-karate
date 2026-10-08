document.addEventListener('DOMContentLoaded', () => {
    setupListeners();
    init();
});

const presets = {
    movie: { threshold: -24, ratio: 4, attack: 0.05, release: 0.25, hpFilter: true, deEsser: true, deEssThreshold: -30 },
    speech: { threshold: -35, ratio: 10, attack: 0.003, release: 0.1, hpFilter: true, deEsser: true, deEssThreshold: -35 },
    music: { threshold: -10, ratio: 2, attack: 0.1, release: 0.5, hpFilter: false, deEsser: false, deEssThreshold: -30 }
};

// Mono, sub bass and exciter aren't part of the presets, they depend on the speakers and taste rather than the content
const defaults = { mode: 'movie', bypass: false, preGain: 0, mono: false, subBoost: 0, subFreq: 50, exciterAmount: 0, exciterFreq: 3000, ...presets.movie };
const STORAGE_KEY = 'audioKarate.lastSettings';

let tabId = null;
let currentMode = defaults.mode;

async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['compressor-makeup.js', 'de-esser.js', 'exciter.js', 'sub-bass.js', 'mono.js', 'limiter.js', 'audio-engine.js']
        });
    } catch (e) {
        // chrome:// pages, the Web Store, and other pages extensions can't touch
        document.body.classList.add('unavailable');
        setStatus("Audio Karate can't run on this page.");
        return;
    }
    tabId = tab.id;

    // Pick up where this tab left off, otherwise start from the last settings used anywhere
    const states = await runInTab(() => window.AudioKarateEngine && window.AudioKarateEngine.getState());
    const existing = states.find(s => s && s.settings);
    applyToUI(existing ? { ...defaults, ...existing.settings } : loadLastSettings());

    await updateAudioEngine();
    connectToVisualizer();
}

function setupListeners() {
    makeKnob(document.getElementById('subBoost'), formatSubBoost);
    makeKnob(document.getElementById('subFreq'), v => v + ' Hz');
    makeKnob(document.getElementById('exciterAmount'), v => v + '%');
    makeKnob(document.getElementById('exciterFreq'), formatKHz);

    // Bypass Logic
    document.getElementById('bypassBtn').addEventListener('change', (e) => {
        document.body.classList.toggle('bypassed', e.target.checked);
        updateAudioEngine();
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => applyPreset(e.currentTarget.id.replace('mode-', '')));
    });

    document.getElementById('advanced-btn').addEventListener('click', (e) => {
        const panel = document.getElementById('advanced-controls');
        const show = panel.style.display !== 'block';
        panel.style.display = show ? 'block' : 'none';
        e.target.innerText = show ? 'Hide Advanced Settings ▲' : 'Show Advanced Settings ▼';
    });

    ['preGain', 'subBoost', 'subFreq', 'exciterAmount', 'exciterFreq'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateAudioEngine);
    });

    // Anything a preset controls switches the mode to custom once it's tweaked by hand
    const onCustomChange = () => {
        setMode('custom');
        updateAudioEngine();
    };
    ['threshold', 'ratio', 'attack', 'release', 'deEssThreshold'].forEach(id => {
        document.getElementById(id).addEventListener('input', onCustomChange);
    });
    document.getElementById('hpFilter').addEventListener('change', onCustomChange);
    document.getElementById('mono').addEventListener('change', updateAudioEngine);
    document.getElementById('deEsser').addEventListener('change', (e) => {
        document.body.classList.toggle('deess-off', !e.target.checked);
        onCustomChange();
    });
}

function applyPreset(type) {
    const p = presets[type];
    if (!p) return;
    applyToUI({ ...readSettings(), ...p, mode: type });
    updateAudioEngine();
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.id === 'mode-' + mode));
}

function applyToUI(s) {
    document.getElementById('bypassBtn').checked = s.bypass;
    document.body.classList.toggle('bypassed', s.bypass);
    document.getElementById('preGain').value = s.preGain;
    document.getElementById('threshold').value = s.threshold;
    document.getElementById('ratio').value = s.ratio;
    document.getElementById('attack').value = s.attack;
    document.getElementById('release').value = s.release;
    document.getElementById('hpFilter').checked = s.hpFilter;
    document.getElementById('deEsser').checked = s.deEsser;
    document.getElementById('mono').checked = s.mono;
    document.getElementById('deEssThreshold').value = s.deEssThreshold;
    document.getElementById('subBoost').value = s.subBoost;
    document.getElementById('subFreq').value = s.subFreq;
    document.getElementById('exciterAmount').value = s.exciterAmount;
    document.getElementById('exciterFreq').value = s.exciterFreq;
    document.body.classList.toggle('deess-off', !s.deEsser);
    setMode(s.mode);
    updateLabels();
}

function updateLabels() {
    document.getElementById('boost-val').innerText = document.getElementById('preGain').value + ' dB';
    document.getElementById('thresh-val').innerText = document.getElementById('threshold').value + ' dB';
    document.getElementById('ratio-val').innerText = document.getElementById('ratio').value + ':1';
    document.getElementById('attack-val').innerText = document.getElementById('attack').value + 's';
    document.getElementById('release-val').innerText = document.getElementById('release').value + 's';
    document.getElementById('deess-val').innerText = document.getElementById('deEssThreshold').value + ' dB';
    const subBoost = document.getElementById('subBoost').value;
    document.getElementById('subBoost-val').innerText = formatSubBoost(subBoost);
    document.getElementById('subFreq-val').innerText = document.getElementById('subFreq').value + ' Hz';
    document.getElementById('exciterAmount-val').innerText = document.getElementById('exciterAmount').value + '%';
    document.getElementById('exciterFreq-val').innerText = formatKHz(document.getElementById('exciterFreq').value);
    document.getElementById('hp-label').innerText = subBoost > 0 ? '20Hz Rumble Cut' : '80Hz Cut';
}

function readSettings() {
    return {
        mode: currentMode,
        bypass: document.getElementById('bypassBtn').checked,
        preGain: parseFloat(document.getElementById('preGain').value),
        threshold: parseFloat(document.getElementById('threshold').value),
        ratio: parseFloat(document.getElementById('ratio').value),
        attack: parseFloat(document.getElementById('attack').value),
        release: parseFloat(document.getElementById('release').value),
        hpFilter: document.getElementById('hpFilter').checked,
        deEsser: document.getElementById('deEsser').checked,
        mono: document.getElementById('mono').checked,
        deEssThreshold: parseFloat(document.getElementById('deEssThreshold').value),
        subBoost: document.getElementById('subBoost').value,
        subFreq: document.getElementById('subFreq').value,
        exciterAmount: document.getElementById('exciterAmount').value,
        exciterFreq: document.getElementById('exciterFreq').value
    };
}

function formatKHz(v) {
    return (v / 1000).toFixed(1) + ' kHz';
}

function formatSubBoost(v) {
    return v > 0 ? '+' + v + ' dB' : '0 dB';
}

function loadLastSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        // Bypass is per tab, so a new tab always starts active
        if (saved) return { ...defaults, ...saved, bypass: false };
    } catch (e) { /* Missing or corrupt, use defaults */ }
    return defaults;
}

function saveLastSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* Storage unavailable, settings just won't carry over */ }
}

// Runs func in every frame the engine is in and returns each frame's result
async function runInTab(func, args = []) {
    try {
        const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
        return results.map(r => r.result);
    } catch (e) {
        return []; // Tab navigated away or closed
    }
}

let sending = false;
let pending = false;

async function updateAudioEngine() {
    updateLabels();
    if (tabId === null) return;

    const settings = readSettings();
    saveLastSettings(settings);

    // Slider drags fire faster than the tab can answer, so only the latest value is sent once it does
    if (sending) {
        pending = true;
        return;
    }
    sending = true;
    const states = await runInTab((s) => window.AudioKarateEngine && window.AudioKarateEngine.update(s), [settings]);
    sending = false;
    showMediaStatus(states);

    if (pending) {
        pending = false;
        updateAudioEngine();
    }
}

function showMediaStatus(states) {
    const total = { hooked: 0, failed: 0, blocked: 0 };
    states.forEach(s => {
        if (!s) return;
        total.hooked += s.hooked;
        total.failed += s.failed;
        total.blocked += s.blocked;
    });

    if (total.hooked) setStatus('');
    else if (total.failed) setStatus("This player is already used by another audio tool. Reload the page and try again.");
    else if (total.blocked) setStatus("This player's audio comes from another site, so the browser won't let it be processed.");
    else setStatus("No audio or video found yet. Press play and it'll be picked up.");
}

function setStatus(text) {
    const el = document.getElementById('status');
    el.innerText = text;
    el.style.display = text ? 'block' : 'none';
}

// THE VISUALIZER CONNECTION
function connectToVisualizer() {
    // Open a long-lived connection
    const port = chrome.tabs.connect(tabId, { name: "meter-connection" });
    port.onDisconnect.addListener(() => void chrome.runtime.lastError); // No receiver, nothing to show

    // Every frame with the engine reports its own reduction, so the meter shows the loudest recent one
    const frames = new Map();
    port.onMessage.addListener((msg) => {
        if (typeof msg.reduction !== 'number') return;
        const now = performance.now();
        frames.set(msg.frame, { db: Math.abs(msg.reduction), time: now });

        let db = 0;
        frames.forEach(f => { if (now - f.time < 250) db = Math.max(db, f.db); });

        // Reduction is usually 0 to -20dB. We map 0dB->0%, -20dB->100%
        const percentage = Math.min((db / 20) * 100, 100);
        document.getElementById('gr-meter').style.width = percentage + "%";
    });
}
