/* global localStorage */
(function(){
  const MAX = 18;        // scale top (ft)
  const FLAT_MAX = 1;    // FLAT ends at 1ft
  const BOTTOM_PAD = 0.5;   // visual-only pad so 0 ft isn’t exactly at the bottom

  const WaveSelector = {};
  let cfg = null;

  // state (feet, integers)
  const state = { funEnd: 3, solidEnd: 6 };

  // dom refs
  let host, wsCard, elBar, elScale, bands, thumbs, hot, labels;

  // helpers
  const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
  const roundTo = (v, step) => Math.round(v / step) * step;
  const rect = () => elBar.getBoundingClientRect();
    const pxFromFt = ft => {
    const h = rect().height;
    // map [ -BOTTOM_PAD … MAX ] to [ bottom … top ]
    return h - ((ft + BOTTOM_PAD) / (MAX + BOTTOM_PAD)) * h;
    };

    const ftFromClientY = clientY => {
    const r = rect();
    const y = clientY - r.top;
    const h = r.height;
    // invert the mapping; clamp to the real [0 … MAX] domain
    const ft = (MAX + BOTTOM_PAD) * (1 - (y / h)) - BOTTOM_PAD;
    return clamp(ft, 0, MAX);
    };
  const getClientY = (e) => (e.touches?.[0]?.clientY ?? e.clientY);

  // build inner markup once
  function buildDOM(){
    if (!host) return;
    host.innerHTML = `
      <div class="ws-head">
        <div>
          <div class="ws-title">Find Your Edge</div>
          <div class="ws-sub">Set your comfort zones (ft)</div>
        </div>
        <button type="button" class="ws-close" id="ws-close">Set</button>
      </div>

      <div class="gauge" id="wsGauge">
        <div class="bar" id="wsBar">
          <div class="scale" id="wsScale"></div>

          <div class="band flat"  id="bFlat"></div>
          <div class="band fun"   id="bFun"></div>
          <div class="band solid" id="bSolid"></div>
          <div class="band big"   id="bBig"></div>
        </div>

        <div class="rail" id="wsRail">
          <div class="hotspot" id="wsHot"></div>
          <div class="thumb fun"   id="tFun"   tabindex="0" role="slider" aria-label="Fun max"></div>
          <div class="thumb solid" id="tSolid" tabindex="0" role="slider" aria-label="Solid max"></div>
        </div>
      </div>
    `;

    wsCard  = document.getElementById('wsCard') || host.closest('#wsCard');
    elBar   = host.querySelector('#wsBar');
    elScale = host.querySelector('#wsScale');

    bands = {
      flat:  host.querySelector('#bFlat'),
      fun:   host.querySelector('#bFun'),
      solid: host.querySelector('#bSolid'),
      big:   host.querySelector('#bBig'),
    };
    thumbs = {
      fun:   host.querySelector('#tFun'),
      solid: host.querySelector('#tSolid'),
    };
    hot = host.querySelector('#wsHot');








    // labels on bands
    labels = {
      flat:  mkLabel(bands.flat,  true),
      fun:   mkLabel(bands.fun),
      solid: mkLabel(bands.solid),
      big:   mkLabel(bands.big),
    };


    // --- Ensure the Set chip lives under the donut (right column) ---
    (function ensureSetChipInRightColumn(){
      const slot = document.getElementById('ws-set-slot');         // in HTML
      if (!slot) return;

      // Prefer an existing button if buildDOM created it
      let btn = host.querySelector('#ws-close') || document.getElementById('ws-close');

      // If not present (or hidden in a removed header), create one
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ws-close';
        btn.className = 'ws-close';
        btn.textContent = 'Set';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          window.WaveSelector?.close(true);
        });
      }

      // Move/append into the slot (idempotent)
      if (btn.parentElement !== slot) slot.appendChild(btn);
      btn.classList.add('ws-close--chip');
      // console.log('[WS] set chip placed in #ws-set-slot (buildDOM)');
    })();





    // scale
    buildScale();
    new ResizeObserver(() => { buildScale(); render(); }).observe(elBar);

    // interactions
    ['fun','solid'].forEach(k => {
      const start = makeDragStarter(k);
      thumbs[k].addEventListener('pointerdown', start, { passive:false });
      thumbs[k].addEventListener('touchstart',  start, { passive:false });
    });
    hot.addEventListener('pointerdown', onRailPress);
    hot.addEventListener('touchstart',  onRailPress, { passive:false });

    // keyboard (focused thumb): ↑/↓ 1ft
    document.addEventListener('keydown', (e) => {
      let changed = false;
      if (document.activeElement === thumbs.fun) {
        if (e.key === 'ArrowUp')   { state.funEnd   = clamp(state.funEnd + cfg.step, FLAT_MAX + cfg.step, state.solidEnd - cfg.step); changed = true; }
        if (e.key === 'ArrowDown') { state.funEnd   = clamp(state.funEnd - cfg.step, FLAT_MAX + cfg.step, state.solidEnd - cfg.step); changed = true; }
      }
      if (document.activeElement === thumbs.solid) {
        if (e.key === 'ArrowUp')   { state.solidEnd = clamp(state.solidEnd + cfg.step, state.funEnd + cfg.step, MAX); changed = true; }
        if (e.key === 'ArrowDown') { state.solidEnd = clamp(state.solidEnd - cfg.step, state.funEnd + cfg.step, MAX); changed = true; }
      }
      if (changed){
        e.preventDefault();
        snapToStep();
        render();
        emitChange();
      }
    });

    // close button
    host.querySelector('#ws-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      WaveSelector.close(true);
    });
  }

  function mkLabel(parent, isFlat=false){
    const el = document.createElement('div');
    el.className = 'band-label' + (isFlat ? ' band-label--flat' : '');
    el.style.top = '50%';
    parent.appendChild(el);
    return el;
  }

  function buildScale(){
    if (!elScale) return;
    elScale.innerHTML = '';
    for (let ft = 0; ft <= MAX; ft += 1) {
      const y = pxFromFt(ft);
      const tick = document.createElement('div');
      tick.className = 'tick' + (ft % 2 === 0 ? ' major' : '');
      tick.style.top = `${y}px`;
      elScale.appendChild(tick);

      if (ft % 2 === 0) {
        const lab = document.createElement('div');
        lab.className = 'tick-label';
        lab.style.top = `${y}px`;
        lab.textContent = `${ft} ft`;
        elScale.appendChild(lab);
      }
    }
  }

  function render(){
    const y = pxFromFt;
    const f0 = 0, f1 = FLAT_MAX, fF = state.funEnd, fS = state.solidEnd, fM = MAX;

    // band rectangles
    setBand(bands.flat,  y(f1), y(f0) - y(f1));
    setBand(bands.fun,   y(fF), y(f1) - y(fF));
    setBand(bands.solid, y(fS), y(fF) - y(fS));
    setBand(bands.big,   y(fM), y(fS) - y(fM));

    // thumbs
    thumbs.fun.style.top   = `${y(fF)}px`;
    thumbs.solid.style.top = `${y(fS)}px`;

    // labels
    labels.flat.textContent  = `FLAT 0–${f1} ft`;
    labels.fun.textContent   = `FUN ${f1}–${fF} ft`;
    labels.solid.textContent = `SOLID ${fF}–${fS} ft`;
    labels.big.textContent   = `BIG ${fS}–∞ ft`;

    // keep FLAT label readable if very shallow
    const flatH = Math.max(0, y(f0) - y(f1));
    labels.flat.style.transform = (flatH < 20) ? 'translateY(-40%)' : 'translateY(-50%)';

    // ARIA
    thumbs.fun.setAttribute('aria-valuemin', String(FLAT_MAX + cfg.step));
    thumbs.fun.setAttribute('aria-valuemax', String(state.solidEnd - cfg.step));
    thumbs.fun.setAttribute('aria-valuenow', String(state.funEnd));

    thumbs.solid.setAttribute('aria-valuemin', String(state.funEnd + cfg.step));
    thumbs.solid.setAttribute('aria-valuemax', String(MAX));
    thumbs.solid.setAttribute('aria-valuenow', String(state.solidEnd));
  }

  function setBand(el, top, height){
    el.style.top = `${top}px`;
    el.style.height = `${Math.max(0, height)}px`;
  }

  function snapToStep(){
    state.funEnd   = roundTo(state.funEnd, cfg.step);
    state.solidEnd = roundTo(state.solidEnd, cfg.step);
  }

  function emitChange(){
    if (!cfg?.onChange) return;
    const consUpper = Infinity; // BIG has no cap
    const edges = {
      flat:        [0, FLAT_MAX],
      fun:         [FLAT_MAX, state.funEnd],
      solid:       [state.funEnd, state.solidEnd],
      consequence: [state.solidEnd, consUpper],
    };
    cfg.onChange(edges);
  }

  /* dragging */
  function makeDragStarter(which){
    const isFun = (which === 'fun');
    const thumbEl = isFun ? thumbs.fun : thumbs.solid;
    let activeId = null;

    const onMove = (ev) => {
      const ft = ftFromClientY(getClientY(ev));
      if (isFun) {
        state.funEnd = clamp(ft, FLAT_MAX + cfg.step, state.solidEnd - cfg.step);
        if (cfg.liveSnap) snapToStep();
      } else {
        state.solidEnd = clamp(ft, state.funEnd + cfg.step, MAX);
        if (cfg.liveSnap) snapToStep();
      }
      render();
      emitChange();
    };

    const onUp = () => {
      if (activeId !== null && thumbEl.releasePointerCapture) {
        try { thumbEl.releasePointerCapture(activeId); } catch {}
      }
      snapToStep();
      render();
      emitChange();
      off();
    };

    const off = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mouseleave', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };

    return (ev) => {
      ev.preventDefault();
      if (ev.pointerId != null && thumbEl.setPointerCapture) {
        activeId = ev.pointerId;
        try { thumbEl.setPointerCapture(activeId); } catch {}
      }
      window.addEventListener('pointermove', onMove, { passive:false });
      window.addEventListener('pointerup', onUp, { passive:true });
      window.addEventListener('pointercancel', onUp, { passive:true });
      window.addEventListener('mouseleave', onUp, { passive:true });
      window.addEventListener('touchmove', onMove, { passive:false });
      window.addEventListener('touchend', onUp, { passive:true });
      window.addEventListener('touchcancel', onUp, { passive:true });
    };
  }

  function onRailPress(e){
    e.preventDefault();
    const ft = ftFromClientY(getClientY(e));
    const df = Math.abs(ft - state.funEnd);
    const ds = Math.abs(ft - state.solidEnd);
    const which = (df <= ds) ? 'fun' : 'solid';
    if (which === 'fun') {
      state.funEnd = clamp(ft, FLAT_MAX + cfg.step, state.solidEnd - cfg.step);
    } else {
      state.solidEnd = clamp(ft, state.funEnd + cfg.step, MAX);
    }
    snapToStep();
    render();
    emitChange();
  }

  /* mounting + sheet controls */
  function ensureMountTop(){
    // keep #wsCard at a safe top level
    let root = document.getElementById('ws-root');
    if (!root){
      root = document.createElement('div');
      root.id = 'ws-root';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
      document.body.appendChild(root);
    }
    if (wsCard && wsCard.parentElement !== root) root.appendChild(wsCard);
    if (wsCard) wsCard.style.pointerEvents = 'auto';
  }

  /* ===== public API ====================================================== */
  WaveSelector.init = function init(options){
    cfg = {
      hostId: options?.hostId || 'wave-selector',
      step: Number(options?.step || 1),
      liveSnap: options?.liveSnap ?? true,
      onChange: typeof options?.onChange === 'function' ? options.onChange : null,
      onClose:  typeof options?.onClose  === 'function' ? options.onClose  : null,
      edges: options?.edges || null,
    };

    host = document.getElementById(cfg.hostId);
    if (!host) return;

    // seed state from edges (if provided)
    if (cfg.edges){
      const f = Number(cfg.edges.fun?.[1] ?? 3);
      const s = Number(cfg.edges.solid?.[1] ?? 6);
      state.funEnd   = clamp(roundTo(f, cfg.step), FLAT_MAX + cfg.step, MAX - cfg.step);
      state.solidEnd = clamp(roundTo(s, cfg.step), state.funEnd + cfg.step, MAX);
    }

    buildDOM();
    render();
  };

  WaveSelector.open = function open(){
    wsCard = document.getElementById('wsCard') || wsCard;
    if (!wsCard) return;
    ensureMountTop();

    wsCard.style.removeProperty('display');
    wsCard.setAttribute('aria-hidden','false');
    void wsCard.offsetHeight;      // kick transition
    wsCard.classList.add('is-open');

    // focus for keyboard control
    thumbs.fun?.focus({ preventScroll:true });
  };

  WaveSelector.close = function close(byButton=false){
    if (!wsCard) return;
    wsCard.classList.remove('is-open');
    const done = () => {
      wsCard.style.display = 'none';
      wsCard.setAttribute('aria-hidden','true');
      wsCard.removeEventListener('transitionend', done);
      if (byButton && cfg.onClose) cfg.onClose();   // let the page drive UI state
    };
    wsCard.addEventListener('transitionend', done, { once:true });
    setTimeout(done, 260); // safety
  };

  WaveSelector.setEdges = function setEdges(edges){
    if (!edges) return;
    const f = Number(edges.fun?.[1] ?? state.funEnd);
    const s = Number(edges.solid?.[1] ?? state.solidEnd);
    state.funEnd   = clamp(roundTo(f, cfg.step), FLAT_MAX + cfg.step, MAX - cfg.step);
    state.solidEnd = clamp(roundTo(s, cfg.step), state.funEnd + cfg.step, MAX);
    render();
  };

  WaveSelector.getEdges = function getEdges(){
    return {
      flat:        [0, FLAT_MAX],
      fun:         [FLAT_MAX, state.funEnd],
      solid:       [state.funEnd, state.solidEnd],
      consequence: [state.solidEnd, Infinity],
    };
  };

  window.WaveSelector = WaveSelector;
})();