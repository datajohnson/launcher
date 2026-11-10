// polling.js — fallback focus watcher using `get-windows` polled on an interval.
//
// `get-windows` is ESM-only, so it's loaded via dynamic import(). It is an OPTIONAL
// dependency: if it isn't installed (or fails to load), start() throws and the tracker
// runs without a watcher rather than crashing the app.

const POLL_MS = 3000;

function create() {
  let timer = null;
  let activeWindow = null; // the get-windows function
  let last = null; // last emitted { app, title, exePath }
  let cb = null;

  async function poll() {
    try {
      const win = await activeWindow();
      const now = Date.now();
      const next = win
        ? { app: win.owner?.name || '', title: win.title || '', exePath: win.owner?.path || '', ts: now }
        : { app: '', title: '', exePath: '', ts: now };
      if (!last || last.app !== next.app || last.title !== next.title) {
        last = next;
        if (cb) cb(next);
      }
    } catch (_) { /* transient read failure; try again next tick */ }
  }

  return {
    name: 'polling',

    async start(onFocusChange) {
      cb = onFocusChange;
      const mod = await import('get-windows'); // throws if not installed
      activeWindow = mod.activeWindow || mod.default?.activeWindow || mod.default;
      if (typeof activeWindow !== 'function') throw new Error('get-windows: activeWindow export not found');
      await poll();
      timer = setInterval(poll, POLL_MS);
    },

    getCurrent() {
      return last;
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      cb = null;
    },
  };
}

module.exports = { create };
