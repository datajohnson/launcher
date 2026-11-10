// timeStore.js — pure-JS persistence for time-tracking segments (no native deps).
//
// Backed by an append-only NDJSON log: finalized segments are appended one JSON object
// per line (cheap O(1) writes — the whole point of not using a rewritten JSON blob).
// Rare mutating operations (edit / merge / delete / retention) rewrite the file. All
// data is also held in memory for fast range/rollup queries.
//
// Records use snake_case field names so the rest of the app (written against the earlier
// SQLite schema) needs no changes.

const path = require('path');
const fs = require('fs');

let filePath = null;
let segments = []; // in-memory array of records
let maxId = 0;

function init(userDataPath) {
  filePath = path.join(userDataPath, 'timedata.ndjson');
  segments = [];
  maxId = 0;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const rec = JSON.parse(t);
          segments.push(rec);
          if (rec.id > maxId) maxId = rec.id;
        } catch (_) { /* skip corrupt line */ }
      }
    }
  } catch (err) {
    console.error('[tracking] failed to load timedata.ndjson:', err.message);
  }
  return segments.length;
}

function appendLine(rec) {
  fs.appendFileSync(filePath, JSON.stringify(rec) + '\n', 'utf8');
}

function rewriteAll() {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, segments.map((s) => JSON.stringify(s)).join('\n') + (segments.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, filePath);
}

function toRecord(r, now) {
  return {
    id: ++maxId,
    start_ts: r.startTs,
    end_ts: r.endTs ?? null,
    duration_ms: r.durationMs ?? null,
    active_ms: r.activeMs ?? null,
    app: r.app || '',
    title: r.title ?? null,
    exe_path: r.exePath ?? null,
    doc_path: r.docPath ?? null,
    url: r.url ?? null,
    project_id: r.projectId ?? null,
    category: r.category || 'Other',
    source: r.source || 'auto',
    is_idle: r.isIdle ? 1 : 0,
    match_conf: r.matchConf ?? null,
    edited: r.edited ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
}

function insertSegments(rows) {
  if (!rows || rows.length === 0) return;
  const now = Date.now();
  for (const r of rows) {
    const rec = toRecord(r, now);
    segments.push(rec);
    appendLine(rec);
  }
}

function getSegments(from, to) {
  return segments
    .filter((s) => s.start_ts < to && (s.end_ts == null || s.end_ts > from))
    .sort((a, b) => a.start_ts - b.start_ts);
}

// Rollup by 'project', 'app', or 'category' over [from, to), excluding idle segments.
// Sums active time clipped to the range.
function getRollups(from, to, groupBy) {
  const key = { project: 'project_id', app: 'app', category: 'category' }[groupBy] || 'project_id';
  const totals = new Map();
  for (const s of segments) {
    if (s.is_idle) continue;
    const end = s.end_ts == null ? to : s.end_ts;
    if (s.start_ts >= to || end <= from) continue;
    const ms = Math.min(end, to) - Math.max(s.start_ts, from);
    if (ms <= 0) continue;
    const k = s[key] || null;
    totals.set(k, (totals.get(k) || 0) + ms);
  }
  return Array.from(totals.entries())
    .map(([k, ms]) => ({ key: k, activeMs: ms }))
    .sort((a, b) => b.activeMs - a.activeMs);
}

function findById(id) {
  return segments.find((s) => s.id === id);
}

function updateSegment(id, fields) {
  const s = findById(id);
  if (!s) return false;
  let changed = false;
  if (fields.projectId !== undefined) { s.project_id = fields.projectId; changed = true; }
  if (fields.category !== undefined) { s.category = fields.category; changed = true; }
  if (fields.isIdle !== undefined) { s.is_idle = fields.isIdle ? 1 : 0; changed = true; }
  if (fields.title !== undefined) { s.title = fields.title; changed = true; }
  if (!changed) return false;
  s.edited = 1;
  s.updated_at = Date.now();
  rewriteAll();
  return true;
}

// Apply the same field changes to many segments in one rewrite (used when editing a
// coalesced timeline block that represents several underlying segments).
function updateSegments(ids, fields) {
  const idSet = new Set(ids);
  let changed = false;
  const now = Date.now();
  for (const s of segments) {
    if (!idSet.has(s.id)) continue;
    if (fields.projectId !== undefined) s.project_id = fields.projectId;
    if (fields.category !== undefined) s.category = fields.category;
    if (fields.isIdle !== undefined) s.is_idle = fields.isIdle ? 1 : 0;
    s.edited = 1;
    s.updated_at = now;
    changed = true;
  }
  if (changed) rewriteAll();
  return changed;
}

function deleteSegments(ids) {
  const idSet = new Set(ids);
  const before = segments.length;
  segments = segments.filter((s) => !idSet.has(s.id));
  const removed = before - segments.length;
  if (removed) rewriteAll();
  return removed;
}

function addManualSegment(seg) {
  const now = Date.now();
  const endTs = seg.endTs ?? now;
  const duration = endTs - seg.startTs;
  const rec = toRecord({
    startTs: seg.startTs,
    endTs,
    durationMs: duration,
    activeMs: duration,
    app: seg.app || '(manual)',
    title: seg.title ?? null,
    projectId: seg.projectId ?? null,
    category: seg.category || 'Other',
    source: 'manual',
    isIdle: false,
    edited: true,
  }, now);
  segments.push(rec);
  appendLine(rec);
  return rec.id;
}

function mergeSegments(ids, override = {}) {
  const rows = ids.map(findById).filter(Boolean);
  if (rows.length < 2) return null;
  rows.sort((a, b) => a.start_ts - b.start_ts);
  const startTs = rows[0].start_ts;
  const endTs = Math.max(...rows.map((r) => r.end_ts || r.start_ts));
  const activeMs = rows.reduce((sum, r) => sum + (r.active_ms || r.duration_ms || 0), 0);
  const now = Date.now();
  const merged = toRecord({
    startTs,
    endTs,
    durationMs: endTs - startTs,
    activeMs,
    app: rows[0].app,
    title: rows[0].title,
    exePath: rows[0].exe_path,
    docPath: rows[0].doc_path,
    url: rows[0].url,
    projectId: override.projectId !== undefined ? override.projectId : rows[0].project_id,
    category: override.category !== undefined ? override.category : rows[0].category,
    source: 'manual',
    isIdle: false,
    edited: true,
  }, now);
  const idSet = new Set(ids);
  segments = segments.filter((s) => !idSet.has(s.id));
  segments.push(merged);
  rewriteAll();
  return merged.id;
}

function deleteSegment(id) {
  const before = segments.length;
  segments = segments.filter((s) => s.id !== id);
  if (segments.length !== before) rewriteAll();
}

function deleteOlderThan(cutoffTs) {
  const before = segments.length;
  segments = segments.filter((s) => s.start_ts >= cutoffTs);
  const removed = before - segments.length;
  if (removed) rewriteAll();
  return removed;
}

function deleteAll() {
  segments = [];
  rewriteAll();
}

// Close any segment left open (end_ts null) after a hard crash so it doesn't render huge.
function healOpenSegments(graceMs) {
  const now = Date.now();
  let healed = 0;
  for (const s of segments) {
    if (s.end_ts == null) {
      const endTs = Math.min(now, s.start_ts + graceMs);
      s.end_ts = endTs;
      s.duration_ms = endTs - s.start_ts;
      s.active_ms = s.is_idle ? 0 : s.duration_ms;
      s.updated_at = now;
      healed++;
    }
  }
  if (healed) rewriteAll();
  return healed;
}

function close() {
  // Appends are synchronous; nothing to flush.
}

module.exports = {
  init,
  insertSegments,
  getSegments,
  getRollups,
  updateSegment,
  updateSegments,
  addManualSegment,
  mergeSegments,
  deleteSegment,
  deleteSegments,
  deleteOlderThan,
  deleteAll,
  healOpenSegments,
  close,
};
