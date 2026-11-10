// watchers/index.js — picks a focus watcher: prefer the native event-driven paymo
// watcher, fall back to polling (get-windows), fall back to a no-op so the app still
// runs even if no watcher is available.

const paymo = require('./paymo');
const polling = require('./polling');

function createNoop() {
  return {
    name: 'none',
    async start() { /* nothing */ },
    getCurrent() { return null; },
    stop() { /* nothing */ },
  };
}

// Returns a watcher whose start() is async and resolves once a backend is active.
// The active backend's name is available as `.name` after start() resolves.
function createWatcher() {
  let active = null;

  return {
    get name() { return active ? active.name : 'none'; },

    async start(onFocusChange) {
      // 1. Native, event-driven.
      try {
        const w = paymo.create();
        w.start(onFocusChange); // synchronous; throws if native module unusable
        active = w;
        console.log('[tracking] watcher: paymo (native, event-driven)');
        return active.name;
      } catch (err) {
        console.warn('[tracking] paymo watcher unavailable, trying polling fallback:', err.message);
      }

      // 2. Polling fallback.
      try {
        const w = polling.create();
        await w.start(onFocusChange); // throws if get-windows not installed
        active = w;
        console.log('[tracking] watcher: polling (get-windows)');
        return active.name;
      } catch (err) {
        console.warn('[tracking] polling watcher unavailable:', err.message);
      }

      // 3. No-op — tracking is inert but the app runs.
      active = createNoop();
      console.warn('[tracking] no focus watcher available; time tracking disabled');
      return active.name;
    },

    getCurrent() {
      return active ? active.getCurrent() : null;
    },

    stop() {
      if (active) active.stop();
      active = null;
    },
  };
}

module.exports = { createWatcher };
