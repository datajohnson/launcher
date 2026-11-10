// tracker.js — the main-process time-tracking engine.
//
// Runs a focus watcher + an idle poll, turning the stream of focus changes into
// finalized segments in SQLite. Auto-guesses the project from window activity and
// auto-categorizes each segment. Batches writes and pushes live status to the UI/tray.

const { powerMonitor } = require('electron');
const timeStore = require('./timeStore');
const { loadConfig, getConfig } = require('./trackingConfig');
const { createWatcher } = require('./watchers');

let config = null;
let watcher = null;
let getProjectsFn = () => [];
let onUpdateFn = () => {};
let projectsCache = [];

let current = null; // open segment being built in memory
let pending = []; // finalized segments awaiting flush
let flushTimer = null;
let idleTimer = null;
let paused = false;
let awayState = 'active'; // 'active' | 'idle' | 'locked'
let watcherName = 'none';

// ---------------------------------------------------------------------------
// Project matching
// ---------------------------------------------------------------------------

function normalize(s) {
  return (s || '').toLowerCase();
}

// Derive candidate folder roots from a project's tool paths.
function derivePathRoots(project) {
  if (project.matchHints && Array.isArray(project.matchHints.pathRoots)) return project.matchHints.pathRoots;
  const roots = [];
  for (const tool of project.tools || []) {
    if (tool.path) roots.push(tool.path);
  }
  return roots;
}

// Derive candidate URL hosts from a project's browser tools.
function deriveUrlHosts(project) {
  if (project.matchHints && Array.isArray(project.matchHints.urlHosts)) return project.matchHints.urlHosts;
  const hosts = [];
  for (const tool of project.tools || []) {
    if (tool.url) {
      try { hosts.push(new URL(tool.url).host); } catch (_) { /* skip malformed */ }
    }
  }
  return hosts;
}

function projectId(project) {
  return project.id || project.name;
}

// Best-effort host extraction from a browser window title (browsers often append the
// site name; sometimes a bare host appears). Returns '' if none found.
function hostFromTitle(title) {
  const m = normalize(title).match(/([a-z0-9-]+\.)+[a-z]{2,}/);
  return m ? m[0] : '';
}

// Score a window against every project; return the best { projectId, confidence }.
function matchProject(win, projects) {
  const hay = normalize(`${win.title} ${win.docPath || ''} ${win.exePath || ''}`);
  const host = normalize(win.url ? safeHost(win.url) : hostFromTitle(win.title));
  let best = { projectId: null, confidence: 0 };

  for (const p of projects) {
    let score = 0;
    const roots = derivePathRoots(p);
    for (const r of roots) {
      if (r && hay.includes(normalize(r))) { score = Math.max(score, 0.9); continue; }
      // Also match on the leaf folder name (e.g. "launcher" from c:\dev\launcher).
      const leaf = normalize(r.replace(/[\\/]+$/, '').split(/[\\/]/).pop());
      if (leaf && leaf.length > 2 && hay.includes(leaf)) score = Math.max(score, 0.75);
    }
    const nameTok = normalize(projectId(p));
    if (nameTok && nameTok.length > 2 && hay.includes(nameTok)) score = Math.max(score, 0.7);

    for (const h of deriveUrlHosts(p)) {
      if (h && host && host.includes(normalize(h))) score = Math.max(score, 0.85);
    }
    for (const a of (p.matchHints && p.matchHints.appNames) || []) {
      if (a && normalize(win.app).includes(normalize(a))) score = Math.max(score, 0.8);
    }
    if (score > best.confidence) best = { projectId: projectId(p), confidence: score };
  }

  return best.confidence >= 0.5 ? best : { projectId: null, confidence: best.confidence };
}

function safeHost(url) {
  try { return new URL(url).host; } catch (_) { return ''; }
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

function classifyCategory(win) {
  const app = normalize(win.app);
  const host = normalize(win.url ? safeHost(win.url) : hostFromTitle(win.title));
  for (const rule of config.categoryRules || []) {
    const m = rule.match || {};
    const appOk = !m.appIncludes || m.appIncludes.some((s) => app.includes(normalize(s)));
    const urlOk = !m.urlHostIncludes || m.urlHostIncludes.some((s) => host.includes(normalize(s)));
    if (appOk && urlOk) return rule.category;
  }
  return config.defaultCategory || 'Other';
}

// ---------------------------------------------------------------------------
// Segment state machine
// ---------------------------------------------------------------------------

function sameTarget(a, b) {
  return a && b && a.app === b.app && a.title === b.title;
}

function openSegment(win) {
  const match = matchProject(win, projectsCache);
  current = {
    startTs: win.ts,
    app: win.app,
    title: config.storeTitles ? win.title : null,
    exePath: win.exePath || null,
    docPath: null,
    url: null,
    projectId: match.projectId,
    matchConf: match.confidence,
    category: classifyCategory(win),
    source: 'auto',
    isIdle: false,
  };
}

function openIdleSegment(ts) {
  current = {
    startTs: ts,
    app: '(idle)',
    title: null,
    exePath: null,
    docPath: null,
    url: null,
    projectId: null,
    matchConf: null,
    category: 'Idle',
    source: 'auto',
    isIdle: true,
  };
}

function closeCurrent(endTs) {
  if (!current) return;
  const dur = endTs - current.startTs;
  // Discard sub-threshold work slivers (rapid alt-tabbing). Idle gaps are always kept.
  if (!current.isIdle && dur < (config.minSegmentMs || 0)) {
    current = null;
    return;
  }
  pending.push({
    ...current,
    endTs,
    durationMs: dur,
    activeMs: current.isIdle ? 0 : dur,
  });
  current = null;
  if (pending.length >= 50) flush();
}

function onFocusChange(win) {
  if (paused || awayState !== 'active') return;
  if (!win.app) return; // no focused window; keep the current segment running
  if (sameTarget(current, win)) return;
  closeCurrent(win.ts);
  openSegment(win);
  emitStatus();
}

// ---------------------------------------------------------------------------
// Idle / lock / suspend
// ---------------------------------------------------------------------------

function goIdle(reason) {
  if (awayState !== 'active') return;
  const now = Date.now();
  closeCurrent(now);
  openIdleSegment(now);
  awayState = reason; // 'idle' or 'locked'
  emitStatus();
}

function resumeActive() {
  if (awayState === 'active') return;
  const now = Date.now();
  closeCurrent(now); // close the idle gap
  awayState = 'active';
  // Immediately re-open on the current window if we can read it.
  const win = watcher && watcher.getCurrent();
  if (win && win.app) openSegment({ ...win, ts: now });
  emitStatus();
}

function pollIdle() {
  if (paused) return;
  try {
    const idleState = powerMonitor.getSystemIdleState(config.idleThresholdSec);
    if (idleState === 'idle' || idleState === 'locked') {
      if (awayState === 'active') goIdle(idleState === 'locked' ? 'locked' : 'idle');
    } else if (idleState === 'active') {
      if (awayState === 'idle') resumeActive(); // lock is cleared by the unlock-screen event
    }
  } catch (_) { /* powerMonitor unavailable; ignore */ }
}

// ---------------------------------------------------------------------------
// Persistence + status
// ---------------------------------------------------------------------------

function flush() {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    timeStore.insertSegments(batch);
    for (const seg of batch) onUpdateFn({ type: 'segment-closed', segment: seg });
  } catch (err) {
    console.error('[tracking] flush failed, re-queueing:', err.message);
    pending = batch.concat(pending);
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function todayActiveMs() {
  const from = startOfToday();
  const to = Date.now();
  let total = 0;
  try {
    for (const r of timeStore.getRollups(from, to, 'category')) total += r.activeMs;
  } catch (_) { /* db not ready */ }
  // Add the in-flight open segment if it's productive.
  if (current && !current.isIdle) total += Math.max(0, to - current.startTs);
  return total;
}

function getStatus() {
  return {
    tracking: watcherName !== 'none',
    watcher: watcherName,
    paused,
    away: awayState,
    todayActiveMs: todayActiveMs(),
    current: current
      ? { app: current.app, title: current.title, projectId: current.projectId, category: current.category, startTs: current.startTs, isIdle: current.isIdle }
      : null,
  };
}

function emitStatus() {
  onUpdateFn({ type: 'status', status: getStatus() });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function init({ userDataPath, getProjects, onUpdate }) {
  getProjectsFn = getProjects || (() => []);
  onUpdateFn = onUpdate || (() => {});
  config = loadConfig(userDataPath);
  projectsCache = getProjectsFn();

  timeStore.init(userDataPath);
  timeStore.healOpenSegments(config.minSegmentMs || 5000);
  runRetentionSweep();

  // Power events: close/reopen segments precisely around lock/suspend.
  powerMonitor.on('lock-screen', () => goIdle('locked'));
  powerMonitor.on('suspend', () => goIdle('locked'));
  powerMonitor.on('unlock-screen', () => resumeActive());
  powerMonitor.on('resume', () => resumeActive());

  watcher = createWatcher();
  watcherName = await watcher.start(onFocusChange);

  // Seed the first segment from whatever is focused right now.
  const first = watcher.getCurrent();
  if (first && first.app && awayState === 'active') openSegment({ ...first, ts: Date.now() });

  idleTimer = setInterval(pollIdle, config.idlePollMs || 15000);
  flushTimer = setInterval(flush, config.flushIntervalMs || 10000);
  emitStatus();
}

function runRetentionSweep() {
  try {
    const days = config.retentionDays || 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const removed = timeStore.deleteOlderThan(cutoff);
    if (removed) console.log(`[tracking] retention: removed ${removed} segments older than ${days}d`);
  } catch (err) {
    console.error('[tracking] retention sweep failed:', err.message);
  }
}

function pause() {
  if (paused) return;
  closeCurrent(Date.now());
  paused = true;
  flush();
  emitStatus();
  onUpdateFn({ type: 'paused', paused: true });
}

function resume() {
  if (!paused) return;
  paused = false;
  awayState = 'active';
  const win = watcher && watcher.getCurrent();
  if (win && win.app) openSegment({ ...win, ts: Date.now() });
  emitStatus();
  onUpdateFn({ type: 'paused', paused: false });
}

function reloadProjects() {
  projectsCache = getProjectsFn();
}

function reloadConfig(userDataPath) {
  config = loadConfig(userDataPath);
}

function stop() {
  if (idleTimer) clearInterval(idleTimer);
  if (flushTimer) clearInterval(flushTimer);
  idleTimer = flushTimer = null;
  closeCurrent(Date.now());
  flush();
  if (watcher) watcher.stop();
  watcher = null;
  try { timeStore.close(); } catch (_) { /* ignore */ }
}

module.exports = {
  init,
  stop,
  pause,
  resume,
  getStatus,
  reloadProjects,
  reloadConfig,
  // exported for potential testing
  matchProject,
  classifyCategory,
};
