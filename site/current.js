import {
  load, pickShard, shardName, initTheme, initFooter, fmt, date, dateTime, ago, days,
  TEAM, winnerKey, esc, lineChart, showError,
} from './common.js';

initTheme();
initFooter();

const $ = (id) => document.getElementById(id);

async function loadSamples(shard, war) {
  const files = await Promise.all(
    war.days.map((d) => load(`${shard}/samples/${war.warNumber}/${d}.json`).catch(() => null)),
  );
  const fields = files.find(Boolean)?.sampleFields || [];
  const rows = files.filter(Boolean).flatMap((f) => f.samples).sort((a, b) => a[0] - b[0]);
  return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
}

// Casualties per hour from consecutive snapshots. Gaps longer than 2 h (collector outages)
// and resets are skipped rather than averaged over.
function ratePerHour(samples, key) {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const hours = (b.time - a.time) / 3600000;
    const diff = b[key] - a[key];
    if (hours <= 0 || hours > 2 || diff < 0) continue;
    out.push([b.time, diff / hours]);
  }
  return out;
}

async function main() {
  const shard = await pickShard();
  const [latest, index] = await Promise.all([load(`${shard}/latest.json`), load(`${shard}/index.json`)]);
  const war = await load(`${shard}/wars/${latest.war.warNumber}.json`);
  const samples = await loadSamples(shard, war);
  const w = latest.war;
  const entry = index.wars.find((x) => x.warId === w.warId) || {};

  // Header
  $('title').textContent = `War ${w.warNumber}`;
  document.title = `War ${w.warNumber} · Foxhole War Stats`;
  const win = winnerKey(w.winner);
  const start = w.conquestStartTime;
  const end = w.conquestEndTime || latest.time;
  const status = win
    ? `${TEAM[win].name} won on ${date(w.conquestEndTime)} after ${days(end - start)} days.`
    : start ? `Day ${days(end - start)} of the conquest, started ${date(start)}.` : 'The conquest has not started yet.';
  $('lead').textContent = `${shardName(shard)}. ${status}`;
  $('updated').textContent = `Snapshot from ${dateTime(latest.time)} (${ago(latest.time)}). Checked every 15 minutes.`;

  // KPIs
  const maps = latest.maps;
  const sum = (f) => maps.reduce((a, m) => a + f(m), 0);
  const vtC = sum((m) => m.vt.C), vtW = sum((m) => m.vt.W), scorched = sum((m) => m.scorchedVT);
  const needed = w.requiredVictoryTowns - scorched;
  $('k-vt').textContent = `${vtC} – ${vtW}`;
  $('k-vt-sub').textContent = `Colonials – Wardens · ${needed} needed to win${scorched ? ` (${scorched} scorched)` : ''}`;

  const cc = sum((m) => m.cCas), wc = sum((m) => m.wCas);
  $('k-cc').textContent = fmt(cc);
  $('k-wc').textContent = fmt(wc);
  const day = 24 * 3600000;
  const since = samples.filter((s) => s.time >= latest.time - day);
  const last24 = (key) => (since.length > 1 ? since[since.length - 1][key] - since[0][key] : null);
  const span = since.length > 1 ? (since[since.length - 1].time - since[0].time) / 3600000 : 0;
  const per = (v) => (v == null ? 'collecting…' : `+${fmt(v)} in the last ${span >= 23 ? '24' : Math.max(1, Math.round(span))} h`);
  $('k-cc-sub').textContent = per(last24('colonialCasualties'));
  $('k-wc-sub').textContent = per(last24('wardenCasualties'));

  const launches = entry.launches || { C: 0, W: 0, N: 0 };
  const impacts = entry.impacts || { C: 0, W: 0, N: 0 };
  $('k-rk').textContent = `${launches.C + launches.W + launches.N}`;
  $('k-rk-sub').textContent = `Colonials ${launches.C} · Wardens ${launches.W}${launches.N ? ` · unknown ${launches.N}` : ''} · ${impacts.C + impacts.W + impacts.N} impacts · since ${date(war.firstSeen)}`;

  // Charts
  lineChart($('chart-vt'), {
    yMin: 0,
    series: [
      { label: 'Colonials', cls: 'c', points: samples.map((s) => [s.time, s.colonialVictoryTowns]) },
      { label: 'Wardens', cls: 'w', points: samples.map((s) => [s.time, s.wardenVictoryTowns]) },
      { label: 'Needed', cls: 'goal', points: samples.map((s) => [s.time, w.requiredVictoryTowns - s.scorchedVictoryTowns]) },
    ],
  });
  lineChart($('chart-cas'), {
    yMin: 0,
    series: [
      { label: 'Colonials', cls: 'c', points: ratePerHour(samples, 'colonialCasualties') },
      { label: 'Wardens', cls: 'w', points: ratePerHour(samples, 'wardenCasualties') },
    ],
    format: (v) => `${fmt(v)}/h`,
  });

  // Rockets
  const site = (k, label, extra) => `
    <div class="kpi" style="background: var(--surface-2)">
      <span class="label"><span class="swatch ${TEAM[k].cls}"></span>${label}</span>
      <span class="value">${sum((m) => m.sites[k])}</span>
      <span class="sub">${extra}</span>
    </div>`;
  $('sites').innerHTML = site('C', 'Colonial rocket sites', `${sum((m) => m.armed.C)} with a rocket loaded`)
    + site('W', 'Warden rocket sites', `${sum((m) => m.armed.W)} with a rocket loaded`);
  const events = war.events.slice().reverse();
  $('events').innerHTML = events.length
    ? events.slice(0, 30).map((e) => `
      <li>
        <time datetime="${new Date(e.t).toISOString()}">${dateTime(e.t)}</time>
        <span class="badge ${TEAM[e.team].cls}">${e.team}</span>
        <span>${e.type === 'target' ? 'Launch target set' : 'Impact'} in <strong>${esc(e.label)}</strong></span>
      </li>`).join('')
    : '<li class="empty">No launches or impacts seen yet this war.</li>';

  // Regions
  const rows = maps.slice().sort((a, b) => (b.cCas + b.wCas) - (a.cCas + a.wCas));
  $('regions').innerHTML = rows.map((m) => `
    <tr>
      <td class="name">${esc(m.label)}</td>
      <td class="num">${m.vt.C} / ${m.vt.W}${m.scorchedVT ? ` <span class="note">(${m.scorchedVT} scorched)</span>` : ''}</td>
      <td class="num">${m.towns.C} / ${m.towns.W}</td>
      <td class="num">${fmt(m.cCas)}</td>
      <td class="num">${fmt(m.wCas)}</td>
      <td class="num">${fmt(m.enlist)}</td>
      <td class="num">${m.sites.C} / ${m.sites.W}</td>
    </tr>`).join('');
}

main().catch(showError);
