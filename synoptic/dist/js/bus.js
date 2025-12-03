// Simple app-wide event bus.
// Usage:
//   bus.on('regionChange', (e) => console.log(e.detail))
//   bus.emit('regionChange', { country:'GB', area:'Cornwall' })

(() => {
  const et = new EventTarget();

  const emit = (type, detail) => {
    try { et.dispatchEvent(new CustomEvent(type, { detail })); }
    catch { /* Safari 15 polyfill */ 
      const ev = document.createEvent('CustomEvent');
      ev.initCustomEvent(type, false, false, detail);
      et.dispatchEvent(ev);
    }
  };

  const on  = (type, fn, opts) => et.addEventListener(type, fn, opts);
  const off = (type, fn, opts) => et.removeEventListener(type, fn, opts);

  // postMessage bridge helpers (optional, used by mobile frame)
  const postToMap = (type, payload) => {
    try { document.getElementById('mob-map')?.contentWindow?.postMessage({ type, payload }, '*'); } catch {}
  };

  window.bus = { emit, on, off, postToMap };
    /* ===================== DEV DEBUG BLOCK (bus logger) ======================
    * Enable:
    *   - URL:   ?debug=bus           (any truthy value)
    *   - Local: localStorage.setItem('busDebug','1')
    * Disable:
    *   - remove query OR localStorage.removeItem('busDebug')
    * Remove block later by deleting this section.
    * ======================================================================= */
    (() => {
    try {
        const urlFlag = (() => {
        const m = (location.search || '').match(/[?&]debug=([^&]+)/i);
        return m && m[1] && !/^0|false|null|off$/i.test(m[1]);
        })();
        const lsFlag = !!(typeof localStorage !== 'undefined' && localStorage.getItem('busDebug'));
        const ON = !!(urlFlag || lsFlag);
        if (!ON) return;

        const EMO = {
        regionChange: '🔥',
        navGo:        '🗺️',
        navSync:      '🧭',
        mapReady:     '✅',
        spotHover:    '🎯',
        spotClick:    '👉',
        spotSelect:   '👉',
        spotFocus:    '🔎',
        spotChosen:   '✨',
        spotLock:     '🔒',
        mapResetNEA:  '↩️',
        default:      '📣'
        };

        const STYLE = 'padding:2px 6px;border-radius:6px;background:#0b2239;color:#cde3ff;font-weight:700';
        const SUB   = 'color:#9fb3c8';

        // de-duplicate identical bursts for readability
        let lastLine = '';
        let lastAt = 0;

        function printLine(icon, label, sub, obj){
        const now = performance.now();
        const sig = label + '|' + sub + '|' + JSON.stringify(obj||{});
        if (sig === lastLine && (now - lastAt) < 80) return;
        lastLine = sig; lastAt = now;

        console.log(`%c${icon} ${label}%c ${sub}`, STYLE, SUB);
        if (obj && typeof obj === 'object') {
            // show a compact summary, expand payload separately
            const brief = {};
            for (const k of ['country','area','from','type']) if (k in obj) brief[k] = obj[k];
            if (Object.keys(brief).length) console.log('  ', brief);
            console.groupCollapsed('  payload');
            console.log(obj);
            console.groupEnd();
        }
        }

        // Wrap bus.emit
        const origEmit = window.bus.emit;
        window.bus.emit = (type, detail) => {
        try {
            const icon = EMO[type] || EMO.default;
            const sub  = (detail && (detail.from || detail.source)) ? `from: ${(detail.from || detail.source)}` : '';
            printLine(icon, `[bus.emit] ${type}`, sub, detail);
        } catch (e) { /* no-op */ }
        try { origEmit(type, detail); } catch (e) { console.warn(e); }
        };

        // postMessage tap (map / iframe chatter)
        const interesting = new Set(['mapReady','navGo','navSync','spotHover','spotClick','spotSelect','spotFocus','spotChosen','spotLock','mapResetNEA']);
        window.addEventListener('message', (ev) => {
        const d = ev.data || {};
        if (!d || !d.type || !interesting.has(d.type)) return;
        const icon = EMO[d.type] || EMO.default;
        const pl = d.payload ?? d.detail ?? d;
        printLine(icon, `[msg] ${d.type}`, '', pl);
        });

        // Quick console helpers
        window.busDebug = {
        on()  { try { localStorage.setItem('busDebug','1'); } catch {} location.reload(); },
        off() { try { localStorage.removeItem('busDebug'); } catch {} location.reload(); }
        };

        console.log('%c[bus debug] ON', 'color:#7cf');
    } catch (e) {
        console.warn('[bus debug] init failed', e);
    }
    })();


})();

