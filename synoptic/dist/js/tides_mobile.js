/* Tide renderer (mobile)
   - expects: window.TIDES (per-day tides incl. by_port/ext/sunrise/sunset)
              window.MOON  (either {emoji,name} or {ISO:{emoji,name}})
   - draws into: <svg id="tide-svg"> (configurable via option targetId)
   - public API: TideMobile.renderTideForDay(iso, opts)
                 TideMobile.renderForPort(portName, offset=0, opts)
                 TideMobile.setTidePrefChip(pref)
                 TideMobile.setMoonPhaseChip(dayOffset=0)
                 TideMobile.dayISO(offset)
*/
(function(){
  const SVGNS   = 'http://www.w3.org/2000/svg';
  const TIDE_SRC = window.TIDES || {};

  // ---- small date helpers ---------------------------------------------------
  function _todayBase(){ return new Date(); }
  function dayInfo(offset){
    const base = new Date(_todayBase());
    base.setDate(base.getDate() + Number(offset||0));
    const iso = base.toISOString().slice(0,10);
    return { iso, date: base };
  }
  function dayISO(offset){ return dayInfo(offset).iso; }

    // Replace your current resolveStation with this:
    function resolveStation(humanName, isoHint) {
        if (!humanName) return null;
        const want = String(humanName).trim().toLowerCase();

        // choose a real day to inspect (today if available, else first)
        const iso = (isoHint && TIDE_SRC[isoHint]) ? isoHint
                    : (TIDE_SRC[dayISO(0)] ? dayISO(0)
                    : Object.keys(TIDE_SRC)[0]);

        const byPort = (TIDE_SRC?.[iso]?.by_port) || {};
        if (!byPort || !Object.keys(byPort).length) return null;

        // 1) direct lower-case key
        if (byPort[want]) return want;

        // 2) match against the human-readable name stored in the data items
        for (const [k, arr] of Object.entries(byPort)) {
            const human = String(arr?.[0]?.port || '').trim().toLowerCase();
            if (human === want) return k; // return the canonical key (often lower-case)
        }

        // 3) relaxed fallback: ignore spaces/punct
        const norm = s => String(s).toLowerCase().replace(/[\s'’`.-]+/g,'');
        const wantN = norm(want);
        for (const k of Object.keys(byPort)) {
            if (norm(k) === wantN) return k;
        }
        return null;
    }

  // ---- tide scale across the 3 tabs (same logic as TV) ----------------------
  function tideScaleForTabs(){
    const days = [dayISO(0), dayISO(1), dayISO(2)];
    let min = Infinity, max = -Infinity;
    days.forEach(d => {
      const exts = (TIDE_SRC?.[d]?.ext) || [];
      exts.forEach(e => {
        const h = e.h;
        if (Number.isFinite(h)) { if (h < min) min = h; if (h > max) max = h; }
      });
    });
    if (!isFinite(min) || !isFinite(max) || min === max) { min = 0; max = 5; }
    const pad = (max - min) * 0.15;
    return [min - pad, max + pad];
  }

  // ---- window computation (from TV page), but using LOCAL Date pairs --------
  function _subtractIntervals(dayStart, dayEnd, forb){
    const S = dayStart.getTime(), E = dayEnd.getTime();
    const bad = forb
      .map(([s,e]) => [Math.max(S, +s), Math.min(E, +e)])
      .filter(([s,e]) => e > s)
      .sort((a,b)=>a[0]-b[0]);
    const merged = [];
    for (const seg of bad){
      if (!merged.length || seg[0] > merged[merged.length-1][1]) merged.push(seg);
      else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], seg[1]);
    }
    const good = []; let cur = S;
    for (const [bs,be] of merged){
      if (bs > cur) good.push([cur, bs]);
      cur = Math.max(cur, be);
    }
    if (cur < E) good.push([cur, E]);
    return good.map(([s,e]) => [new Date(s), new Date(e)]);
  }

  // Build tide windows from the selected port’s extrema (LOCAL dates in, LOCAL pairs out)
  function computeWindowsForPrefFromExt(iso, tidePref, extList){
    if (!tidePref || !Array.isArray(extList) || !extList.length) return [];
    const pref     = String(tidePref).toUpperCase().replace(' ONLY', '');
    const dayStart = new Date(iso + 'T00:00:00');
    const dayEnd   = new Date(iso + 'T23:59:59');
    const MINS     = m => m * 60 * 1000;

    // Tunables (minutes)
    const PAD_ONLY   = 60;   // HIGH ONLY / LOW ONLY  ±1h
    const PAD_MID_1  = 60;   // MID TIDE: start  +1h
    const PAD_MID_2  = 120;  // MID TIDE: end    +2h
    const PAD_BLOCK  = 45;   // NOT HIGH/NOT LOW: blackout half-width

    const highs = [], lows = [];
    for (const e of extList) {
      const k = String(e.k || '').toUpperCase();
      const t = new Date(e.t);
      if (k === 'H') highs.push(t);
      else if (k === 'L') lows.push(t);
    }

    const clip = (s, e) => {
      const S = Math.max(dayStart.getTime(), s.getTime());
      const E = Math.min(dayEnd.getTime(),   e.getTime());
      return E > S ? [new Date(S), new Date(E)] : null;
    };
    const around = (ts, padMins) =>
      ts.map(t => clip(new Date(t.getTime() - MINS(padMins)),
                       new Date(t.getTime() + MINS(padMins))))
        .filter(Boolean);

    const merge = (intervals) => {
      if (!intervals.length) return [];
      const iv = intervals.slice().sort((a,b)=>a[0]-b[0]);
      const out = [iv[0]];
      for (let i=1;i<iv.length;i++){
        const [s,e] = iv[i], last = out[out.length-1];
        if (s <= last[1]) last[1] = new Date(Math.max(last[1], e));
        else out.push([s,e]);
      }
      return out;
    };

    let wins = [];
    switch (pref) {
      case 'ALL':     wins = [[dayStart, dayEnd]]; break;
      case 'HIGH':    wins = merge(around(highs, PAD_ONLY)); break;
      case 'LOW':     wins = merge(around(lows,  PAD_ONLY)); break;
      case 'MID TIDE':{
        const mids = [];
        for (const t of highs.concat(lows)) {
          const s = new Date(t.getTime() + MINS(PAD_MID_1));
          const e = new Date(t.getTime() + MINS(PAD_MID_2));
          const iv = clip(s, e);
          if (iv) mids.push(iv);
        }
        wins = merge(mids);
        break;
      }
      case 'NOT HIGH':{
        const blocks = around(highs, PAD_BLOCK);
        wins = merge(_subtractIntervals(dayStart, dayEnd, blocks));
        break;
      }
      case 'NOT LOW':{
        const blocks = around(lows, PAD_BLOCK);
        wins = merge(_subtractIntervals(dayStart, dayEnd, blocks));
        break;
      }
      default:
        wins = [[dayStart, dayEnd]];
    }
    return wins;
  }

  // ---- main renderer (same behaviour/visuals as TV) ------------------------
  function renderTideForDay(
    iso,
    { showNow=false, windows=[], colour='', tidePref=null, station=null, targetId='tide-svg' } = {}
  ){
    const box = document.getElementById(targetId);
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);

    // Measure robustly (SVGs often report clientWidth=0 inside CSS Grid)
    const parentRect = box.parentElement ? box.parentElement.getBoundingClientRect() : {width:0,height:0};
    const rect       = box.getBoundingClientRect();

    const measuredW  = Math.floor(rect.width || parentRect.width || 0);
    const measuredH  = Math.floor(rect.height || parentRect.height || 0);

    // Sensible fallbacks: prefer the dial height if available, else a minimum
    const cssDial    = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dial')) || 112;
    const fallbackH  = cssDial + 12;

    // Final canvas size
    const W = Math.max(260, measuredW || 320);
    const H = Math.max(96,  measuredH || fallbackH);

    // Keep the viewBox in sync so stroke/labels scale properly
    box.setAttribute('viewBox', `0 0 ${W} ${H}`);
    box.setAttribute('preserveAspectRatio', 'none');

    // Slimmer paddings + clamped inner size
    const PADL = 8, PADR = 8, PADT = 4, PADB = 18;
    const innerW = Math.max(1, W - PADL - PADR);
    const innerH = Math.max(1, H - PADT - PADB);

    // keep the tide axis aligned with the dial base visually
    const axisY = Math.round(PADT + innerH - 1.5);  // -1.5px gives subtle lift

    // Per-day record
    const data = TIDE_SRC[iso] || {};

    // Resolve the human station name to canonical key for this day
    const wantKey = resolveStation(station, iso) || String(station||'').trim().toLowerCase();

    // Pick extrema for this station
    let todayExt = [];
    if (data.by_port && wantKey && data.by_port[wantKey]) {
      todayExt = data.by_port[wantKey].slice();
    } else if (Array.isArray(data.ext)) {
      const want = String(station || '').trim().toLowerCase().replace(/\s+/g,'');
      todayExt = want
        ? data.ext.filter(e => String(e.port||e.station||e.source).trim().toLowerCase().replace(/\s+/g,'') === want)
        : data.ext.slice();
    }
    if (!todayExt.length) return;

    // Recompute windows if a tide pref is set
    if (tidePref) {
      windows = computeWindowsForPrefFromExt(iso, tidePref, todayExt);
    } else if (!Array.isArray(windows)) {
      windows = [];
    }

    // Day bounds & sun times
    const parse = s => new Date(s);
    const t0 = new Date(iso + 'T00:00:00');
    const t1 = new Date(iso + 'T23:59:59');
    const sunrise = data.sunrise ? parse(data.sunrise) : null;
    const sunset  = data.sunset  ? parse(data.sunset)  : null;

    // Stitch yday/today/tomorrow extrema for this same station key
    const keyNoSpaces =
      (wantKey || String(todayExt[0]?.port || '').trim().toLowerCase()).replace(/\s+/g,'');

    function extremaForDayPort(dayIso, keyNS){
      const d = TIDE_SRC[dayIso] || {};
      if (d.by_port) {
        if (d.by_port[keyNS]) return d.by_port[keyNS].map(e => ({...e, _t: parse(e.t)}));
        const relaxed = Object.keys(d.by_port).find(k => k.replace(/\s+/g,'') === keyNS);
        if (relaxed)   return d.by_port[relaxed].map(e => ({...e, _t: parse(e.t)}));
      }
      const list = Array.isArray(d.ext) ? d.ext : [];
      return list
        .filter(e => String(e.port||e.station||e.source).trim().toLowerCase().replace(/\s+/g,'') === keyNS)
        .map(e => ({...e, _t: parse(e.t)}));
    }

    const mid = new Date(iso + 'T12:00:00');
    const yIso = new Date(mid.getTime() - 86400000).toISOString().slice(0,10);
    const nIso = new Date(mid.getTime() + 86400000).toISOString().slice(0,10);

    const yExt = extremaForDayPort(yIso, keyNoSpaces).sort((a,b)=>a._t - b._t);
    const tExt = todayExt.map(e => ({...e, _t: parse(e.t)})).sort((a,b)=>a._t - b._t);
    const nExt = extremaForDayPort(nIso, keyNoSpaces).sort((a,b)=>a._t - b._t);

    const all = [...yExt, ...tExt, ...nExt];

    // ---- Scales
    const [hmin, hmax] = tideScaleForTabs();
    const xOf = (d)=> {
      const u = (d - t0) / (t1 - t0);
      return PADL + Math.max(0, Math.min(1, u)) * innerW;
    };
    const yOf = (h)=> {
      const u = (h - hmin) / (hmax - hmin);
      return PADT + (1-Math.max(0, Math.min(1, u))) * innerH;
    };

    // Ghost caps (prevents flattening at the ends)
    if (all.length >= 2) {
      const first=yExt.length?yExt[0]:tExt[0], second=yExt.length?yExt[1]||tExt[0]:tExt[1];
      const preSpan = Math.max(1, second._t - first._t);
      all.unshift({ _t: new Date(first._t.getTime() - preSpan), h: second.h, k: second.k, _ghost:true });

      const last = nExt.length?nExt[nExt.length-1]:tExt[tExt.length-1];
      const prev = nExt.length>1?nExt[nExt.length-2]:(tExt[tExt.length-2]||tExt[tExt.length-1]);
      const postSpan = Math.max(1, last._t - prev._t);
      all.push({ _t: new Date(last._t.getTime() + postSpan), h: prev.h, k: prev.k, _ghost:true });
    }

    // Night shading
    if (sunrise && sunset){
      const xSR = xOf(sunrise), xSS = xOf(sunset);
      if (xSR > PADL){
        const r = document.createElementNS(SVGNS,'rect');
        r.setAttribute('x', PADL); r.setAttribute('y', PADT);
        r.setAttribute('width', xSR - PADL); r.setAttribute('height', innerH);
        r.setAttribute('class','tide--night'); box.appendChild(r);
      }
      if (xSS < PADL+innerW){
        const r = document.createElementNS(SVGNS,'rect');
        r.setAttribute('x', xSS); r.setAttribute('y', PADT);
        r.setAttribute('width', (PADL+innerW) - xSS); r.setAttribute('height', innerH);
        r.setAttribute('class','tide--night'); box.appendChild(r);
      }
    }

    // Past overlay (today only)
    if (showNow){
      const now = new Date();
      if (now.toISOString().slice(0,10) === iso){
        const xNow = Math.max(PADL, Math.min(PADL + innerW, xOf(now)));
        if (xNow > PADL){
          const p = document.createElementNS(SVGNS,'rect');
          p.setAttribute('x', PADL); p.setAttribute('y', PADT);
          p.setAttribute('width', xNow - PADL); p.setAttribute('height', innerH);
          p.setAttribute('class','tide--past'); box.appendChild(p);
        }
      }
    }

    // Best-window overlays (clip to day + daylight)
    (function drawWindows(){
      if (!Array.isArray(windows) || !windows.length) return;
      if ((colour || '').toLowerCase() === 'red') return;

      const startOfDay = t0.getTime();
      const endOfDay   = t1.getTime();
      const sr = sunrise ? sunrise.getTime() : startOfDay;
      const ss = sunset  ? sunset.getTime()  : endOfDay;

      function clipInterval(a,b){
        let s = Math.max(a, sr, startOfDay);
        let e = Math.min(b, ss, endOfDay);
        return (e > s) ? [s,e] : null;
      }

      windows.forEach(w => {
        const sDt = (w[0] instanceof Date) ? w[0] : new Date(w[0]);
        const eDt = (w[1] instanceof Date) ? w[1] : new Date(w[1]);
        const c = clipInterval(sDt.getTime(), eDt.getTime());
        if (!c) return;
        const x0 = xOf(new Date(c[0])), x1 = xOf(new Date(c[1]));
        const wpx = x1 - x0; if (wpx <= 1) return;

        const rect = document.createElementNS(SVGNS, 'rect');
        rect.setAttribute('x', x0); rect.setAttribute('y', PADT);
        rect.setAttribute('width', wpx); rect.setAttribute('height', innerH);
        rect.setAttribute('class', `tide--window ${colour==='amber' ? 'amber' : 'green'}`);
        box.appendChild(rect);

        const edgeClass = `tide--windowEdge ${colour==='amber' ? 'amber' : 'green'}`;
        const e1 = document.createElementNS(SVGNS, 'line');
        e1.setAttribute('x1', x0); e1.setAttribute('x2', x0);
        e1.setAttribute('y1', PADT); e1.setAttribute('y2', PADT+innerH);
        e1.setAttribute('class', edgeClass); box.appendChild(e1);
        const e2 = document.createElementNS(SVGNS, 'line');
        e2.setAttribute('x1', x1); e2.setAttribute('x2', x1);
        e2.setAttribute('y1', PADT); e2.setAttribute('y2', PADT+innerH);
        e2.setAttribute('class', edgeClass); box.appendChild(e2);
      });
    })();

    // Axis
    const axis = document.createElementNS(SVGNS,'line');
    axis.setAttribute('x1', PADL); axis.setAttribute('x2', PADL+innerW);
    axis.setAttribute('y1', PADT+innerH); axis.setAttribute('y2', PADT+innerH);
    axis.setAttribute('class','tide--axis'); box.appendChild(axis);

    // Minimal ticks at 00 / 12 / 24
    const TICK_HOURS = [0, 12, 24];
    for (const h of TICK_HOURS) {
    const t = new Date(t0.getTime() + h*60*60*1000);
    const x = xOf(t);

    const tick = document.createElementNS(SVGNS,'line');
    tick.setAttribute('x1', x); tick.setAttribute('x2', x);
    tick.setAttribute('y1', PADT+innerH); tick.setAttribute('y2', PADT+innerH-3);
    tick.setAttribute('class','tide--tick');
    box.appendChild(tick);

    const lab = document.createElementNS(SVGNS,'text');
    lab.setAttribute('y', PADT+innerH+11);
    lab.setAttribute('class','tide--tickLabel');
    lab.setAttribute('text-anchor', (h===24 ? 'end' : (h===0 ? 'start' : 'middle')));
    lab.setAttribute('x', h===24 ? x-1 : (h===0 ? x+1 : x));
    lab.textContent = String(h).padStart(2,'0') + ':00';
    box.appendChild(lab);
    }






    // Cosine interpolation across stitched extrema
    function hAt(T){
      if (!all.length) return 0;
      if (all.length === 1) return all[0].h;
      const tt = T.getTime ? T.getTime() : +T;
      let idx = 0;
      for (let i=0;i<all.length-1;i++){
        const A = all[i]._t.getTime(), B = all[i+1]._t.getTime();
        if (tt >= A && tt <= B){ idx = i; break; }
        if (tt >  B) idx = i;
      }
      idx = Math.min(idx, all.length-2);
      const L = all[idx], R = all[idx+1];
      const a=L._t.getTime(), b=R._t.getTime();
      const u = (b === a) ? 0 : Math.max(0, Math.min(1, (tt - a)/(b - a)));
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      return (1 - w) * L.h + w * R.h;
    }

    // Sample curve every 10 min + area fill
    const pts = [];
    for (let t=new Date(t0); t<=t1; t=new Date(t.getTime()+10*60*1000)){
      pts.push([ xOf(t), yOf(hAt(t)) ]);
    }
    const pathD = [
      `M ${PADL} ${PADT+innerH}`,
      `L ${pts[0][0]} ${pts[0][1]}`,
      ...pts.slice(1).map(p=>`L ${p[0]} ${p[1]}`),
      `L ${PADL+innerW} ${PADT+innerH}`,
      'Z'
    ].join(' ');
    const area = document.createElementNS(SVGNS,'path');
    area.setAttribute('d', pathD);
    area.setAttribute('class','tide--water');
    area.setAttribute('stroke-width','1.5');     // add
    box.appendChild(area);

    // H/L dots + “smart” labels (day-only)
    const dayOnly = all.filter(e => e._t >= t0 && e._t <= t1);
    dayOnly.forEach(e=>{
      const cx = xOf(e._t), cy = yOf(e.h);
      const dot = document.createElementNS(SVGNS,'circle');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 3);
      dot.setAttribute('class', e.k === 'H' ? 'tide--markH' : 'tide--markL');
      box.appendChild(dot);

      const [EDGE_PAD, RIGHT_X] = [6, PADL+innerW];
      let lx = cx + 6, anchor='start';
      if (cx > RIGHT_X - 28){ lx = cx - 6; anchor='end'; }
      lx = Math.max(PADL+EDGE_PAD, Math.min(RIGHT_X-EDGE_PAD, lx));

      let ly = (e.k==='H') ? (cy - 6) : (cy + 12);
      const TOP_Y = PADT + EDGE_PAD, BOTTOM_Y = PADT + innerH - EDGE_PAD;
      if (e.k==='L' && ly > BOTTOM_Y) ly = cy - 6;
      if (e.k==='H' && ly < TOP_Y)    ly = cy + 12;
      ly = Math.max(TOP_Y, Math.min(BOTTOM_Y, ly));

      const label = document.createElementNS(SVGNS,'text');
      label.setAttribute('x', lx); label.setAttribute('y', ly);
      label.setAttribute('class','tide--label');
      label.setAttribute('text-anchor', anchor);
      label.textContent = `${e.k} ${String(e.h).replace(/\.0$/,'')}m`;
      box.appendChild(label);
    });

    // “now” cursor
    if (showNow){
      const now = new Date();
      if (now.toISOString().slice(0,10) === iso){
        const x = xOf(now);
        const line = document.createElementNS(SVGNS,'line');
        line.setAttribute('x1', x); line.setAttribute('x2', x);
        line.setAttribute('y1', PADT); line.setAttribute('y2', PADT+innerH);
        line.setAttribute('class','tide--axis'); box.appendChild(line);
      }
    }
  }

  // ---- chips (use mobile IDs) ----------------------------------------------
  function setTidePrefChip(pref){
    const el = document.getElementById('hcTidePref');
    if (!el) return;
    if (!pref) { el.textContent = 'Tide pref: ALL'; return; }
    el.textContent = `Tide pref: ${pref}`;
  }

  function setMoonPhaseChip(dayOffset){
    const el = document.getElementById('hcMoon');
    if (!el) return;
    const isoTonight = dayISO(Number(dayOffset||0) + 1);
    const isoToday   = dayISO(Number(dayOffset||0));
    let m = null;
    if (window.MOON) {
      if (window.MOON.name) m = window.MOON; // single object
      else                  m = window.MOON[isoTonight] || window.MOON[isoToday] || null;
    }
    el.textContent = m ? `${m.emoji || ''} ${m.name || ''}`.trim() : '—';
  }

  // Convenience: render by port name + day offset
  function renderForPort(portName, offset=0, opts={}){
    return renderTideForDay(dayISO(offset), {
      showNow: offset === 0,
      station: portName,
      ...opts
    });
  }

  // ---- expose ---------------------------------------------------------------
  window.TideMobile = {
    renderTideForDay,
    renderForPort,
    computeWindowsForPrefFromExt,
    tideScaleForTabs,
    setTidePrefChip,
    setMoonPhaseChip,
    dayISO,
    resolveStation
  };
})();