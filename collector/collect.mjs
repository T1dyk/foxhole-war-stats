// Foxhole war collector.
// Polls the official War API (https://github.com/clapfoot/warapi) once per run,
// using ETags as the API docs ask, and writes compact per-war summaries.
//
// Usage: node collector/collect.mjs <dataDir>

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA = process.argv[2] || 'data';
const REPO = process.env.GITHUB_REPOSITORY || 'local';
const UA = `foxhole-war-stats-collector (https://github.com/${REPO})`;
const PAUSE_MS = 150; // spacing between requests, keeps us gentle on the API

// Live-2 and Live-3 are often offline (503); a shard is skipped when its war endpoint fails.
const SHARDS = [
  { id: 'live-1', api: 'https://war-service-live.foxholeservices.com/api' },
  { id: 'live-2', api: 'https://war-service-live-2.foxholeservices.com/api' },
];

const ICON = { ROCKET_SITE: 37, ROCKET_TARGET: 70, ROCKET_GROUND_ZERO: 71, ROCKET_SITE_ARMED: 72 };
const TOWN_ICONS = new Set([45, 56, 57, 58]); // relic base, town base T1–T3
const FLAG = { VICTORY_BASE: 0x01, SCORCHED: 0x10 };

export const SAMPLE_FIELDS = [
  'time', 'dayOfWar', 'colonialCasualties', 'wardenCasualties', 'totalEnlistments',
  'colonialVictoryTowns', 'wardenVictoryTowns', 'scorchedVictoryTowns',
  'colonialTowns', 'wardenTowns', 'colonialRocketSites', 'wardenRocketSites',
  'colonialArmedSites', 'wardenArmedSites',
  // Players in Foxhole on Steam right now: all shards and both factions together.
  'steamPlayers',
];

const STEAM_URL = 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=505460';

// Official Steam Web API, no key needed. Returns null when Steam doesn't answer.
async function steamPlayers() {
  try {
    const res = await fetch(STEAM_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.response?.result === 1 ? body.response.player_count : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value) + '\n');
}

// GET with If-None-Match. On 304 returns the summary cached for that URL.
async function get(state, url, summarize) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const cached = state.cache[url];
  if (cached && state.etags[url]) headers['If-None-Match'] = state.etags[url];
  await sleep(PAUSE_MS);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (res.status === 304 && cached) return cached;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const value = summarize(await res.json());
  const etag = res.headers.get('etag');
  if (etag) state.etags[url] = etag; else delete state.etags[url];
  state.cache[url] = value;
  return value;
}

const side = (team) => (team === 'COLONIALS' ? 'C' : team === 'WARDENS' ? 'W' : 'N');
const pair = () => ({ C: 0, W: 0, N: 0 });

function summarizeDynamic(d) {
  const s = { vt: pair(), scorchedVT: 0, towns: pair(), sites: pair(), armed: pair(), targets: [], impacts: [] };
  for (const it of d.mapItems || []) {
    const t = side(it.teamId);
    if (it.flags & FLAG.VICTORY_BASE) {
      if (it.flags & FLAG.SCORCHED) s.scorchedVT++; else s.vt[t]++;
    }
    if (TOWN_ICONS.has(it.iconType)) s.towns[t]++;
    if (it.iconType === ICON.ROCKET_SITE) s.sites[t]++;
    if (it.iconType === ICON.ROCKET_SITE_ARMED) { s.sites[t]++; s.armed[t]++; }
    const spot = { team: t, x: +it.x.toFixed(4), y: +it.y.toFixed(4) };
    if (it.iconType === ICON.ROCKET_TARGET) s.targets.push(spot);
    if (it.iconType === ICON.ROCKET_GROUND_ZERO) s.impacts.push(spot);
  }
  return s;
}

const summarizeReport = (r) => ({
  day: r.dayOfWar, enlist: r.totalEnlistments, cCas: r.colonialCasualties, wCas: r.wardenCasualties,
});

function summarizeWar(w) {
  return {
    warId: w.warId, warNumber: w.warNumber, winner: w.winner,
    conquestStartTime: w.conquestStartTime, conquestEndTime: w.conquestEndTime,
    resistanceStartTime: w.resistanceStartTime, requiredVictoryTowns: w.requiredVictoryTowns,
    scheduledConquestEndTime: w.scheduledConquestEndTime ?? null,
    shortRequiredVictoryTowns: w.shortRequiredVictoryTowns ?? 0,
  };
}

function prettyMap(name) {
  return name.replace(/Hex$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

async function collectShard(shard, state, now, steam) {
  const war = await get(state, `${shard.api}/worldconquest/war`, summarizeWar);
  const mapNames = await get(state, `${shard.api}/worldconquest/maps`, (m) => m);

  const maps = [];
  for (const name of mapNames) {
    if (name.startsWith('HomeRegion')) continue; // no map data for home regions (API docs)
    try {
      const report = await get(state, `${shard.api}/worldconquest/warReport/${name}`, summarizeReport);
      const dyn = await get(state, `${shard.api}/worldconquest/maps/${name}/dynamic/public`, summarizeDynamic);
      maps.push({ name, label: prettyMap(name), ...report, ...dyn });
    } catch (err) {
      console.warn(`skip ${shard.id}/${name}: ${err.message}`);
    }
  }
  if (!maps.length) throw new Error('no map data');

  const sum = (f) => maps.reduce((a, m) => a + f(m), 0);
  const sample = [
    now, Math.max(...maps.map((m) => m.day || 0)), sum((m) => m.cCas), sum((m) => m.wCas), sum((m) => m.enlist),
    sum((m) => m.vt.C), sum((m) => m.vt.W), sum((m) => m.scorchedVT),
    sum((m) => m.towns.C), sum((m) => m.towns.W), sum((m) => m.sites.C), sum((m) => m.sites.W),
    sum((m) => m.armed.C), sum((m) => m.armed.W), steam,
  ];

  // Rocket events: an icon seen for the first time becomes an event.
  // Keys are dropped when the icon leaves the map, so a later strike on the same spot counts again.
  const sh = (state.shards[shard.id] ||= { active: {} });
  if (sh.warId !== war.warId) { sh.warId = war.warId; sh.active = {}; }
  const seen = {};
  const events = [];
  for (const m of maps) {
    for (const [type, list] of [['target', m.targets], ['impact', m.impacts]]) {
      for (const p of list) {
        const key = `${type}:${m.name}:${p.x}:${p.y}`;
        seen[key] = sh.active[key] || now;
        if (!sh.active[key]) events.push({ t: now, type, team: p.team, map: m.name, label: m.label, x: p.x, y: p.y });
      }
    }
  }
  sh.active = seen;

  // Samples go into one small file per UTC day, so each commit only touches today's file
  // instead of rewriting an ever-growing one (keeps the git history small).
  const dir = path.join(DATA, shard.id);
  const day = new Date(now).toISOString().slice(0, 10);
  const dayFile = path.join(dir, 'samples', String(war.warNumber), `${day}.json`);
  const daily = await readJson(dayFile, { sampleFields: SAMPLE_FIELDS, samples: [] });
  daily.sampleFields = SAMPLE_FIELDS; // new fields are only ever appended, so older rows stay valid
  daily.samples.push(sample);
  await writeJson(dayFile, daily);

  const warFile = path.join(dir, 'wars', `${war.warNumber}.json`);
  const record = await readJson(warFile, { shard: shard.id, firstSeen: now, sampleCount: 0, days: [], events: [] });
  Object.assign(record, war, { lastSeen: now });
  record.sampleCount += 1;
  if (!record.days.includes(day)) record.days.push(day);
  record.events.push(...events);
  await writeJson(warFile, record);

  await writeJson(path.join(dir, 'latest.json'), {
    shard: shard.id, time: now, war, steamPlayers: steam,
    maps: maps.map((m) => ({
      name: m.name, label: m.label, day: m.day, enlist: m.enlist, cCas: m.cCas, wCas: m.wCas,
      vt: m.vt, scorchedVT: m.scorchedVT, towns: m.towns, sites: m.sites, armed: m.armed,
    })),
  });

  // Index of every war this collector has seen on the shard.
  const indexFile = path.join(dir, 'index.json');
  const index = await readJson(indexFile, { shard: shard.id, wars: [] });
  const count = (type, team) => record.events.filter((e) => e.type === type && e.team === team).length;
  const entry = {
    warNumber: war.warNumber, warId: war.warId, winner: war.winner,
    conquestStartTime: war.conquestStartTime, conquestEndTime: war.conquestEndTime,
    firstSeen: record.firstSeen, lastSeen: now, samples: record.sampleCount,
    colonialCasualties: sample[2], wardenCasualties: sample[3], totalEnlistments: sample[4],
    colonialVictoryTowns: sample[5], wardenVictoryTowns: sample[6],
    requiredVictoryTowns: war.requiredVictoryTowns, scorchedVictoryTowns: sample[7],
    launches: { C: count('target', 'C'), W: count('target', 'W'), N: count('target', 'N') },
    impacts: { C: count('impact', 'C'), W: count('impact', 'W'), N: count('impact', 'N') },
  };
  index.wars = index.wars.filter((w) => w.warId !== war.warId).concat(entry)
    .sort((a, b) => a.warNumber - b.warNumber);
  index.updated = now;
  index.current = war.warNumber;
  await writeJson(indexFile, index);
  return { shard: shard.id, war: war.warNumber, maps: maps.length, events: events.length };
}

// Two triggers can start this collector (an external cron and GitHub's own schedule).
// A run that comes too soon after the previous snapshot exits without touching the API.
const MIN_GAP_MS = Number(process.env.MIN_GAP_MINUTES ?? 10) * 60000;

async function main() {
  const now = Date.now();
  const previous = await readJson(path.join(DATA, 'shards.json'), null);
  if (previous?.updated && now - previous.updated < MIN_GAP_MS) {
    console.log(`Last snapshot was ${Math.round((now - previous.updated) / 60000)} min ago; skipping this run.`);
    return;
  }
  const stateFile = path.join(DATA, 'state.json');
  const state = await readJson(stateFile, {});
  state.etags ||= {}; state.cache ||= {}; state.shards ||= {};

  const steam = await steamPlayers();
  const shardsSeen = [];
  for (const shard of SHARDS) {
    try {
      const r = await collectShard(shard, state, now, steam);
      shardsSeen.push(shard.id);
      console.log(JSON.stringify(r));
    } catch (err) {
      console.warn(`shard ${shard.id} skipped: ${err.message}`);
    }
  }
  await writeJson(stateFile, state);

  const metaFile = path.join(DATA, 'shards.json');
  const meta = await readJson(metaFile, { shards: {} });
  for (const id of shardsSeen) meta.shards[id] = { lastSeen: now };
  meta.updated = now;
  await writeJson(metaFile, meta);
  if (!shardsSeen.length) process.exitCode = 1;
}

main();
