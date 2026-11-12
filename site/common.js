// Shared helpers for both pages.

const params = new URLSearchParams(location.search);

// On GitHub Pages (owner.github.io/repo) the data is read from the repo's `data` branch.
// Anywhere else (local preview) it is read from ./data next to the page.
export const repo = (() => {
  if (!location.hostname.endsWith('.github.io')) return null;
  const owner = location.hostname.split('.')[0];
  const name = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  return { owner, name, url: `https://github.com/${owner}/${name}` };
})();

const DATA_BASE = params.get('data')
  || (repo ? `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/data` : 'data');

export async function load(file) {
  const res = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} while loading ${file}`);
  return res.json();
}

export async function pickShard() {
  const meta = await load('shards.json');
  const ids = Object.keys(meta.shards).sort();
  const wanted = params.get('shard');
  const id = ids.includes(wanted) ? wanted : (ids.includes('live-1') ? 'live-1' : ids[0]);
  const select = document.getElementById('shard');
  if (select && ids.length > 1) {
    select.hidden = false;
    select.innerHTML = ids.map((s) => `<option value="${s}"${s === id ? ' selected' : ''}>${shardName(s)}</option>`).join('');
    select.addEventListener('change', () => {
      params.set('shard', select.value);
      location.search = params.toString();
    });
  }
  return id;
}

export const shardName = (id) => id.replace('live-', 'Live-');

// Theme: follows the system, the button overrides it and is remembered per browser.
export function initTheme() {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* storage blocked */ }
  if (saved) root.dataset.theme = saved;
  const btn = document.getElementById('theme');
  const isDark = () => root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  // The button shows the theme it switches to: a sun in dark mode, a moon in light mode.
  const sync = () => {
    const dark = isDark();
    const label = dark ? 'Light mode' : 'Dark mode';
    btn.setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
    btn.querySelector('.btn-text').textContent = label;
    btn.querySelector('.i-moon').toggleAttribute('hidden', dark);
    btn.querySelector('.i-sun').toggleAttribute('hidden', !dark);
  };
  btn.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch { /* ignore */ }
    sync();
    document.dispatchEvent(new Event('themechange'));
  });
  sync();
}

export function initFooter() {
  const link = document.getElementById('source');
  if (repo) { link.href = repo.url; link.textContent = repo.url.replace('https://', ''); }
}

export const fmt = (n) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function date(t) {
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function dateTime(t) {
  return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
export function days(ms) {
  const d = ms / 86400000;
  return d < 10 ? d.toFixed(1) : String(Math.round(d));
}

export const TEAM = {
  C: { name: 'Colonials', cls: 'c' },
  W: { name: 'Wardens', cls: 'w' },
  N: { name: 'Unknown', cls: 'n' },
};
export const winnerKey = (w) => (w === 'COLONIALS' ? 'C' : w === 'WARDENS' ? 'W' : null);

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Time-series line chart in SVG.
// series: [{ label, cls: 'c' | 'w' | 'goal', points: [[time, value], ...] }]
// xMin/xMax pin the time axis so stacked charts line up; points with a null value are skipped.
export function lineChart(box, { series, height = 260, format = fmt, yMin, xMin, xMax }) {
  series = series.map((s) => ({ ...s, points: s.points.filter((p) => p[1] != null && !Number.isNaN(p[1])) }));
  const all = series.flatMap((s) => s.points);
  if (new Set(all.map((p) => p[0])).size < 2) {
    box.innerHTML = '<div class="empty">Not enough snapshots yet. The chart fills in as the collector runs every 15 minutes.</div>';
    return;
  }
  const draw = () => {
    const W = Math.max(box.clientWidth, 280);
    const H = height;
    const pad = { l: 56, r: 12, t: 12, b: 28 };
    const ts = all.map((p) => p[0]);
    const vs = all.map((p) => p[1]);
    const t0 = xMin ?? Math.min(...ts), t1 = xMax ?? Math.max(...ts);
    let v0 = yMin ?? Math.min(...vs), v1 = Math.max(...vs);
    if (v1 === v0) { v1 += 1; v0 = Math.max(0, v0 - 1); }
    const step = niceStep((v1 - v0) / 4);
    v0 = Math.floor(v0 / step) * step;
    v1 = Math.ceil(v1 / step) * step;
    const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - v0) / (v1 - v0)) * (H - pad.t - pad.b);

    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))} over time">`;
    for (let v = v0; v <= v1 + step / 2; v += step) {
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
      svg += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`;
    }
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--axis)"/>`;
    const ticks = Math.min(6, Math.max(2, Math.floor((W - pad.l) / 120)));
    const short = t1 - t0 < 4 * 86400000; // under 4 days: show the hour too
    const seenLabels = new Set();
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      const anchor = i === 0 ? 'start' : i === ticks ? 'end' : 'middle';
      const label = new Date(t).toLocaleString('en-GB', short
        ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short' });
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      svg += `<text x="${x(t)}" y="${H - 8}" text-anchor="${anchor}">${label}</text>`;
    }
    const styles = {
      c: 'stroke="var(--col-c)" stroke-width="3"',
      w: 'stroke="var(--col-w)" stroke-width="3" stroke-dasharray="8 5"',
      goal: 'stroke="var(--ink-soft)" stroke-width="1" stroke-dasharray="4 4"',
      total: 'stroke="var(--ink)" stroke-width="2"',
    };
    for (const s of series) {
      const pts = s.points.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" ${styles[s.cls]} stroke-linejoin="round"/>`;
    }
    svg += `<line class="cursor" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/></svg>`;
    box.innerHTML = svg + '<div class="readout"></div>';

    const svgEl = box.querySelector('svg');
    const cursor = box.querySelector('.cursor');
    const readout = box.querySelector('.readout');
    const main = series.find((s) => s.cls !== 'goal') || series[0];
    svgEl.addEventListener('pointermove', (e) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = t0 + ((px - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
      let best = main.points[0];
      for (const p of main.points) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      const cx = x(best[0]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      const rows = series.map((s) => {
        const p = s.points.find((q) => q[0] === best[0]) || s.points.reduce((a, q) => (Math.abs(q[0] - best[0]) < Math.abs(a[0] - best[0]) ? q : a));
        return `<div>${esc(s.label)}: <strong>${esc(format(p[1]))}</strong></div>`;
      }).join('');
      readout.innerHTML = `<div>${dateTime(best[0])}</div>${rows}`;
      readout.style.display = 'block';
      const left = (cx / W) * r.width;
      readout.style.left = `${Math.min(Math.max(left + 12, 0), r.width - readout.offsetWidth)}px`;
    });
    svgEl.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); readout.style.display = 'none'; });
  };
  draw();
  let last = box.clientWidth;
  new ResizeObserver(() => { if (Math.abs(box.clientWidth - last) > 4) { last = box.clientWidth; draw(); } }).observe(box);
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function showError(err) {
  const main = document.querySelector('main .wrap');
  main.prepend(el(`<div class="error" role="alert"><strong>Could not load data.</strong> ${esc(err.message)}. The collector may not have run yet; try again in 15 minutes.</div>`));
  console.error(err);
}
