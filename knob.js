// Rotary knob: drag up/down, scroll, or use the arrow keys when focused. Double-click resets to the default.
// Behaves like a range input: read/write element.value, listen for 'input'.
const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;
const KNOB_DRAG_PIXELS = 150; // Drag distance for the full range

function knobPoint(angle, radius) {
    const rad = angle * Math.PI / 180;
    return (24 + radius * Math.sin(rad)).toFixed(2) + ' ' + (24 - radius * Math.cos(rad)).toFixed(2);
}

function knobArc(from, to) {
    const radius = 20;
    const largeArc = to - from > 180 ? 1 : 0;
    return `M ${knobPoint(from, radius)} A ${radius} ${radius} 0 ${largeArc} 1 ${knobPoint(to, radius)}`;
}

function makeKnob(el, format) {
    const min = parseFloat(el.dataset.min);
    const max = parseFloat(el.dataset.max);
    const step = parseFloat(el.dataset.step);
    const defaultValue = parseFloat(el.dataset.default);
    const decimals = (String(step).split('.')[1] || '').length;
    let value = defaultValue;

    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-valuemin', min);
    el.setAttribute('aria-valuemax', max);
    el.innerHTML = `<svg viewBox="0 0 48 48">
        <path class="knob-track" d="${knobArc(KNOB_MIN_ANGLE, KNOB_MAX_ANGLE)}"/>
        <path class="knob-fill"/>
        <circle class="knob-cap" cx="24" cy="24" r="14"/>
        <line class="knob-pointer" x1="24" y1="20" x2="24" y2="12"/>
    </svg>`;
    const fill = el.querySelector('.knob-fill');
    const pointer = el.querySelector('.knob-pointer');

    const snap = (v) => {
        const stepped = Math.round((v - min) / step) * step + min;
        return parseFloat(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
    };

    const render = () => {
        const angle = KNOB_MIN_ANGLE + (value - min) / (max - min) * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);
        fill.setAttribute('d', angle > KNOB_MIN_ANGLE ? knobArc(KNOB_MIN_ANGLE, angle) : '');
        pointer.setAttribute('transform', `rotate(${angle} 24 24)`);
        el.setAttribute('aria-valuenow', value);
        el.setAttribute('aria-valuetext', format(value));
    };

    // Only user changes fire 'input', like a real range input
    const change = (v) => {
        v = snap(v);
        if (v === value) return;
        value = v;
        render();
        el.dispatchEvent(new Event('input'));
    };

    Object.defineProperty(el, 'value', {
        get: () => value,
        set: (v) => { value = snap(parseFloat(v)); render(); }
    });

    let dragStartY = 0;
    let dragStartValue = 0;
    el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        dragStartY = e.clientY;
        dragStartValue = value;
        el.focus();
    });
    el.addEventListener('pointermove', (e) => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        change(dragStartValue + (dragStartY - e.clientY) / KNOB_DRAG_PIXELS * (max - min));
    });

    el.addEventListener('wheel', (e) => {
        e.preventDefault();
        change(value + (e.deltaY < 0 ? step : -step));
    }, { passive: false });

    el.addEventListener('keydown', (e) => {
        const keys = {
            ArrowUp: value + step, ArrowRight: value + step,
            ArrowDown: value - step, ArrowLeft: value - step,
            PageUp: value + step * 10, PageDown: value - step * 10,
            Home: min, End: max
        };
        if (!(e.key in keys)) return;
        e.preventDefault();
        change(keys[e.key]);
    });

    el.addEventListener('dblclick', () => change(defaultValue));

    render();
}
