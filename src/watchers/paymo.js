// paymo.js — event-driven focus watcher backed by @paymoapp/active-window (native).
//
// Emits a normalized { app, title, exePath, ts } to the supplied callback whenever the
// foreground window changes. `subscribe` fires with null when no window is focused, which
// we surface as an idle-ish empty change (app '').

function create() {
  let ActiveWindow = null;
  let subId = null;

  return {
    name: 'paymo',

    // Throws if the native module can't load/initialize — caller falls back to polling.
    start(onFocusChange) {
      // Loaded lazily so a missing/mis-rebuilt binary throws here (catchable) rather than
      // at module require time.
      const mod = require('@paymoapp/active-window');
      ActiveWindow = mod.default || mod;
      ActiveWindow.initialize();

      subId = ActiveWindow.subscribe((win) => {
        const now = Date.now();
        if (!win) {
          onFocusChange({ app: '', title: '', exePath: '', ts: now });
          return;
        }
        onFocusChange({
          app: win.application || '',
          title: win.title || '',
          exePath: win.path || '',
          ts: now,
        });
      });
    },

    // Best-effort synchronous read of the current window (used on resume from idle).
    getCurrent() {
      try {
        if (!ActiveWindow) return null;
        const win = ActiveWindow.getActiveWindow();
        if (!win) return null;
        return {
          app: win.application || '',
          title: win.title || '',
          exePath: win.path || '',
          ts: Date.now(),
        };
      } catch (_) {
        return null;
      }
    },

    stop() {
      try {
        if (ActiveWindow && subId != null) ActiveWindow.unsubscribe(subId);
      } catch (_) { /* ignore */ }
      subId = null;
    },
  };
}

module.exports = { create };
