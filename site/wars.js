import {
  load, pickShard, shardName, initTheme, initFooter, fmt, pct, date, dateTime, ago, days,
  TEAM, winnerKey,
} from './common.js';

initTheme();
initFooter();

const $ = (id) => document.getElementById(id);
const CHECK_MS = 15 * 60000;

// Round the axis top up so the four gridline steps are whole, even numbers.
function niceMax(v) {
  if (v <= 4) return 4;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s * 4 >= v) || Math.ceil(v / 400) * 100;
  return step * 4;
}

async function main() {
  const shard = await pickShard();
  const index = await load(`${shard}/index.json`);
  const wars = index.wars;
  $('updated').textContent = `Shard ${shardName(shard)} · last check ${dateTime(index.updated)} (${ago(index.updated)})`;

  const finished = wars.filter((w) => winnerKey(w.winner));
  const cWins = finished.filter((w) => w.winner === 'COLONIALS').length;
  const wWins = finished.length - cWins;
  $('k-n').textContent = wars.length;
  const first = wars[0]?.warNumber, last = wars[wars.length - 1]?.warNumber;
  const range = !wars.length ? 'none yet' : first === last ? `War ${first}` : `Wars ${first}–${last}`;
  $('k-n-sub').textContent = wars.length ? `${range} · ${finished.length || 'none'} finished` : range;
  $('k-c').textContent = cWins;
  $('k-w').textContent = wWins;
  const share = (n) => (finished.length ? `${pct(n, finished.length)} of finished wars` : 'no finished wars yet');
  $('k-c-sub').textContent = share(cWins);
  $('k-w-sub').textContent = share(wWins);

  // Wars with a launch difference: did the side with more launches win?
  const decided = finished.filter((w) => w.launches.C !== w.launches.W);
  const edge = decided.filter((w) => (w.launches.C > w.launches.W) === (w.winner === 'COLONIALS')).length;
  $('k-edge').textContent = decided.length ? pct(edge, decided.length) : '—';
  $('k-edge-sub').textContent = decided.length
    ? `the side with more launches won ${edge} of ${decided.length} wars`
    : 'needs finished wars where one side launched more';
  // Highlight this tile only once it has a real answer.
  $('k-edge').parentElement.classList.toggle('feature', decided.length > 0);

  // Bar chart
  const anyLaunches = wars.some((w) => w.launches.C + w.launches.W > 0);
  if (!wars.length) {
    $('bars').innerHTML = '<div class="empty">No wars recorded yet.</div>';
  } else if (!anyLaunches) {
    $('bars').innerHTML = '<div class="empty">No rocket launches recorded yet.</div>';
  } else {
    const max = niceMax(Math.max(1, ...wars.map((w) => Math.max(w.launches.C, w.launches.W))));
    const h = (v) => `${(v / max) * 100}%`;
    const yLabels = [max, max * 0.75, max * 0.5, max * 0.25, 0].map((v) => `<span>${Math.round(v)}</span>`).join('');
    const cols = wars.map((w) => `
      <div class="col">
        <div title="War ${w.warNumber}, Colonials: ${w.launches.C}" style="height:${h(w.launches.C)};background:var(--col-c)"></div>
        <div title="War ${w.warNumber}, Wardens: ${w.launches.W}" style="height:${h(w.launches.W)};background:var(--col-w)"></div>
      </div>`).join('');
    const labels = wars.map((w) => {
      const k = winnerKey(w.winner);
      const badge = k
        ? `<span class="badge ${TEAM[k].cls}" title="${TEAM[k].name} won">${k}</span>`
        : '<span class="badge n" title="In progress">…</span>';
      return `<div><span>${w.warNumber}</span>${badge}</div>`;
    }).join('');
    $('bars').innerHTML = `
      <div class="scroll-x">
        <div class="bars" style="min-width:${Math.max(320, wars.length * 44)}px" role="img"
             aria-label="Rocket launches per war for Colonials and Wardens">
          <div class="y">${yLabels}</div>
          <div class="plot">
            <div class="area">${cols}</div>
            <div class="labels">${labels}</div>
          </div>
        </div>
      </div>`;
  }

  // Table
  $('wars').innerHTML = wars.slice().reverse().map((w) => {
    const k = winnerKey(w.winner);
    const start = w.conquestStartTime;
    const end = w.conquestEndTime || w.lastSeen;
    const watched = w.lastSeen - w.firstSeen;
    const expected = Math.max(1, Math.round(watched / CHECK_MS) + 1);
    const winner = k
      ? `<span class="pair"><span class="swatch ${TEAM[k].cls}"></span>${TEAM[k].name}</span>`
      : 'In progress';
    return `
      <tr>
        <td class="name">#${w.warNumber}</td>
        <td>${winner}</td>
        <td class="num">${start ? `${days(end - start)} days` : '—'}</td>
        <td class="num">${fmt(w.colonialCasualties)}</td>
        <td class="num">${fmt(w.wardenCasualties)}</td>
        <td class="num">${w.launches.C} / ${w.launches.W}</td>
        <td class="num">${w.impacts.C + w.impacts.W + w.impacts.N}</td>
        <td class="num" title="Recorded since ${date(w.firstSeen)}">${pct(Math.min(w.samples, expected), expected)}</td>
      </tr>`;
  }).join('');
}

main().catch((err) => {
  document.querySelector('main .wrap').insertAdjacentHTML('afterbegin',
    `<div class="error" role="alert"><strong>Could not load data.</strong> ${err.message}</div>`);
  console.error(err);
});
