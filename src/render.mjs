// HTML renderer. Layout/CSS = the agreed mock-up (claude.ai/artifact/5wy4y7ZxVJNEGAinmY38Do), light theme forced for PNG.
// Browser-safe (no Node imports).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
  :root {
    --bg: #F4F5F7; --surface: #FFFFFF; --text: #1B2333; --muted: #5B6472; --border: #DCDFE4;
    --amber: #C9862E; --red: #B4483A; --teal: #2F6F62;
    --bar-production: #3E4759; --bar-review: #A7ACB6; --track: #E7E9ED;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-feature-settings: "tnum" 1; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 780px; margin: 0 auto; padding: 40px 24px 48px; }
  .badge { display: inline-block; font-size: 12.5px; color: var(--muted); border: 1px solid var(--border); border-radius: 3px; padding: 3px 8px; margin-bottom: 20px; }
  h1 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: 38px; line-height: 1.15; margin: 0 0 6px; }
  .dates { color: var(--muted); font-size: 14.5px; margin: 0 0 36px; }
  .hero { display: flex; gap: 28px; align-items: baseline; padding: 20px 0 28px; border-bottom: 1px solid var(--border); margin-bottom: 36px; flex-wrap: wrap; }
  .hero-num { font-family: "Fraunces", Georgia, serif; font-size: 56px; line-height: 1; color: var(--red); }
  .hero-num.watch { color: var(--amber); } .hero-num.stable { color: var(--teal); }
  .hero-text { max-width: 460px; }
  .hero-text .label { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
  .hero-text .detail { font-size: 15px; }
  section { margin-bottom: 44px; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  h2 { font-family: "Fraunces", Georgia, serif; font-weight: 500; font-size: 21px; margin: 0; }
  .section-note { color: var(--muted); font-size: 13.5px; margin: 0 0 20px; max-width: 580px; }
  .row { display: grid; grid-template-columns: 170px 1fr 215px; gap: 16px; align-items: center; padding: 14px 0 14px 14px; border-left: 3px solid var(--border); border-bottom: 1px solid var(--border); }
  .row.status-overload { border-left-color: var(--red); }
  .row.status-watch { border-left-color: var(--amber); }
  .row.status-stable { border-left-color: var(--teal); }
  .row.status-empty { border-left-color: var(--border); }
  .row .who { font-size: 14.5px; }
  .row .who .disc { display:block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .track { position: relative; height: 8px; background: var(--track); border-radius: 2px; overflow: hidden; }
  .fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 2px; }
  .status-overload .fill { background: var(--red); }
  .status-watch .fill { background: var(--amber); }
  .status-stable .fill { background: var(--teal); }
  .status-empty .fill { background: var(--border); }
  .row-meta { font-size: 13px; color: var(--muted); text-align: right; }
  .row-meta strong { color: var(--text); font-weight: 500; }
  .flag { display: block; margin-top: 10px; font-size: 12px; color: var(--red); line-height: 1.5; }
  .flag.info { color: var(--muted); }
  .row.aggregate { border-left: 3px solid var(--text); font-weight: 500; }
  .row.aggregate .who { font-weight: 500; }
  .row.aggregate .fill { background: var(--text); opacity: 0.55; }
  .row.sub { margin-left: 22px; padding-left: 10px; }
  .section-divider { border: none; border-top: 1px dashed var(--border); margin: 4px 0 20px; }
  .cap-row { padding: 16px 0; border-bottom: 1px solid var(--border); }
  .cap-row:last-child { border-bottom: none; }
  .cap-name { font-size: 14.5px; margin-bottom: 8px; display:flex; justify-content: space-between;}
  .cap-name .role { color: var(--muted); font-size: 13px; }
  .cap-bar { display: flex; height: 20px; border-radius: 2px; overflow: hidden; }
  .cap-bar .seg-production { background: var(--bar-production); }
  .cap-bar .seg-review { background: var(--bar-review); }
  .cap-bar .seg-feedback { background: var(--amber); }
  .cap-nums { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted); margin-top: 6px; flex-wrap: wrap; gap: 4px 12px; }
  .cap-nums .fb { color: var(--amber); }
  .legend { display: flex; gap: 18px; font-size: 12.5px; color: var(--muted); margin-top: 14px; flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .footnote { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); font-size: 13px; color: var(--muted); line-height: 1.7; }
  .footnote strong { color: var(--text); }
  .footnote ul { margin: 8px 0 0; padding-left: 20px; }
  .footnote li { margin-bottom: 4px; }
`;

function rowHtml(r) {
  if (r.divider) return '<hr class="section-divider">';
  const cls = ['row', r.sub ? 'sub' : '', r.status === 'aggregate' ? 'aggregate' : `status-${r.status}`].filter(Boolean).join(' ');
  const meta = r.meta ? ` · ${esc(r.meta)}` : '';
  return `
    <div class="${cls}">
      <div class="who">${esc(r.label)}<span class="disc">${esc(r.person)}</span></div>
      <div class="track"><div class="fill" style="width:${r.width}%"></div></div>
      <div class="row-meta"><strong>${r.count}</strong> open${meta}</div>
    </div>`;
}

function flagsHtml(flags) {
  return flags.map((f) => `<span class="flag${f.kind === 'info' ? ' info' : ''}">${f.kind === 'warn' ? '⚠' : 'ⓘ'} ${esc(f.text)}</span>`).join('\n');
}

const STATUS_LEGEND = `
    <div class="legend">
      <span><i style="background:var(--teal)"></i>стабильно</span>
      <span><i style="background:var(--amber)"></i>стоит присмотреть</span>
      <span><i style="background:var(--red)"></i>превышен порог</span>
      <span><i style="background:var(--border)"></i>нет задач</span>
    </div>`;

function sectionHtml(s) {
  return `
  <section>
    <div class="section-head"><h2>${esc(s.title)}</h2></div>
    <p class="section-note">${esc(s.note)}</p>
    ${s.rows.map(rowHtml).join('\n')}
    ${flagsHtml(s.flags)}
    ${s.legend ? STATUS_LEGEND : ''}
  </section>`;
}

function capacityHtml(cap) {
  if (!cap || !cap.leads?.length) return '';
  const rows = cap.leads.map((l) => `
    <div class="cap-row">
      <div class="cap-name"><span>${esc(l.name)}</span><span class="role">${esc(l.role)}</span></div>
      <div class="cap-bar">
        <div class="seg-production" style="width:${l.production}%"></div>
        <div class="seg-review" style="width:${l.review}%"></div>
        <div class="seg-feedback" style="width:${l.feedback}%"></div>
      </div>
      <div class="cap-nums"><span>Production ${l.production}%</span><span>Review / coordination ${l.review}%</span><span class="fb">+${l.feedbackHours}ч фидбек по входящему контенту (${l.feedback}%)</span></div>
    </div>`).join('\n');
  return `
  <section>
    <div class="section-head"><h2>${esc(cap.title)}</h2></div>
    <p class="section-note">${esc(cap.note)}</p>
    ${rows}
    <div class="legend">
      <span><i style="background:var(--bar-production)"></i>production</span>
      <span><i style="background:var(--bar-review)"></i>review / coordination</span>
      <span><i style="background:var(--amber)"></i>фидбек по входящему контенту</span>
    </div>
  </section>`;
}

export function renderHtml(snap) {
  return `<!DOCTYPE html>
<html lang="ru" data-theme="light">
<head>
<meta charset="UTF-8">
<title>PG3D · ${esc(snap.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <span class="badge">${esc(snap.badge)}</span>
  <h1>${esc(snap.title)}</h1>
  <p class="dates">${esc(snap.subtitle)}</p>

  <div class="hero">
    <div class="hero-num ${esc(snap.hero.status)}">${snap.hero.number}</div>
    <div class="hero-text">
      <div class="label">${esc(snap.hero.label)}</div>
      <div class="detail">${esc(snap.hero.detail)}</div>
    </div>
  </div>

  ${snap.sections.map(sectionHtml).join('\n')}
  ${capacityHtml(snap.capacity)}

  <div class="footnote">
    <strong>Что здесь реальное, а что ручное:</strong>
    <ul>${snap.footnote.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  </div>
</div>
</body>
</html>`;
}
