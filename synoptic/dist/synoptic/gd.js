/* synoptic/gd.js — harness-proven gale parser + dial renderer */
/* global window */
(() => {
  // ===== Helpers =====
  const DIR_WORDS = [
    ['northwesterly','nw'], ['westerly','w'], ['southwesterly','sw'],
    ['southerly','s'], ['southeasterly','se'], ['easterly','e'],
    ['northeasterly','ne'], ['northerly','n'],
    ['nw','nw'],['w','w'],['sw','sw'],['s','s'],['se','se'],['e','e'],['ne','ne'],['n','n']
  ];
  const ANGLE = { n:0, ne:45, e:90, se:135, s:180, sw:225, w:270, nw:315 };
  const NO_GALES_RE = /^(\s*(no|nil)\s+gales?\b|no\s+gale\s+warnings?)/i;

  function dirCode(word){
    if (!word) return null;
    const w = word.toLowerCase().replace(/[^a-z\-]/g,'');
    for (const [pat, code] of DIR_WORDS) if (w === pat) return code;
    return null;
  }
  function dirAngle(code){ return ANGLE[code||'n'] ?? 0; }

  function forceCaption(force){
    if (!Number.isFinite(force)) return 'gale force';
    if (force >= 12) return 'hurricane force';
    if (force >= 10) return 'storm force';
    if (force >= 9)  return 'severe gale';
    return 'gale force';
  }
  function stripHeader(s){
    return String(s||'').replace(/^\s*Gale\s+warning\s*[\r\n]+Issued:[^\n]*\n/i,'').trim();
  }
  function timeRank(w){
    if (!w) return 0; // treat missing as "now"
    const x = w.toLowerCase();
    if (x === 'now') return 0;
    if (x === 'at first' || x === 'imminent') return 1;
    if (x === 'soon') return 2;
    if (x === 'later') return 3;
    return 99;
  }
  const DIR_RE = '(?:northwesterly|westerly|southwesterly|southerly|southeasterly|easterly|northeasterly|northerly|nw|w|sw|s|se|e|ne|n)';

  function findTurnedNowDir(body){
    const s = String(body || '').toLowerCase();
    // "now backed|veered northerly"
    let m = s.match(new RegExp(`\\bnow\\s+(?:backed|veered)\\s+(${DIR_RE})\\b`));
    if (m) return dirCode(m[1]);
    // "backed|veered northerly now"
    m = s.match(new RegExp(`\\b(?:backed|veered)\\s+(${DIR_RE})\\s+now\\b`));
    if (m) return dirCode(m[1]);
    return null;
  }


  // ===== Clause normaliser (yields micro-events) =====
  function normalizeClause(clause){
    const t = String(clause || '').toLowerCase();
    const out = [];

    const idxTurn  = t.search(/\b(veering|backing|veered|backed)\b/);
    const idxTrend = t.search(/\b(increasing|decreasing)\b/);

    const mWhen   = t.match(/\b(imminent|at first|soon|later)\b/);
    const whenRaw = mWhen ? mWhen[1] : '';
    const idxWhen = mWhen ? mWhen.index : -1;

    const isExpected   = /\bexpected\b/.test(t);
    const mExpWhen     = t.match(/\bexpected\b\s*(imminent|soon|later)\b/);
    const expectedWhen = mExpWhen ? mExpWhen[1] : '';

    // tokens that mark the start of later actions
    const cut = Math.min(
      idxTurn  === -1 ? Infinity : idxTurn,
      idxTrend === -1 ? Infinity : idxTrend
    );

    // Base (with or without direction)
    const mBaseDir = t.match(new RegExp(
      `\\b${DIR_RE}\\s+(?:severe\\s+gale|gale|storm)(?:\\s*force)?\\s*(\\d+)?`
    ));
    const mBaseHead = t.match(/\b(severe\s+gale|gale|storm)(?:\s*force)?\s*(\d+)?/);

    let cand = null, dirNow = null;
    if (mBaseDir && mBaseDir.index < cut) {
      cand = { text: mBaseDir[0], num: mBaseDir[1], idx: mBaseDir.index };
      dirNow = dirCode(mBaseDir[0].match(new RegExp(`^${DIR_RE}`))[0]);
    } else if (mBaseHead && mBaseHead.index < cut) {
      cand = { text: mBaseHead[1], num: mBaseHead[2], idx: mBaseHead.index };
      dirNow = null;
    }

    if (cand){
      const snippet = cand.text;
      let force = null;
      if (cand.num)                       force = parseInt(cand.num, 10);
      else if (/\bstorm\b/.test(snippet)) force = 10;
      else if (/\bsevere\s+gale\b/.test(snippet)) force = 9;
      else                                 force = 8;

      let whenBase = '';
      if (expectedWhen) whenBase = expectedWhen;
      else if (mWhen && idxWhen < cut) whenBase = whenRaw;

      const ceasedNow = /\bnow\s+ceased\b/.test(t) && !isExpected;

      out.push({ type:'base', dirNow, force, when: whenBase, ceasedNow, isExpected });
    }

    // Veer/back — local timeword only
    // Veer/back — accept present & past (veering/backing/veered/backed)
    // If no explicit timeword but "now" is present → when = "now"

    const mTurn = t.match(new RegExp(
      `\\b(veering|backing|veered|backed)\\b(?:\\s+now)?[^,;.]*?\\b(${DIR_RE})\\b(?:\\s*(imminent|soon|later|now))?`
    ));



    if (mTurn){
      const verbRaw = mTurn[1];
      const normVerb = /back/i.test(verbRaw) ? 'backing' : 'veering';   // normalise
      const whenTurn = (mTurn[3] || '').toLowerCase() || (/\bnow\b/.test(t) ? 'now' : '');
      out.push({
        type: 'veer',
        turnVerb: normVerb,
        dirNext: dirCode(mTurn[2]),
        when: whenTurn
      });
    }

    // Veer/back — accept NOW-first form, e.g. "now backed northerly"
    if (!mTurn) {
      const mNowFirst = t.match(new RegExp(
        `\\bnow\\s+(backing|veering|backed|veered)\\s+(${DIR_RE})\\b`
      ));
      if (mNowFirst) {
        const normVerb = /back/i.test(mNowFirst[1]) ? 'backing' : 'veering';
        out.push({
          type: 'veer',
          turnVerb: normVerb,
          dirNext: dirCode(mNowFirst[2]),
          when: 'now'
        });
      }
    }



    // Trend — allow optional local timeword after the number
    const mt = t.match(/\b(increasing|decreasing)\b[^,;.]*?(?:to\s*)?(?:(severe\s+gale|storm))?(?:\s*force)?\s*(\d+)(?:\s*(imminent|soon|later))?/);
    if (mt){
      out.push({
        type:'trend',
        trendVerb: mt[1],
        trendSeverity: mt[2] || '',
        trendTo: parseInt(mt[3],10),
        when: mt[4] || whenRaw || expectedWhen
      });
    }

    return out;
  }

  // ===== Public parser =====
  function parseGale(text){
    if (!text || NO_GALES_RE.test(text)) return null;
    const raw  = String(text).trim();
    const body = stripHeader(raw);
    if (!body) return null;

    // Quick inference: "now backed/veered <dir>" anywhere in the body
    const QUICK_NOW_DIR =
      (() => {
        const s = body.toLowerCase();
        // "now backed northerly" OR "backed northerly now"
        let m = s.match(new RegExp(`\\bnow\\s+(?:backed|veered)\\s+(${DIR_RE})\\b`));
        if (m) return dirCode(m[1]);
        m = s.match(new RegExp(`\\b(?:backed|veered)\\s+(${DIR_RE})\\s+now\\b`));
        if (m) return dirCode(m[1]);
        return null;
      })();




    const clauses = body
      .split(/(?:,|;|\.)\s+|(?:\bthen\b|\bfollowed by\b)\s+/i)
      .map(s => s.trim()).filter(Boolean);

    const events = clauses.flatMap(normalizeClause).map(e => ({ ...e, rank: timeRank(e.when) }));

    // base (earliest active; else earliest expected)
    let base =
      events
        .filter(e => e.type === 'base' && !e.ceasedNow && Number.isFinite(e.force))
        .sort((a,b) => a.rank - b.rank)[0]
      || events
        .filter(e => e.type === 'base' && e.isExpected && Number.isFinite(e.force))
        .sort((a,b) => a.rank - b.rank)[0];

    if (!base){
      if (!/\b(gale|storm)\b/i.test(body)) return null;
      base = {
        type: 'base',
        when: 'now',
        dirNow: null,
        force: /\bstorm\b/i.test(body) ? 10 : /\bsevere\s+gale\b/i.test(body) ? 9 : 8,
        rank: 0,
        ceasedNow: false,
        isExpected: false
      };
    }



  // what goes on the dial
  const turnedNowDir = findTurnedNowDir(body);   // ← inference from "now backed/veered X"
  const dialWhen     = base.when || (base.isExpected ? 'soon' : 'now');
  const futureOnly   = (!!dialWhen && !/^now$/i.test(dialWhen)) || !!base.isExpected;

  // prefer explicit 'now' turn event; otherwise use the inferred direction
  const veerNow = events
    .filter(e => e.type === 'veer' && (e.when === '' || /^now$/i.test(e.when)))
    .sort((a,b) => a.rank - b.rank)[0] || null;




  const dial = {
    force:   base.force ?? null,
    dir:     base.dirNow || (veerNow && veerNow.dirNext) || QUICK_NOW_DIR || null,
    when:    dialWhen,
    caption: forceCaption(base.force ?? null),
    future:  futureOnly
  };



  // (optional extra safety if you keep it)
  // if still no dir, try a final regex sweep (both word orders)
  if (!dial.dir) {
    const b = String(body || '').toLowerCase();
    const m = b.match(new RegExp(
      `(?:\\bnow\\s+(?:backed|veered)\\s+(${DIR_RE})\\b|\\b(?:backed|veered)\\s+(${DIR_RE})\\s+now\\b)`
    ));
    const word = m ? (m[1] || m[2]) : null;
    if (word) dial.dir = dirCode(word);
  }
    // veer/back after (or at) base
    const veer = events
      .filter(e => e.type === 'veer' && e.rank >= base.rank)
      .sort((a,b) => a.rank - b.rank)[0] || null;

    // trend after veer (if any) else after base
    const afterRank = veer ? veer.rank : base.rank;
    const trend = events
      .filter(e => e.type === 'trend' && e.rank >= afterRank)
      .sort((a,b) => a.rank - b.rank)[0] || null;

    // arc
    let arc = null;
    if (veer && veer.dirNext){
      const fromDir = dial.dir || veer.dirNow || veer.dirNext;
      arc = { verb: veer.turnVerb, from: fromDir, to: veer.dirNext, when: veer.when };
    }

    // below chips (veer then trend), no "then"
    const below = [];
    if (veer){
      const when = veer.when ? ' ' + veer.when : '';
      below.push({
        kind: 'veer',
        text: `${veer.turnVerb} ${veer.dirNext?.toUpperCase() || ''}${when}`.trim(),
        sev: dial.force
      });
    }
    if (trend){
      let sevTxt = '';
      if (/storm/i.test(trend.trendSeverity)) sevTxt = 'storm force ';
      else if (/severe/i.test(trend.trendSeverity)) sevTxt = 'severe gale force ';
      else sevTxt = 'gale force ';
      const when = trend.when ? ' ' + trend.when : '';
      below.push({
        kind: 'trend',
        text: `${trend.trendVerb} ${sevTxt}${trend.trendTo}${when}`,
        sev: trend.trendTo || dial.force
      });
    }

    return { raw, dial, arc, below };
  }

  // ===== Dial rendering =====
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function arcPath(r,a1,a2,cw){
    let s=a1%360; if(s<0) s+=360; let e=a2%360; if(e<0) e+=360;
    let sweep; if(cw){ let d=e-s; if(d<0) d+=360; sweep=d; } else { let d=s-e; if(d<0) d+=360; sweep=-d; }
    const largeArc = Math.abs(sweep)>180?1:0, sweepFlag = sweep>=0?1:0;
    const toXY = (deg)=>{ const rad=(deg-90)*Math.PI/180; return {x:r*Math.cos(rad), y:r*Math.sin(rad)}; };
    const p1=toXY(s), p2=toXY(e);
    return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  function sevClass(n){ if(n>=10) return 'sev10'; if(n>=9) return 'sev9'; return 'sev8'; }

    function renderGaleDial(el, model){
    el.textContent = '';
    if (!model || !model.dial || !Number.isFinite(model.dial.force)){
        el.textContent = '(no parse)';
        return;
    }

    const force = model.dial.force;
    const dir   = model.dial.dir;

    const RING_R=90, CHEV_R=78, SECTOR_R=116;
    const outer=document.createElement('div'); Object.assign(outer.style,{display:'inline-block',width:'270px',verticalAlign:'top'});
    const wrap =document.createElement('div'); wrap.className='gd-dial'; Object.assign(wrap.style,{position:'relative',width:'270px',height:'240px'});
    const svg  =document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','-135 -125 270 250'); svg.setAttribute('width','270'); svg.setAttribute('height','240');

    // ring + NESW
    const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');
    ring.setAttribute('cx','0'); ring.setAttribute('cy','0'); ring.setAttribute('r',RING_R);
    ring.setAttribute('fill','none'); ring.setAttribute('stroke','#e5e7eb'); ring.setAttribute('stroke-width','2'); svg.appendChild(ring);
    [['N',0,-RING_R],['E',RING_R,0],['S',0,RING_R],['W',-RING_R,0]].forEach(([txt,x,y])=>{
        const t=document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x',x); t.setAttribute('y',y+6);
        t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','20'); t.setAttribute('font-weight','700'); t.setAttribute('fill','#6b7280'); t.textContent=txt; svg.appendChild(t);
    });

    // wind chevron (hide if no dir)
    const gChev=document.createElementNS('http://www.w3.org/2000/svg','g');
    const ch=document.createElementNS('http://www.w3.org/2000/svg','path'); ch.setAttribute('d','M -12,-4 L 0,-22 L 12,-4');
    ch.setAttribute('fill','none'); ch.setAttribute('stroke','#1d4ed8'); ch.setAttribute('stroke-width','6'); ch.setAttribute('stroke-linecap','round'); ch.setAttribute('stroke-linejoin','round');
    gChev.appendChild(ch);
    if (dir) gChev.setAttribute('transform',`rotate(${dirAngle(dir)}) translate(0,-${CHEV_R}) rotate(180)`);
    else gChev.style.display='none';
    svg.appendChild(gChev);

    // big number
    const n=document.createElementNS('http://www.w3.org/2000/svg','text');
    n.setAttribute('x','0'); n.setAttribute('y','0'); n.setAttribute('text-anchor','middle'); n.setAttribute('dominant-baseline','middle');
    n.setAttribute('font-size','64'); n.setAttribute('font-weight','900'); n.setAttribute('fill','white');
    n.setAttribute('stroke','#111'); n.setAttribute('stroke-width','5'); n.setAttribute('stroke-linejoin','round'); n.setAttribute('paint-order','stroke');
    n.textContent=String(force); svg.appendChild(n);

    // caption (“gale force / severe gale / storm force”)
    const lbl=document.createElement('div');
    lbl.textContent = (force>=10)?'storm force':(force>=9)?'severe gale':'gale force';
    Object.assign(lbl.style,{position:'absolute',left:'50%',top:'26%',transform:'translateX(-50%)',fontWeight:'500'});
    wrap.appendChild(lbl);

    // centre time chip (only for future-only dials)
    if (model.dial.future && model.dial.when && !/^now$/i.test(model.dial.when)) {
        const chip = document.createElement('span');
        chip.className = 'gd-chip gd-chip--in';
        chip.textContent = model.dial.when;
        // nudge position a touch lower (adjust to taste, e.g. '56%' or '60%')
        Object.assign(chip.style, {
        position:'absolute', left:'50%', transform:'translate(-50%, -50%)', top:'65%',
        background: (force>=10)?'#ffe1e1':(force>=9)?'#ffe8cc':'#fff3bf', color:'#111', fontSize:'14px', fontWeight:'700',
        borderRadius:'999px', padding:'4px 10px', zIndex:5
        });
        wrap.appendChild(chip);
    }

    wrap.appendChild(svg);
    outer.appendChild(wrap);

    // veer/back arc
    if (model.arc && model.arc.from && model.arc.to){
        const start = dirAngle(model.arc.from);
        const end   = dirAngle(model.arc.to);
        const cw    = (model.arc.verb === 'veering');

        const HEAD_W=14, HEAD_H=24, TIP_NUDGE_DEG=0.7;
        const hDeg    = (HEAD_H / SECTOR_R) * 180 / Math.PI;
        const endBase = cw ? (end - hDeg - TIP_NUDGE_DEG) : (end + hDeg + TIP_NUDGE_DEG);
        const a  = endBase * Math.PI / 180;
        const bx = SECTOR_R * Math.sin(a), by = -SECTOR_R * Math.cos(a);
        const headRot = cw ? (endBase + 90) : (endBase - 90);


        // ... compute start/end/endBase, bx/by, headRot, etc ...

        // 1) draw the arc FIRST
        const arcBlue = document.createElementNS('http://www.w3.org/2000/svg','path');
        arcBlue.setAttribute('d', arcPath(SECTOR_R, start, endBase, cw));
        arcBlue.setAttribute('fill','none');
        arcBlue.setAttribute('stroke','#1d4ed8');
        arcBlue.setAttribute('stroke-width','10');
        arcBlue.setAttribute('stroke-linecap','round');
        svg.appendChild(arcBlue);

        const arcWhite = document.createElementNS('http://www.w3.org/2000/svg','path');
        arcWhite.setAttribute('d', arcPath(SECTOR_R, start, endBase, cw));
        arcWhite.setAttribute('fill','none');
        arcWhite.setAttribute('stroke','#fff');
        arcWhite.setAttribute('stroke-width','6');
        arcWhite.setAttribute('stroke-linecap','round');
        svg.appendChild(arcWhite);

        // 2) draw the ARROWHEAD LAST so it sits on top
        const gHead = document.createElementNS('http://www.w3.org/2000/svg','g');
        gHead.setAttribute('transform',`translate(${bx.toFixed(2)},${by.toFixed(2)}) rotate(${headRot})`);

        const sidePath = `M -${HEAD_W},0 L 0,-${HEAD_H} L ${HEAD_W},0`;
        const headWhite = document.createElementNS('http://www.w3.org/2000/svg','path');
        headWhite.setAttribute('d',sidePath);
        headWhite.setAttribute('fill','none');
        headWhite.setAttribute('stroke','#fff');
        headWhite.setAttribute('stroke-width','12');
        headWhite.setAttribute('stroke-linejoin','round');
        headWhite.setAttribute('stroke-linecap','butt');
        gHead.appendChild(headWhite);

        const headBlue = document.createElementNS('http://www.w3.org/2000/svg','path');
        headBlue.setAttribute('d',sidePath);
        headBlue.setAttribute('fill','none');
        headBlue.setAttribute('stroke','#1d4ed8');
        headBlue.setAttribute('stroke-width','5');
        headBlue.setAttribute('stroke-linejoin','round');
        headBlue.setAttribute('stroke-linecap','butt');
        gHead.appendChild(headBlue);

        svg.appendChild(gHead);   // ← appended last = on top

    }

    // chips below (order: veer then trend), from model.below
    // --- chips below (order: veer then trend) ---
    const meta = document.createElement('div');
    meta.style.marginTop = '12px';
    meta.style.textAlign = 'center';

    if (Array.isArray(model.below)) {
      for (const step of model.below) {
        // HIDE veer chips that are "now" (or empty when)
        if (step.kind === 'veer') {
          const txtNorm = String(step.text||'').toLowerCase().trim();
          if (txtNorm.endsWith(' now') || txtNorm === 'backing now' || txtNorm === 'veering now') {
            continue; // skip this chip
          }
        }

        const mc = document.createElement('span');
        mc.className = 'gd-chip gd-chip--below ' + (step.sev>=10?'sev10':step.sev>=9?'sev9':'sev8');
        mc.style.marginRight = '8px';

        let txt = String(step.text || '').replace(/^then\s+/i, '');
        if (step.kind === 'trend') {
          txt = txt
            .replace(/\bsevere\s+gale\s+(\d+)/i, 'severe gale force $1')
            .replace(/\bsevere\s+(\d+)/i,        'severe gale force $1')
            .replace(/\bstorm\s+(\d+)/i,         'storm force $1')
            .replace(/\bgale\s+(\d+)/i,          'gale force $1');
        }

        mc.textContent = txt;
        meta.appendChild(mc);
      }
    }
    outer.appendChild(meta);
    el.appendChild(outer);
  }
  // ===== export =====
  window.GD = { parseGale, renderGaleDial };
})();