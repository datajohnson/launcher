// trackingConfig.js — defaults + optional user override for the time tracker.
//
// The user can drop a `tracking-config.json` into the app's userData folder to override
// any of these values (deep-merged, top-level keys). Category rules are evaluated
// top-to-bottom, first match wins — so more specific rules (browser + meeting host)
// must come before broader ones (browser default).

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  // A segment is considered "away" once the OS reports this many seconds without input.
  idleThresholdSec: 300,

  // Focus slivers shorter than this are discarded (debounces rapid alt-tabbing).
  minSegmentMs: 5000,

  // Store window titles. Set false for privacy (records app + category only).
  storeTitles: true,

  // Delete segments older than this on startup / daily sweep.
  retentionDays: 365,

  // How often the idle poll runs (ms). Also the max latency for detecting away/return.
  idlePollMs: 15000,

  // How often the pending-write batch is flushed to SQLite (ms).
  flushIntervalMs: 10000,

  defaultCategory: 'Other',

  // First match wins. `appIncludes` matches the lowercased app/exe name; `urlHostIncludes`
  // matches a host parsed from the URL or (best-effort) the window title.
  categoryRules: [
    { match: { appIncludes: ['zoom', 'teams', 'webex', 'meet', 'gotomeeting', 'bluejeans'] }, category: 'Meeting' },
    { match: { appIncludes: ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera'], urlHostIncludes: ['zoom.us', 'teams.microsoft.com', 'teams.live.com', 'meet.google.com', 'webex.com', 'whereby.com'] }, category: 'Meeting' },
    { match: { appIncludes: ['code', 'code - insiders', 'devenv', 'idea', 'pycharm', 'webstorm', 'rider', 'clion', 'goland', 'sublime_text', 'atom', 'notepad++', 'cursor', 'windowsterminal', 'wt', 'powershell', 'pwsh', 'cmd', 'conemu', 'alacritty', 'git-bash', 'mintty', 'docker desktop'] }, category: 'Programming' },
    { match: { appIncludes: ['outlook', 'thunderbird', 'mailspring', 'em client', 'hey'] }, category: 'Email' },
    { match: { appIncludes: ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'safari'] }, category: 'Browsing' },
  ],
};

function deepMergeArraysReplace(base, override) {
  // Shallow top-level merge; arrays and primitives from override replace base.
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    const val = override[key];
    if (val === undefined) continue;
    out[key] = val;
  }
  return out;
}

let cached = null;

function loadConfig(userDataPath) {
  const overridePath = path.join(userDataPath, 'tracking-config.json');
  let config = { ...DEFAULT_CONFIG };
  try {
    if (fs.existsSync(overridePath)) {
      const raw = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
      config = deepMergeArraysReplace(DEFAULT_CONFIG, raw);
    }
  } catch (err) {
    console.error('[tracking] failed to read tracking-config.json, using defaults:', err.message);
  }
  cached = config;
  return config;
}

function getConfig() {
  return cached || { ...DEFAULT_CONFIG };
}

module.exports = { DEFAULT_CONFIG, loadConfig, getConfig };
