// File: js/prototype_sunburst.bundle.js
// Requires d3 to be loaded globally before this file.

window.renderSunburstPrototype = function renderSunburstPrototype(
  containerId = "sunburst-mount", /*, opts */
  opts = {}
) {
  const { onReady } = opts || {};

  // Canonical region: always trust the host / REGION, ignore local <select>s
  const getRegion = () => {
    // Prefer what the host has told us; fall back to window.REGION
    const r = (opts && opts.region) || window.REGION || {};
    return {
      country: r.country ?? 'ALL',
      area:    r.area ?? 'ALL'
    };
  };
  // Optional fast-path: let the host inject already-fetched rows
  const INJECTED_ROWS = Array.isArray(opts?.data) ? opts.data : null;
  const mount = document.getElementById(containerId);
  if (!mount) {
    console.error("Sunburst mount not found:", containerId);
    return;
  }

  // Clean mount before re-render
  mount.innerHTML = "";


  // Reserve space below the donut for the legend chips
  if (getComputedStyle(mount).position === 'static') {
    mount.style.position = 'relative';
  }
  // Reserve enough space for 2 rows of chips and avoid horizontal scroll
  if (!mount.style.paddingBottom) {
    mount.style.paddingBottom = '56px';
  }
  mount.style.maxWidth = '100%';
  mount.style.overflowX = 'hidden';

  
  // Create the SVG inside the mount, centered coordinate system
  const SIZE = 500; // logical viewBox size (fits R_OUT=220 nicely)
  const svg = d3.select(mount)
    .append("svg")
    .attr("class", "sunburst")
    .attr("viewBox", "-250 -250 500 500")  // center-origin
    .attr("role", "img")
    .style("width", "100%")
    .style("height", "100%")
    .style("display", "block");

  // --- Root group (everything that should be nudged lives under here)
  const g = svg.append("g").attr("class", "root");

  // Center widgets live here
  const gCenter = g.append("g").attr("class", "centerLayer");

  // Stable layer scaffolding for z-order control (now under g)
  const layers  = g.append("g").attr("class", "layers");
  const gArcs   = layers.append("g").attr("class", "layer arcs");
  const gSpots  = layers.append("g").attr("class", "layer spots");
  const gLabels = layers.append("g").attr("class", "layer labels");

  // Optional helper for debugging from console
  window.SunburstAPI = window.SunburstAPI || {};
  window.SunburstAPI.ensureLabelsOnTop = () => {
    try { gLabels.raise(); } catch {}
  };





  // ---- Center disc style constants + glow filter ----
  const CENTER_GREY = '#536279ff'; // nice neutral grey that fits palette

  // SVG filter for a soft glow around the center disc
  const defs = svg.append('defs');
  const filt = defs.append('filter')
    .attr('id', 'centerGlow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');

  // A light blur around the shape
  filt.append('feDropShadow')
    .attr('dx', 0)
    .attr('dy', 0)
    .attr('stdDeviation', 3.5)         // tweak to taste (3–6 looks good)
    .attr('flood-color', '#ffffff')    // neutral white glow works over all fills
    .attr('flood-opacity', 0.20);      // subtle; increase for stronger glow


  // Nudge the donut right to clear the slider (tweak values to taste)
  const NUDGE_X = window.innerWidth >= 600 ? 28 : 12;
  g.attr("transform", `translate(${NUDGE_X},0)`);


  // === STEP 1 CONFIG: choose which day JSON to read ===
  const FORECAST_DAY = 0; // ← change to 1 or 2 for day2/day3
  const DATA_URL = `../rag_lab/output/spots_day${FORECAST_DAY}.json`;

  // view: 'PULSE' | 'COUNTRIES' | 'AREAS' | 'SPOTS'
  let VIEW = 'PULSE';
  let SEL_BUCKET = null;      // 'WORKING' | 'LIGHT ONSHORES' | 'NOT HAPPENING'
  let SEL_COUNTRY = null;     // e.g. 'United Kingdom'
  let SEL_AREA = null;
  let LAST_AREA_NEUTRAL = null;

  // colours (reuse yours)
  const BUCKET_COLS = {
    'WORKING':'#16a34a',
    'LIGHT ONSHORES':'#f59e0b',
    'NOT HAPPENING':'#ef4444'
  };

  const WAVE_COLS = {
    FUN:   '#00bcd4',  // cyan-ish for FUN
    SOLID: '#001f3f',  // navy for SOLID
    BIG:   '#4b0082'   // imperial purple for BIG
  };

  // --- lock the host-injected scope so later renders don't fall back to ALL ---
  let SB_LOCKED_ROWS   = null; // array of rows currently in scope
  let SB_LOCKED_REGION = { country: 'ALL', area: 'ALL' };




  // Tell the host (mobile frame) about region changes from the donut
  function notifyHostRegion(region) {
    try {
      const rawName = region?.country ?? 'ALL';   // human name from sunburst, e.g. "United Kingdom"
      const area    = region?.area    ?? 'ALL';

      // 1️⃣ Convert human name → canonical country code
      let cc = 'ALL';
      if (rawName && rawName !== 'ALL') {
        const key = String(rawName).trim().toLowerCase();
        if (window.NAME_TO_CC && window.NAME_TO_CC[key]) {
          cc = window.NAME_TO_CC[key];           // e.g. "united kingdom" → "GB"
        } else {
          // If it already *is* a code (GB, CYM, etc.), just pass it through
          cc = rawName.toUpperCase();
        }
      }

      // 2️⃣ Keep local sunburst options in whatever form is most convenient
      //    (names are fine here – this is *only* for internal sunburst logic)
      opts.region = { ...(opts.region || {}), country: rawName, area };

      // 3️⃣ Tell the host in *code* space — this drives REGION, bus, map and dropdowns
      if (typeof window.setRegion === 'function') {
        console.log('[SUNBURST][notifyHostRegion]', {
          incoming: region,
          cc,
          rawName,
          area
        });

        window.setRegion({
          country: cc,          // ✅ always a code by this point (or ALL)
          area,
          from: 'sunburst-applied',
        });
      }
    } catch (e) {
      console.warn('[sunburst] notifyHostRegion failed', e);
    }
  }

  function notifyHostWaveFilter(mode) {
    try {
      const edges = window.SB_WAVE_EDGES || null;

      // Canonical map mode
      let mapMode = (mode || 'ALL').toUpperCase();
      if (mapMode === 'BIG') mapMode = 'CONSEQUENCE';

      const payload = {
        mode:         mapMode,
        requireGreen: (mapMode !== 'ALL'), // waves ⇒ working only
        edges,
        from:         'mobile'             // pretend to be the mobile UI
      };

      if (typeof window.setWaveFilters === 'function') {
        console.log('[SUNBURST][notifyHostWaveFilter] via setWaveFilters', payload);
        window.setWaveFilters(payload);
        return;
      }

      if (typeof window.setFilters === 'function') {
        console.log('[SUNBURST][notifyHostWaveFilter] via setFilters', payload);
        window.setFilters(payload);
        return;
      }

      const bus = window.BUS || window.bus;
      if (bus?.emit) {
        console.log('[SUNBURST][notifyHostWaveFilter] via BUS only', payload);
        bus.emit('filterChange', payload);
      } else {
        console.warn('[sunburst] no filter hook available');
      }
    } catch (e) {
      console.warn('[sunburst] notifyHostWaveFilter failed', e);
    }
  }

  // Canonical order + labels
  const LEGEND_ORDER = ['WORKING','LIGHT ONSHORES','NOT HAPPENING'];
  const LEGEND_LABEL = {
    WORKING: 'Working',
    'LIGHT ONSHORES': 'Light Onshores',
    'NOT HAPPENING': 'Not Happening'
  };


  // compute the rows the legend should show for the current drill state
  function legendFiltered() {
    let rows = ADAPTED;
    if (SEL_BUCKET)   rows = rows.filter(r => r.bucket  === SEL_BUCKET);
    if (SEL_COUNTRY)  rows = rows.filter(r => r.country === SEL_COUNTRY);
    if (SEL_AREA)     rows = rows.filter(r => r.area    === SEL_AREA);

    const counts = d3.rollups(rows, v => v.length, d => d.bucket);
    const byBucket = new Map(counts);
    return LEGEND_ORDER.map(k => ({
      key: k,
      label: LEGEND_LABEL[k],
      value: byBucket.get(k) || 0,
      color: BUCKET_COLS[k]
    }));
  }

  // tiny, compact legend renderer
  function renderLegendTiny(rows) {
    // Roll up counts by bucket from the provided slice
    const counts = d3.rollup(rows, v => v.length, d => d.bucket);

    const data = LEGEND_ORDER.map(id => ({
      id,
      label: LEGEND_LABEL[id],
      color: BUCKET_COLS[id],
      count: counts.get(id) || 0
    }));

    // Host (bottom-centered, wraps into multiple rows)
    let host = document.getElementById('sunburst-legend');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sunburst-legend';
      Object.assign(host.style, {
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: '6px',
        display: 'flex',
        flexWrap: 'wrap',            // ⇦ allow wrapping to new lines
        justifyContent: 'center',
        gap: '4px 6px',
        alignItems: 'center',
        maxWidth: 'calc(100% - 24px)', // ⇦ keep inside the mount with side gutters
        padding: '0',
        pointerEvents: 'none',         // legend shouldn’t block clicks on the chart
        zIndex: '2'
      });
      mount.appendChild(host);
    }

    const sel = d3.select(host).selectAll('span.chip').data(data, d => d.id);
    sel.exit().remove();

    const enter = sel.enter()
      .append('span')
      .attr('class', 'chip')
      .style('display', 'inline-flex')
      .style('alignItems', 'center')
      .style('gap', '6px')
      .style('border', '1px solid #2a2f36')
      .style('borderRadius', '999px')
      .style('padding', '1px 6px')    // ⇦ smaller pill
      .style('background', 'rgba(16,20,26,.65)')
      .style('font', '600 10px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Arial') // ⇦ smaller font
      .style('whiteSpace', 'nowrap') // keep the words together; rows wrap
      .style('pointerEvents', 'auto'); // only so the `title` tooltip works

    enter.append('span')
      .attr('class', 'sw sw-dot')
      .style('display', 'inline-block')
      .style('width', '10px')
      .style('height', '10px')
      .style('border-radius', '50%')   // ensure circle
      .style('flex', '0 0 auto')
      .style('vertical-align', 'middle')
      .style('transform', 'translateY(-1px)');

    enter.append('span').attr('class', 'lab');

    const merged = enter.merge(sel);

    // Title shows counts; chip text stays compact (no "(0)")
    merged
      .attr('title', d => `${d.label}: ${d.count}`)
      .style('opacity', d => (d.count === 0 ? 0.45 : 0.95));


    merged.select('span.sw-dot').style('background', d => d.color);
    merged.select('span.lab').text(d => d.label);
  }



  // Which rows should the legend summarise for the current VIEW?
  function legendSliceForView(baseRows) {
    const rows = Array.isArray(baseRows) ? baseRows : ADAPTED;
    switch (VIEW) {
      case 'PULSE':
        return rows;
      case 'COUNTRIES':
        return rows.filter(d => d.bucket === SEL_BUCKET);
      case 'AREAS':
        return rows.filter(d => d.bucket === SEL_BUCKET && d.country === SEL_COUNTRY);
      case 'SPOTS':
        return rows.filter(d => d.country === SEL_COUNTRY && d.area === SEL_AREA);
      default:
        return rows;
    }
  }

  // Legend colour scale based on BUCKET_COLS
  const bucketColor = d3.scaleOrdinal()
    .domain(Object.keys(BUCKET_COLS))
    .range(Object.values(BUCKET_COLS));

  // --- Load boundaries for hierarchy mapping (by_country / by_area) ---
  async function loadBoundaries() {
    const res = await fetch('../static/data/boundaries.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load boundaries.json (${res.status})`);
    window.BOUNDARIES = await res.json();
    console.log('[BOUNDARIES] loaded:', window.BOUNDARIES);
  }

  function debugRollups(rows) {
    try {
      const byCountry = d3.rollups(rows, v => v.length, d => d.country)
        .sort((a,b) => d3.descending(a[1], b[1]));
      console.table(byCountry.map(([k,v]) => ({ country:k, count:v })));

      const byArea = d3.rollups(rows, v => v.length, d => d.area)
        .sort((a,b) => d3.descending(a[1], b[1]));
      console.table(byArea.slice(0,25).map(([k,v]) => ({ area:k, count:v })));
    } catch (e) {
      console.warn('[sunburst] debugRollups failed', e);
    }
  }

  // --- First load the JSONs, then render ------------------------------
  // --- First load the JSONs, then render ------------------------------
  async function boot() {
    try {
      // 1) Load boundaries (so countryForArea works with real data)
      await loadBoundaries();
    } catch (e) {
      console.warn('[sunburst] boundaries load failed (continuing with fallback)', e);
      window.BOUNDARIES = window.BOUNDARIES || { by_area:{}, by_country:{} };
    }

    try {


      // === EARLY BOOT FROM INJECTED ROWS (skip local file) ===
      if (Array.isArray(window.LATEST_SPOT_ROWS) && window.LATEST_SPOT_ROWS.length > 0) {
        try {
          ADAPTED = adaptRows(window.LATEST_SPOT_ROWS);
          setCountryScaleDomain(ADAPTED);
          update();
          console.log('[sunburst] booted from injected rows:', ADAPTED.length);
          return; // <- do not fall through to the "LOCAL file rows" path
        } catch (e) {
          console.warn('[sunburst] injected boot failed; falling back to local file', e);
        }
      }


      // ✅ Prefer injected rows from the host (mobile page) if provided
      if (Array.isArray(INJECTED_ROWS) && INJECTED_ROWS.length) {
        console.log('[sunburst] using INJECTED_ROWS from host:', INJECTED_ROWS.length);
        ADAPTED = adaptRows(INJECTED_ROWS);

        // Lock this scope so later renders don't fall back to ALL
        SB_LOCKED_ROWS   = ADAPTED.slice();
        SB_LOCKED_REGION = getRegion();
        console.log('[sunburst] scope locked to injected rows:', {
          region: SB_LOCKED_REGION,
          rows: SB_LOCKED_ROWS.length
        });

        try {
          const bucketMix = d3.rollups(ADAPTED, v => v.length, d => d.bucket)
                              .map(([bucket, count]) => ({ bucket, count }));
          console.log('[sunburst][diag] bucket mix after adaptRows:');
          console.table(bucketMix);
        } catch {}


      } else {
        // Fallback to local file (dev mode)
        const raw = await fetchSpotsJson(DATA_URL);
        console.log('[sunburst] using LOCAL file rows:', raw.length, DATA_URL);
        ADAPTED = adaptRows(raw);
      }

      setCountryScaleDomain(ADAPTED);
      console.log('[sunburst] adapted rows:', ADAPTED.length);

      // 🔎 DEBUG: what countries/areas do we actually see?
      debugRollups(ADAPTED);

      update(); // first render

      // size after initial paint
      if (typeof window.sizeDonut === 'function') requestAnimationFrame(window.sizeDonut);
      if (onReady) requestAnimationFrame(onReady);

    } catch (e) {
      console.error('[sunburst] failed to initialise', e);
    }
  }

  // PULSE: one ring – buckets
  function buildPulse(adapted){
    const order = ['WORKING','LIGHT ONSHORES','NOT HAPPENING'];
    const byB = d3.rollups(adapted, v=>v.length, d=>d.bucket);
    return order
      .map(b => ({ name:b, value:(byB.find(([k])=>k===b)?.[1]||0) }))
      .filter(d => d.value>0);
  }

  // Pick the better of black/white for a given background colour
  function bestTextOn(bg) {
    const c = d3.color(bg);
    if (!c) return '#fff';
    const { r, g, b } = c.rgb();
    const lum = (v)=> {
      v /= 255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    };
    const L = 0.2126*lum(r) + 0.7152*lum(g) + 0.0722*lum(b);
    const contrast = (L1, L2)=> (Math.max(L1,L2)+0.05) / (Math.min(L1,L2)+0.05);
    const cWhite = contrast(L, 1.0);
    const cBlack = contrast(L, 0.0);
    return cWhite >= cBlack ? '#fff' : '#111';
  }

  function buildAreas(adapted, bucket, country){
    const rows = adapted.filter(d => d.bucket===bucket && d.country===country);
    const byA = d3.rollups(rows, v => v.length, d => d.area);
    return byA.map(([area, count]) => ({
      name: area,
      value: count,
      fill: BUCKET_COLS[bucket]
    }));
  }

  // COUNTRIES: bucket → countries
  function buildCountries(adapted, bucket){
    const subset = adapted.filter(d => d.bucket === bucket);
    const byC = d3.rollups(subset, v=>v.length, d=>d.country);
    colorCountryNeutral.domain(byC.map(([c])=>c).sort());
    return byC.map(([name,value]) => ({ name, value }));
  }

  // SPOTS: bucket+country → thin wedges per spot
  function buildSpots(adapted, bucket, country){
    const subset = adapted.filter(d => d.bucket===bucket && d.country===country);
    const orderKey = (d) => ({'WORKING':0,'LIGHT ONSHORES':1,'NOT HAPPENING':2}[d.bucket] ?? 3);
    subset.sort((a,b)=>
      d3.ascending(orderKey(a), orderKey(b)) ||
      d3.ascending(a.area, b.area) ||
      d3.ascending(a.spot, b.spot)
    );
    return subset.map(d => ({ name:d.spot, area:d.area, bucket:d.bucket, value:1 }));
  }

  // RAG → buckets
  // Map the JSON "colour" field exactly to our three buckets
  function bucketForColour(c) {
    const k = String(c || '').trim().toLowerCase();
    if (k === 'green')  return 'WORKING';
    if (k === 'amber' || k === 'orange') return 'LIGHT ONSHORES';
    if (k === 'red')    return 'NOT HAPPENING';
    // anything unknown defaults to not happening
    return 'NOT HAPPENING';
  }

  // STEP-1 hierarchy order (and anything that listed the old name)
  function hierarchyStep1(adapted) {
    const order = ['WORKING', 'LIGHT ONSHORES', 'NOT HAPPENING'];
    const byB = d3.group(adapted, d => d.bucket);

    const children = order.map(b => {
      const rowsB = byB.get(b) || [];
      if (!rowsB.length) return null;

      const byC = d3.group(rowsB, d => d.country);
      const countries = Array.from(byC, ([country, rowsC]) => {
        const byA = d3.group(rowsC, d => d.area);
        const areas = Array.from(byA, ([area, rowsA]) => ({ name: area, value: rowsA.length }));
        return { name: country, children: areas };
      });

      return { name: b, children: countries };
    }).filter(Boolean);

    return { name: 'Total', children };
  }

  // Colours for the 3 buckets
  const colorBucket = d3.scaleOrdinal()
    .domain(['WORKING','LIGHT ONSHORES','NOT HAPPENING'])
    .range(['#16a34a', '#f59e0b', '#ef4444']);

  // --- Load server JSON (exact fields: spot, area, colour, ...) ---
  async function fetchSpotsJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    const text = await res.text();
    const safe = text
      .replace(/\bNaN\b/g, 'null')
      .replace(/\bInfinity\b/g, 'null')
      .replace(/\b-Infinity\b/g, 'null');
    try {
      return JSON.parse(safe);
    } catch (e) {
      console.error('[sunburst] JSON parse failed. First 200 chars:', safe.slice(0,200));
      throw e;
    }
  }

  // Area → Country (prefer BOUNDARIES, else fallback to Area <select> data-country)
  function countryForArea(areaName) {
    const key = String(areaName || '').trim().toLowerCase();
    const byArea = (window.BOUNDARIES && window.BOUNDARIES.by_area) || {};
    for (const k in byArea) {
      const r = byArea[k];
      if (String(r.area || '').trim().toLowerCase() === key) {
        return r.country_name || r.country_code || 'Unknown';
      }
    }
    const areaSel = document.getElementById('area');
    if (areaSel) {
      for (const opt of [...areaSel.options]) {
        if (String(opt.value || '').trim().toLowerCase() === key) {
          return opt.dataset.country || 'Unknown';
        }
      }
    }
    return 'Unknown';
  }

  // Adapt raw rows → {bucket, country, area, spot}
  function adaptRows(rows) {

    // DIAG 1: what "colour" strings are actually present?
    try {
      const colourMix = (rows || []).reduce((m, r) => {
        const val = String(r?.colour ?? '').trim();
        m[val] = (m[val] || 0) + 1;
        return m;
      }, {});
      console.log('[sunburst][diag] raw colour mix from injected JSON:');
      console.table(
        Object.entries(colourMix).map(([colour, count]) => ({ colour, count }))
      );
    } catch {}

    const byArea = (window.BOUNDARIES && window.BOUNDARIES.by_area) || {};

    return (rows || []).map(r => {
      const key  = String(r.area || '').trim().toLowerCase();
      const meta = byArea[key] || {};

      let size_ft = undefined;
      if (typeof r.size_ft === 'number' && isFinite(r.size_ft)) {
        size_ft = r.size_ft;
      }

      return {
        bucket:       bucketForColour(r.colour),
        country:      meta.country_name || 'Unknown',
        country_code: (meta.country_code || '').toUpperCase() || 'XX',
        area:         r.area || 'Unknown',
        spot:         r.spot || '—',
        size_ft      // 👈 keep the canonical wave height
      };
    });
  }

  // Colours: 3 buckets + neutral greys for countries/areas
  const GREYS = ['#9aa4b2','#7f8a99','#6b7686','#586271','#46505d'];
  const colorCountryNeutral = d3.scaleOrdinal().range(GREYS);

  // Node fill for STEP-1 (no feelings)
  function nodeFillStep1(d) {
    if (d.depth === 1) return colorBucket(d.data.name);                // bucket
    if (d.depth === 2) return colorCountryNeutral(d.data.name);        // country
    if (d.depth === 3) {
      const p = d.parent?.data?.name || '';
      const base = d3.color(colorCountryNeutral(p)) || d3.rgb('#7f8a99');
      return d3.hsl(base).darker(0.4).formatHex();                     // area shade
    }
    return '#cfd6df';
  }

  function goUp() {
    if (VIEW === 'SPOTS') {
      VIEW = 'AREAS';
      SEL_AREA = null;                 // keep country, clear area
      syncDropdownsWithState();        // country stays, area → ALL
      notifyHostRegion({ country: SEL_COUNTRY, area: null });
      update();
      return;
    }
    if (VIEW === 'AREAS') {
      VIEW = 'COUNTRIES';
      SEL_COUNTRY = null;              // now clear country too
      SEL_AREA = null;
      syncDropdownsWithState();        // ALL / ALL
      notifyHostRegion({ country: null, area: null });
      update();
      return;
    }
    if (VIEW === 'COUNTRIES') {
      VIEW = 'PULSE';
      SEL_BUCKET = null;
      // optional: keep ALL/ALL explicit
      notifyHostRegion({ country: null, area: null });
      update();
      return;
    }
  }

  /* ========== 3) Edges from Edgy or fallback sliders ====================== */
  function getEdges() {
    const wrap = document.getElementById('fallbackSliders');
    if (wrap) wrap.style.display = 'flex';
    const rFun = document.getElementById('rFun');
    const rSol = document.getElementById('rSolid');
    return {
      funMax: parseFloat(rFun?.value ?? 3),
      solidMax: parseFloat(rSol?.value ?? 6),
    };
  }
  (function initFallback() {
    const wrap = document.getElementById('fallbackSliders');
    const rFun = document.getElementById('rFun');
    const rSol = document.getElementById('rSolid');
    const oFun = document.getElementById('oFun');
    const oSol = document.getElementById('oSolid');
    if (wrap) wrap.style.display = 'flex';
    if (!rFun || !rSol) return;

    const MIN_GAP = 0.5;

    const sync = () => {
      const f = parseFloat(rFun.value);
      let s = parseFloat(rSol.value);
      if (!Number.isFinite(f) || !Number.isFinite(s)) return;
      if (s < f + MIN_GAP) { s = f + MIN_GAP; rSol.value = s.toFixed(1); }
      if (oFun) oFun.textContent = f.toFixed(1);
      if (oSol) oSol.textContent = s.toFixed(1);
      try { if (typeof update === 'function') update(); } catch {}
    };

    rFun.addEventListener('input', sync);
    rSol.addEventListener('input', sync);
    sync();
  })();

  /* ========== 4) Filtering helpers (dropdowns) ============================ */
  function currentRegionFilter(s){
    const c = document.getElementById('country')?.value ?? 'ALL';
    const a = document.getElementById('area')?.value ?? 'ALL';

    if (c !== 'ALL') {
      const want = String(c).trim().toUpperCase();
      const nameMatch = s.country.toUpperCase() === want || (s.country.toUpperCase() === 'UNITED KINGDOM' && want === 'UK');
      const codeMatch = (s.country_code || '').toUpperCase() === want;
      if (!(nameMatch || codeMatch)) return false;
    }
    if (a !== 'ALL' && s.area !== a) return false;
    return true;
  }




  /* ========== 5) Data → hierarchy builders ================================ */
  function hierarchyDefaultView(all, showNH){
    const feelings = showNH ? [...FEELINGS_WORKING, 'NOT HAPPENING'] : FEELINGS_WORKING;
    const byFeeling = d3.rollups(all, v=>v.length, d=>d.feeling);
    const children = feelings.map(f => {
      const n = byFeeling.find(([ff])=>ff===f)?.[1] || 0;
      return n ? { name:f, value:n } : null;
    }).filter(Boolean);
    return { name:'Total', children };
  }

  function hierarchyDrillFeeling(allWorking, feeling, { includeSpots=false } = {}){
    const subset = allWorking.filter(s => s.feeling === feeling);
    const byCountry = d3.group(subset, d=>d.country, d=>d.area);

    const countries = Array.from(byCountry, ([country, byArea]) => {
      const areas = Array.from(byArea, ([area, rows]) => {
        return includeSpots
          ? { name: area, children: rows.map(r => ({ name: r.name, value: 1, __spot: r })) }
          : { name: area, value: rows.length };
      }).sort((a,b)=> d3.descending(d3.sum(a.children??[{value:a.value}], d=>d.value), d3.sum(b.children??[{value:b.value}], d=>d.value)));

      return { name: country, children: areas };
    }).sort((a,b)=> d3.descending(d3.sum(a.children, d => d.children ? d3.sum(d.children, x=>x.value) : d.value),
                                  d3.sum(b.children, d => d.children ? d3.sum(d.children, x=>x.value) : d.value)));

    return { name: feeling, children: countries };
  }

  function setCountryScaleDomain(adapted){
    const uniq = Array.from(new Set(adapted.map(d => d.country))).sort();
    colorCountryNeutral.domain(uniq);
  }


  /* ========== 6) Sunburst render (with donut radius mapping) ============== */

  // Placeholder (Stage 1 doesn’t use these, but later steps will)
  const FEELINGS_WORKING = [];
  let selectedFeeling = null;

  // Radii & arc generators
  const R = 250;
  const R_INNER = 70;
  const R_MID    = 115;
  const R_OUT    = 220;

  const TAU = 2 * Math.PI;
  const EPS = 1e-6;
  const MIN = 1e-3;

  const arcInner = d3.arc()
    .innerRadius(R_INNER)
    .outerRadius(R_MID)
    .cornerRadius(0)
    .padAngle(0)
    .startAngle(d => d.a0)
    .endAngle(d => d.a1);

  const arcOuter = d3.arc()
    .innerRadius(R_MID + 6)
    .outerRadius(R_OUT)
    .cornerRadius(0)
    .padAngle(0.002)
    .startAngle(d => d.a0)
    .endAngle(d => d.a1);

  // ---- Label helpers (used in render2Ring) ----
  const LABELS = {
    // outside label offset (px) and extra leader length (px)
    outsideOffset: 16,
    leaderExtra: 12,
    // threshold (radians) for deciding when SPOTS labels go outside
    spotSpanOutside: 0.06
  };

  function pieLayout(values){
    const total = d3.sum(values, d => d.value);
    if (!total) return [];
    let acc = 0;
    return values.map(d => {
      const a0 = (acc/total) * TAU;
      acc += d.value;
      let a1 = (acc/total) * TAU;
      let span = a1 - a0;
      if (span < MIN) a1 = a0 + MIN;
      if (span >= TAU - EPS) a1 = a0 + (TAU - EPS);
      return { ...d, a0: +a0.toFixed(6), a1: +a1.toFixed(6) };
    });
  }

  const safeArc = gen => d => {
    try {
      const s = gen(d);
      if (!s) return null;
      const large = (d.a1 - d.a0) > Math.PI ? 1 : 0;
      return s.replace(
        /A([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),/g,
        (m, rx, ry, rot, largeStr, sweepStr) =>
          `A${rx},${ry},${rot},${large},${(+sweepStr > 0.5 ? 1 : 0)},`
      );
    } catch {
      return null;
    }
  };

  // center widgets
  // center widgets (live in their own layer so we can raise above arcs)
  const centerDisc  = gCenter.append('circle')
    .attr('r', R_INNER)
    .attr('fill', CENTER_GREY)       // use the grey by default
    .attr('stroke', 'none')
    .attr('filter', 'url(#centerGlow)') // add the glow
    .style('cursor','pointer')
    .on('click', goUp);


  const centerBig = gCenter.append('text')
    .attr('y', -4)
    .attr('class','centerLabel')
    .style('font', '800 36px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Arial')
    .style('text-anchor','middle')
    .style('fill', '#fff')
    .style('pointer-events','none');   // text doesn’t block clicks

  const centerSmall = gCenter.append('text')
    .attr('y', 22)
    .attr('class', 'centerLabel')
    .style('font','700 12px/1 system-ui,-apple-system,Segoe UI,Roboto,Arial')
    .style('opacity', .9)
    .style('text-anchor','middle')
    .style('fill', '#fff')
    .style('pointer-events','none');

  const centerHit = gCenter.append('rect')
    .attr('x', -R_INNER).attr('y', -R_INNER)
    .attr('width', R_INNER*2).attr('height', R_INNER*2)
    .style('fill', 'transparent')
    .style('cursor','pointer')
    .on('click', goUp);

  let ADAPTED = []; // holds adapted rows from server

  // === Helper: slice rows to match the current Country/Area dropdowns ===
  // === Helper: slice rows to match the current Country/Area dropdowns ===
  // Now that the host shell pre-filters rows by window.REGION (via
  // canonicalFilterRowsByRegionImpl), the injected ADAPTED set is already
  // scoped to the current region. We only need to honour any locked subset;
  // no extra country/area filter here.
  function rowsForCurrentDropdowns(all) {
    return Array.isArray(all) ? all : ADAPTED;
  }


  // --- dropdown sync helpers -----------------------------------------------

  // Set a <select> and fire its normal change handler (so map/title update)
  // Replace your existing setSelect with this version
  function setSelect(id, value) {
    const el = document.getElementById(id);
    if (!el) return false; // report "not found"

    if (el.value === value) {
      // still fire change so any listeners react
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Mirror current sunburst drill state into the dropdowns
  // Replace your existing syncDropdownsWithState with this version
  function syncDropdownsWithState() {
    const country = SEL_COUNTRY || 'ALL';
    const area    = SEL_AREA    || 'ALL';

    const touchedCountry = setSelect('country', country);
    const touchedArea    = setSelect('area', area);

    // always keep local region in sync
    opts.region = { ...(opts.region || {}), country, area };

    // if selects aren’t present in this DOM (iframe case), tell the host
    if (!touchedCountry && !touchedArea) {
      notifyHostRegion({ country, area });
    }
  }




  window.ADAPTED = ADAPTED;


  // Simple runtime API so the host page can hot-swap data without reloading
  window.SunburstAPI = {
    setData(rows) {
      try {
        ADAPTED = adaptRows(Array.isArray(rows) ? rows : []);
        setCountryScaleDomain(ADAPTED);
        update();
        console.log('[sunburst] data replaced at runtime:', ADAPTED.length);
      } catch (e) {
        console.error('[sunburst] setData failed', e);
      }
    },

    setRegion(region, options) {
      try {
        const silent = !!(options && options.silent);

        const nextCountry = region?.country ?? 'ALL';
        const nextArea    = region?.area ?? 'ALL';

        // Normalise nulls to 'ALL'
        const normalised = {
          country: nextCountry === null ? 'ALL' : nextCountry,
          area:    nextArea    === null ? 'ALL' : nextArea
        };

        // Always mirror into the host-facing region (what getRegion reads)
        opts.region = {
          ...(opts.region || {}),
          ...normalised
        };

        if (!silent) {
          // Only non-silent calls are allowed to reset drill state
          VIEW = 'PULSE';
          SEL_BUCKET = null;
          SEL_COUNTRY = normalised.country === 'ALL' ? null : normalised.country;
          SEL_AREA    = normalised.area    === 'ALL' ? null : normalised.area;
          LAST_AREA_NEUTRAL = null;

          try {
            syncDropdownsWithState();
          } catch (e) {
            console.warn('[sunburst] syncDropdownsWithState failed', e);
          }

          update();
        }

        console.log('[sunburst] region set via API', {
          region: opts.region,
          silent
        });
      } catch (e) {
        console.error('[sunburst] setRegion failed', e);
      }
    },




    // NEW: when host/map returns to ALL/ALL (or otherwise wants global scope),
    // call this to drop any previously injected subset.
    clearInjectedScope() {
      try {
        if (window.SB_LOCKED_ROWS) {
          window.SB_LOCKED_ROWS   = null;
          window.SB_LOCKED_REGION = { country: 'ALL', area: 'ALL' };
          update();
          console.log('[sunburst] cleared injected scope');
        }
      } catch (e) {
        console.error('[sunburst] clearInjectedScope failed', e);
      }
    }
  };



  // Wrap a string into up to two lines inside the inner disc
  function setCenterTitle(title, { maxWidthPct = 0.82, px = 18 } = {}) {
    // prepare the node
    centerBig.selectAll('tspan').remove();
    centerBig.text(null)
            .style('font', `800 ${px}px/1.15 system-ui,-apple-system,Segoe UI,Roboto,Arial`);

    const maxW = maxWidthPct * (2 * R_INNER); // usable width across the inner circle
    const words = String(title || '').trim().split(/\s+/);
    if (!words.length) return;

    // build first line
    let line1 = '', t1 = centerBig.append('tspan').attr('x', 0).attr('dy', '-0.2em');
    for (let i = 0; i < words.length; i++) {
      const test = line1 ? line1 + ' ' + words[i] : words[i];
      t1.text(test);
      if (t1.node().getComputedTextLength() > maxW) {
        // revert the last word to second line
        const last = words[i];
        t1.text(line1);
        // if even one word is too long, hard truncate it
        if (!line1) {
          let w = last;
          while (w.length && t1.node().getComputedTextLength() > maxW) {
            w = w.slice(0, -1);
            t1.text(w + '…');
          }
          return; // only one truncated line
        }
        // second line (with possible truncation + ellipsis)
        const rest = [last, ...words.slice(i + 1)].join(' ');
        let line2 = centerBig.append('tspan').attr('x', 0).attr('dy', '1.2em');
        line2.text(rest);
        while (line2.node().getComputedTextLength() > maxW && line2.text().length) {
          line2.text(line2.text().slice(0, -1) + '…');
          if (line2.text().endsWith('……')) break;
        }
        return;
      }
      line1 = test;
    }
    // it all fit on one line
    t1.text(line1);
  }

  function subtitleForTopLevel() {
    // Prefer the shell’s unified label helper if available
    let code = 'ALL';
    let displayCountry = 'ALL';
    let area = 'ALL';

    if (typeof window.getRegionDisplayLabels === 'function') {
      const r = window.getRegionDisplayLabels();
      code           = (r.code || r.country || 'ALL') + '';
      displayCountry = r.displayCountry || r.country || 'ALL';
      area           = r.area || 'ALL';
    } else {
      // Fallback to the old behaviour
      const reg = (typeof getRegion === 'function') ? getRegion() : (window.REGION || {});
      code = String(reg.country || 'ALL').toUpperCase();
      area = reg.area || 'ALL';

      const bc = (typeof BOUNDARIES !== 'undefined' && BOUNDARIES.by_country)
        ? BOUNDARIES.by_country
        : {};
      const humanCountry =
        (code === 'ALL')
          ? 'NE Atlantic'
          : (Object.values(bc).find(r =>
                String(r.country_code).toUpperCase() === code
            )?.country_name || code);

      displayCountry = humanCountry;
    }

    if (code === 'ALL' && area === 'ALL') {
      return 'Spots Working';
    }
    if (area && area !== 'ALL') {
      return `Spots Working • ${area}`;
    }
    return `Spots Working • ${displayCountry}`;
  }


  function tallyBuckets(rows) {
    const out = { 'WORKING': 0, 'LIGHT ONSHORES': 0, 'NOT HAPPENING': 0 };
    for (const r of rows || []) {
      const b = r.bucket || r.Bucket || r.colour || r.color;
      if (!b) continue;
      if (out.hasOwnProperty(b)) out[b] += 1;
    }
    return out;
  }

  // ---- LOCK CHECK HELPER ----
  // Returns true if a locked subset should be used for the given region
  function shouldUseLockedRows(country, area) {
    const L = window.SB_LOCKED_REGION;
    const hasLock = Array.isArray(window.SB_LOCKED_ROWS) && window.SB_LOCKED_ROWS.length > 0;
    if (!hasLock || !L) return false;

    // Must match country; area matches if lock is ALL or exact match
    if (L.country !== country) return false;
    if (L.area === 'ALL') return true;
    return L.area === area;
  }


  // If the host changes region and the current drill state (SEL_COUNTRY/SEL_AREA)
  // no longer exists in the incoming rows, reset the drill so we don't get
  // "Cornwall" stuck when we're actually looking at "Wales / Gower".
  function normaliseDrillState(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const countries = new Set();
    const areasByCountry = Object.create(null);

    for (const r of rows) {
      const c = r.country || 'ALL';
      const a = r.area || 'ALL';
      countries.add(c);
      if (!areasByCountry[c]) areasByCountry[c] = new Set();
      areasByCountry[c].add(a);
    }

    let changed = false;

    // If our drilled country no longer exists in the new data → reset to PULSE
    if (SEL_COUNTRY && !countries.has(SEL_COUNTRY)) {
      SEL_COUNTRY = null;
      SEL_AREA = null;
      VIEW = 'PULSE';
      changed = true;
    } else if (SEL_AREA && SEL_COUNTRY) {
      const areaSet = areasByCountry[SEL_COUNTRY];
      if (!areaSet || !areaSet.has(SEL_AREA)) {
        // Country is still valid, but the area isn't.
        // Drop back one level: from SPOTS → AREAS.
        SEL_AREA = null;
        if (VIEW === 'SPOTS') VIEW = 'AREAS';
        changed = true;
      }
    }

    if (changed) {
      console.log('[sunburst] normaliseDrillState reset', {
        VIEW,
        SEL_COUNTRY,
        SEL_AREA
      });
    }
  }



  function render2Ring(){

    // --- transition handle (must exist before any .transition(t) usage) ---
    const t = (typeof d3 !== 'undefined' && d3.transition)
      ? d3.transition().duration(450)   // use your existing duration if you have a constant
      : null;

    let waveSummary = null;   

    const withTrans = sel => t ? sel.transition(t) : sel;
    // Prefer the last injected/locked slice if present; otherwise use full ADAPTED
    const { country: cc, area: aa } = getRegion();
    const baseRows = (SB_LOCKED_ROWS && shouldUseLockedRows(cc, aa))
      ? SB_LOCKED_ROWS
      : ADAPTED;

    // STRICT: never fall back to baseRows if filtering returns 0
    const filtered = rowsForCurrentDropdowns(baseRows);
    const SRC = filtered;
    normaliseDrillState(SRC);

    console.log('[sunburst][render2Ring] using rows:', SRC.length);
    // NEW: compute fresh mix from the rows we’re actually rendering
    const MIX = tallyBuckets(SRC);

    // Handy debug so we can verify we never see stale “23” again
    console.log('[sunburst][MIX] from SRC', MIX);

   
    // --- DEBUG (safe, after SRC exists) ---
    try {
      // Exactly what we’re about to render:
      const rows = SRC;
      const mixObj   = tallyBuckets(rows);
      const mixPairs = Object.entries(mixObj).sort((a,b) => b[1] - a[1]);

      // What the selects currently say (sanity check):
      const c = document.getElementById('country')?.value || 'ALL';
      const a = document.getElementById('area')?.value    || 'ALL';

      // Lock diagnostics:
      const locked       = Array.isArray(window.SB_LOCKED_ROWS) && window.SB_LOCKED_ROWS.length > 0;
      const lockedRegion = window.SB_LOCKED_REGION || { country: 'ALL', area: 'ALL' };

      console.log('[sunburst][render2Ring] filters:', {
        country: c,
        area: a,
        rows: rows.length,
        mix: mixPairs,
        locked,
        lockedRegion
      });
    } catch (e) {
      console.warn('[sunburst] render2Ring debug failed', e);
    }

    // --- WAVE SUMMARY for this SRC (global FUN / SOLID / BIG) ---
    waveSummary = null;
    try {
      const edges = window.SB_WAVE_EDGES || {
        flat:        [0, 1],
        fun:         [1, 8],
        solid:       [8, 14],
        consequence: [14, Infinity]
      };

      const waveTally = { FUN: 0, SOLID: 0, BIG: 0 };

      SRC.forEach((r) => {
        // Only green/WORKING are eligible for FUN/SOLID/BIG
        if (r.bucket !== 'WORKING') return;

        const h = (typeof r.size_ft === 'number' && isFinite(r.size_ft))
          ? r.size_ft
          : null;
        if (h == null) return;

        if (h >= edges.fun[0] && h < edges.fun[1]) {
          waveTally.FUN += 1;
        } else if (h >= edges.solid[0] && h < edges.solid[1]) {
          waveTally.SOLID += 1;
        } else if (h >= edges.consequence[0]) {
          waveTally.BIG += 1;
        }
      });

      waveSummary = { edges, waveTally };
      console.log('[sunburst][WAVE-SUMMARY]', {
        region: getRegion(),
        edges,
        waveTally
      });
    } catch (e) {
      console.warn('[sunburst] WAVE-SUMMARY failed', e);
    }


    const regionNow = getRegion();
    console.log(
      '[sunburst][render2Ring] using rows:',
      SRC.length,
      'locked=', !!(SB_LOCKED_ROWS && SB_LOCKED_ROWS.length),
      'country=', regionNow.country,
      'area=', regionNow.area
    );

    // Optional: visibility into empty-region behaviour
    if (SRC.length === 0) {
      console.log('[sunburst] empty region dataset → show 0 totals (no fallback)');
    }

    // Keep legend synced to the current view/selection
    renderLegendTiny(legendSliceForView(SRC));


// --- inner ring data ---
let innerData = [];
switch (VIEW) {
  case 'PULSE': {
    innerData = buildPulse(SRC).map(d => {
      const base = {
        ...d,
        fill: BUCKET_COLS[d.name],
      };

      // Special case: clicking the green WORKING bucket
      if (d.name === 'WORKING') {
        return {
          ...base,
          click: () => {
            // normal drill behaviour
            SEL_BUCKET = 'WORKING';
            VIEW       = 'COUNTRIES';

            // NEW: keep wave chip + map in sync:
            // “all working spots” = ALL + working-only
            try {
              if (typeof notifyHostWaveFilter === 'function') {
                // We pass 'ALL' as the requested mode;
                // setWaveFilters on the host side interprets this
                // as ALL + requireGreen=true for the map.
                notifyHostWaveFilter('ALL');
              }
            } catch (e) {
              console.warn('[sunburst] WORKING click wave sync failed', e);
            }

            update();
          }
        };
      }

      // Default behaviour for other buckets (LIGHT ONSHORES, NOT HAPPENING)
      return {
        ...base,
        click: () => {
          SEL_BUCKET = d.name;
          VIEW       = 'COUNTRIES';
          update();
        }
      };
    });

    const working = innerData.find(d => d.name === 'WORKING')?.value || 0;

    centerDisc
      .attr('fill', 'transparent')
      .attr('stroke', 'rgba(0,0,0,.35)')
      .attr('stroke-width', 1.5);
    centerBig.text(working);
    centerSmall.text(subtitleForTopLevel());
    break;
  }

  case 'COUNTRIES': {
    innerData = [{ name: SEL_BUCKET, value: 1, fill: BUCKET_COLS[SEL_BUCKET], click: null }];
    centerDisc.attr('fill', BUCKET_COLS[SEL_BUCKET]);
    setCenterTitle(SEL_BUCKET, { px: 16 });
    centerSmall.text(' ');
    break;
  }

  case 'AREAS': {
    innerData = [{ name: SEL_COUNTRY, value: 1, fill: BUCKET_COLS[SEL_BUCKET], click: null }];
    centerDisc.attr('fill', BUCKET_COLS[SEL_BUCKET]);
    setCenterTitle(SEL_COUNTRY, { px: 16 });
    centerSmall.text(' ');
    break;
  }

  case 'SPOTS': {
    innerData = [{ name: SEL_AREA, value: 1, fill: CENTER_GREY, click: null }];
    centerDisc.attr('fill', LAST_AREA_NEUTRAL || CENTER_GREY);
    setCenterTitle(SEL_AREA, { px: 16 });
    centerSmall.text(' ');
    break;
  }
}

const innerArcs = pieLayout(innerData);
const oneSlice = innerArcs.length === 1;


// --- outer ring data ---
let outerRows = [];

switch (VIEW) {
  case 'PULSE': {
    const waveMix = (waveSummary && waveSummary.waveTally) || { FUN: 0, SOLID: 0, BIG: 0 };

    const totalWave =
      (waveMix.FUN   || 0) +
      (waveMix.SOLID || 0) +
      (waveMix.BIG   || 0);

    if (totalWave > 0) {
      const WAVE_COLS = {
        FUN:   '#00bcd4',  // cyan
        SOLID: '#002f6c',  // navy
        BIG:   '#4b0082',  // imperial purple
      };

      outerRows = [
        {
          name:  'FUN',
          value: waveMix.FUN,
          fill:  WAVE_COLS.FUN,
          label: 'Fun',
          role:  'wave',
          click: () => notifyHostWaveFilter('FUN'),
        },
        {
          name:  'SOLID',
          value: waveMix.SOLID,
          fill:  WAVE_COLS.SOLID,
          label: 'Solid',
          role:  'wave',
          click: () => notifyHostWaveFilter('SOLID'),
        },
        {
          name:  'BIG',
          value: waveMix.BIG,
          fill:  WAVE_COLS.BIG,
          label: 'Big',
          role:  'wave',
          click: () => notifyHostWaveFilter('BIG'),
        },
      ].filter(d => d.value > 0);
    } else {
      outerRows = [];
    }
    break;
  }

  case 'COUNTRIES': {
    outerRows = buildCountries(SRC, SEL_BUCKET).map(d => ({
      ...d,
      fill:  colorCountryNeutral(d.name),
      label: `${d.name} · ${d.value}`,
      click: () => {
        SEL_COUNTRY = d.name;
        SEL_AREA    = null;
        VIEW        = 'AREAS';
        syncDropdownsWithState();
        notifyHostRegion({ country: SEL_COUNTRY, area: null });
        update();
      }
    }));
    break;
  }

  case 'AREAS': {
    outerRows = buildAreas(SRC, SEL_BUCKET, SEL_COUNTRY).map(d => {
      const neutral = colorCountryNeutral(d.name);
      return {
        ...d,
        fill:  neutral,
        label: `${d.name} · ${d.value}`,
        click: () => {
          LAST_AREA_NEUTRAL = neutral;
          SEL_AREA = d.name;
          VIEW     = 'SPOTS';
          syncDropdownsWithState();
          notifyHostRegion({ country: SEL_COUNTRY, area: SEL_AREA });
          update();
        }
      };
    });
    break;
  }

  case 'SPOTS': {
    const spots = SRC.filter(
      r => r.country === SEL_COUNTRY && r.area === SEL_AREA
    );

    // DEBUG: stash and log a sample of the raw rows the sunburst sees
    if (typeof window !== 'undefined') {
      window.SB_LAST_SPOTS = spots;
    }
    try {
      console.log(
        '[sunburst][SPOTS sample]',
        spots.slice(0, 5).map(r => ({
          spot:    r.spot,
          bucket:  r.bucket,
          size_ft: r.size_ft,
          size:    r.size,
          band:    r.band,
        }))
      );
    } catch (_) {}

    // DEBUG: exact bucket distribution for this area
    try {
      const areaMix = d3
        .rollups(spots, (v) => v.length, (d) => d.bucket)
        .sort((x, y) => d3.descending(x[1], y[1]));
      console.log(
        '[sunburst][SPOTS] area mix:',
        { country: SEL_COUNTRY, area: SEL_AREA },
        areaMix
      );
    } catch (e) {
      console.warn('[sunburst] SPOTS mix debug failed', e);
    }

    // DEBUG: tally via our defensive helper (should match areaMix)
    try {
      const mixObj = tallyBuckets(spots);
      console.log(
        '[sunburst][SPOTS] area tally:',
        { country: SEL_COUNTRY, area: SEL_AREA },
        mixObj
      );
    } catch (e) {
      console.warn('[sunburst] SPOTS tally debug failed', e);
    }

    // --- WAVE MIX DIAGNOSTIC (FUN / SOLID / BIG from slider edges) ---
    try {
      const edges = window.SB_WAVE_EDGES || {
        flat:        [0, 2],
        fun:         [2, 4],
        solid:       [4, 8],
        consequence: [8, Infinity],
      };

      const waveTally = { FUN: 0, SOLID: 0, BIG: 0 };

      spots.forEach((r) => {
        // Only treat GREEN (WORKING) as eligible for FUN / SOLID / BIG
        if (r.bucket !== 'WORKING') return;

        const h =
          (typeof r.size_ft === 'number' && isFinite(r.size_ft))
            ? r.size_ft
            : null;
        if (h == null) return;

        if (h >= edges.fun[0] && h < edges.fun[1]) {
          waveTally.FUN += 1;
        } else if (h >= edges.solid[0] && h < edges.solid[1]) {
          waveTally.SOLID += 1;
        } else if (h >= edges.consequence[0]) {
          waveTally.BIG += 1;
        }
      });



      console.log('[sunburst][WAVE-MIX]', {
        region: { country: SEL_COUNTRY, area: SEL_AREA },
        edges,
        waveTally,
      });
    } catch (e) {
      console.warn('[sunburst] wave-mix diag failed', e);
    }

    outerRows = spots.map((r) => ({
      name:  r.spot,
      value: 1,
      area:  r.area,
      fill:  BUCKET_COLS[r.bucket],
      label: r.spot,
    }));
    break;
  }
}

const outerArcs = pieLayout(outerRows);

// Clip wave ring into WORKING arc in PULSE view
// and ensure each present band has a minimum visible span.
if (VIEW === 'PULSE' && outerArcs.length) {
  const workingArc = innerArcs.find(a => a.name === 'WORKING');
  if (workingArc) {
    const waveArcs = outerArcs.filter(a => a.role === 'wave');
    if (waveArcs.length) {
      const fullSpan    = 2 * Math.PI;
      const targetStart = workingArc.a0;
      const targetSpan  = workingArc.a1 - workingArc.a0;
      if (targetSpan > 0) {
        // First map all arcs into the WORKING span, preserving proportions
        waveArcs.forEach(a => {
          const f0 = a.a0 / fullSpan;
          const f1 = a.a1 / fullSpan;
          a.a0 = targetStart + f0 * targetSpan;
          a.a1 = targetStart + f1 * targetSpan;
        });

        // Then enforce a minimum size so tiny bands are still visible
        const MIN_WAVE_SPAN = Math.min(targetSpan / 4, 0.25); // rad ~ max 14°

        let cursor = targetStart;
        waveArcs.forEach((a, idx) => {
          const remaining = workingArc.a1 - cursor;
          const origSpan  = Math.max(a.a1 - a.a0, 0);
          let span        = Math.max(origSpan, MIN_WAVE_SPAN);

          const isLast = (idx === waveArcs.length - 1);
          if (isLast || span > remaining) {
            span = Math.max(remaining, 0);
          }

          a.a0 = cursor;
          a.a1 = cursor + span;
          cursor += span;
        });
      }
    }
  }
}

    if (VIEW === 'SPOTS') {
      const n = outerArcs.length;
      const px =
        n > 28 ? 11 :
        n > 22 ? 13 :
        n > 16 ? 14 : 16;
      gLabels.selectAll('text.outerLab')
        .style('font-weight', 800)
        .style('font-size', `${px}px`)
        .style('letter-spacing', n > 22 ? '-0.3px' : '0');
    }

    // same full donut height for inner & outer
    const setInnerStroke = oneSlice ? 'none' : '#0d0f12';

    let inner = gArcs.selectAll('path.inner').data(innerArcs, d => d.name);
    inner.exit().interrupt().transition(t).attr('opacity',0).remove();
    inner.enter().append('path')
      .attr('class','inner')
      .attr('opacity',0)
      .attr('stroke', setInnerStroke)
      .attr('fill', d => d.fill || '#444')
      .attr('d', safeArc(arcInner))
      .on('click', (_, d) => d.click && d.click())
      .merge(inner)
      .attr('stroke', setInnerStroke)
      .attr('d', safeArc(arcInner))
      .transition(t)
      .attr('opacity',1);

    let outer = gArcs.selectAll('path.outer').data(outerArcs, (d,i) => d.name + '_' + i);
    outer.exit().interrupt().transition(t).attr('opacity', 0).remove();
    outer.enter().append('path')
      .attr('class', 'outer clickable')
      .attr('opacity', 0)
      .attr('fill', d => d.fill || '#6b7686')
      .attr('stroke', '#0d0f12')
      .attr('stroke-width', 1)
      .attr('d', safeArc(arcOuter))
      .on('click', (_, d) => d.click && d.click())
      .merge(outer)
      .attr('d', safeArc(arcOuter))
      .transition(t)
      .attr('opacity', outerArcs.length ? 1 : 0);

  // --- labels in outer ring (robust wrapper <g>) ---
  const singleSlice = outerArcs.length === 1;

  // 1) JOIN: one <g> per label
  const labelGroups = gLabels.selectAll('g.outerLabel')
    .data(outerArcs, (d,i) => d.name + '_' + i);

  labelGroups.exit().remove();

  const labelEnter = labelGroups.enter()
    .append('g')
    .attr('class', 'outerLabel')
    .style('pointer-events', 'none');

  const labelMerged = labelEnter.merge(labelGroups);

  // 2) One <text> per group
  const textSel = labelMerged.selectAll('text').data(d => [d]);
  textSel.exit().remove();
  const textEnter = textSel.enter().append('text')
    .attr('class', 'outerLab')
    .style('fill', '#fff')
    .style('paint-order', 'stroke')
    .style('stroke', 'rgba(10,10,10,.95)')
    .style('stroke-width', '1px')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle');

  const text = textEnter.merge(textSel);

  // 3) Visibility gate + text content
  const showText = d => {
    if (singleSlice) return d.label || d.name;
    const span = d.a1 - d.a0;
    if (VIEW === 'SPOTS') return span > 0.01 ? (d.label || d.name) : ''; // looser gate; we’ll push outside
    return span > 0.02 ? (d.label || d.name) : '';
  };
  text.text(showText)
      .attr('opacity', d => showText(d) ? 0.95 : 0);

  // 4) Decide inside/outside + positions
  labelMerged.each(function(d){
    const aMid = (d.a0 + d.a1) / 2;          // radians (0 at 3 o’clock)
    const deg = (aMid * 180 / Math.PI) - 90; // rotate so 0° is 12 o’clock
    const span = d.a1 - d.a0;

    const insideR = (VIEW === 'SPOTS') ? (R_OUT - 20) : ((R_MID + R_OUT) / 2);
    const goOutside = (VIEW === 'SPOTS') && (span < LABELS.spotSpanOutside);

    // Group position: on arc (inside) or just outside with offset
    const r = goOutside ? (R_OUT + LABELS.outsideOffset) : insideR;
    d3.select(this).attr('transform', `rotate(${deg}) translate(${r},0)`);

    // Flip text upright
    const isLeft = Math.cos(aMid - Math.PI/2) < 0;
    d3.select(this).select('text').attr('transform', isLeft ? 'rotate(180)' : null);
  });

  // 5) Leaders for outside labels only
  const outsideData = (VIEW === 'SPOTS') ? outerArcs.filter(d => (d.a1 - d.a0) < LABELS.spotSpanOutside) : [];
  const leaders = gLabels.selectAll('path.leader').data(outsideData, d => d.name);
  leaders.exit().remove();
  leaders.enter().append('path')
    .attr('class','leader')
    .attr('stroke','#2a2f36')
    .attr('fill','none')
    .merge(leaders)
    .attr('d', d => {
      const a = (d.a0 + d.a1) / 2;
      const r0 = R_OUT - 6;
      const r1 = R_OUT + LABELS.outsideOffset - 4; // small stem
      const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0;
      const x1 = Math.cos(a) * (r1 + LABELS.leaderExtra), y1 = Math.sin(a) * (r1 + LABELS.leaderExtra);
      return `M${x0},${y0}L${x1},${y1}`;
    });

  // 6) Typography: scale by view and crowding
  const isMobile = window.innerWidth < 600;
  const n = outerArcs.length;
  const spotPx =
    n > 28 ? 11 :
    n > 22 ? 13 :
    n > 16 ? 14 : 16;
  const areaPx = isMobile ? 21 : 13;
  const countryPx = isMobile ? 21 : 14;

  gLabels.selectAll('text.outerLab')
    .style(
      'font',
      VIEW === 'SPOTS'
        ? `800 ${spotPx}px/1.05 system-ui,-apple-system,Segoe UI,Roboto,Arial`
        : VIEW === 'AREAS'
          ? `700 ${areaPx}px/1.05 system-ui,-apple-system,Segoe UI,Roboto,Arial`
          : `800 ${countryPx}px/1.05 system-ui,-apple-system,Segoe UI,Roboto,Arial`
    )
    .style('stroke-width', '1px');

  // 7) Keep center group above everything
  // 7) Keep center and labels above everything
  gCenter.raise();

  // Always raise the label layer last — after any transitions or joins
  queueMicrotask(() => {
    try {
      if (typeof gLabels?.raise === 'function') gLabels.raise();
      else {
        const svgNode = document.querySelector('#sunburst-mount svg.sunburst');
        const node = svgNode && (
          svgNode.querySelector('.layer.labels') ||
          svgNode.querySelector('.outerLabel')
        );
        if (node && node.parentNode) node.parentNode.appendChild(node);
      }
    } catch (e) {
      console.warn('[sunburst] label raise failed', e);
    }
  });

  // --- after layout is done, size the donut ---
  if (typeof window.sizeDonut === 'function') {
    requestAnimationFrame(window.sizeDonut);
  }
  if (onReady) {
    requestAnimationFrame(onReady);
  }
}

  // (Legacy sunburst partition renderer remains unused in Stage 1)
  // function render(){ ... } // kept in prototype but not called

  /* ========== 7) UI wiring ================================================ */
  document.getElementById('country')?.addEventListener('change', () => {
    const c = document.getElementById('country').value;
    const areaSel = document.getElementById('area');
    if (areaSel) {
      for (const opt of [...areaSel.options]) {
        if (opt.value === 'ALL') continue;
        opt.hidden = (c!=='ALL' && opt.dataset.country !== c);
      }
      if (c!=='ALL' && areaSel.selectedOptions[0]?.dataset.country !== c) {
        areaSel.value = 'ALL';
      }
    }
    update();
  });
  document.getElementById('area')?.addEventListener('change', update);

  if (window.WaveSelector?.init) {
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedFeeling) goUp();
  });

  function update(){ render2Ring(); }
  // 👇 expose a safe hook the host page can call
  try { window.__SB_UPDATE = update; } catch {}

  // Listen for wave slider changes from the host (Edgy)
  try {
    if (window.bus && typeof window.bus.on === 'function') {
      window.bus.on('filterScaleChange', (payload = {}) => {
        console.log('[sunburst] heard filterScaleChange', payload);
        try {
          update();   // re-run render2Ring with the new SB_WAVE_EDGES
        } catch (e) {
          console.warn('[sunburst] update on filterScaleChange failed', e);
        }
      });
    }
  } catch (e) {
    console.warn('[sunburst] bus wiring for filterScaleChange failed', e);
  }






  // IMPORTANT: no DOMContentLoaded hook anymore — just boot now.
  boot();
};