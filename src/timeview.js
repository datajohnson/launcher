// timeview.js — renderer logic for the Time Tracking view.
// Wrapped in an IIFE so its `require`/locals don't collide with renderer.js globals.
(function () {
  const { ipcRenderer } = require('electron');

  const CATEGORIES = ['Programming', 'Meeting', 'Browsing', 'Email', 'Other', 'Idle'];
  const CATEGORY_COLORS = {
    Programming: '#00a8e8',
    Meeting: '#e8a000',
    Browsing: '#7b61ff',
    Email: '#00c48c',
    Other: '#8a8a8a',
    Idle: '#3a3a3a',
  };
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Adjacent same-group segments closer than this are merged into one timeline block,
  // so continuous work isn't fragmented by window-title changes / brief blips.
  const MERGE_GAP_MS = 3 * 60 * 1000;

  // ---- state ----
  let range = 'day'; // 'day' | 'week'
  let groupBy = 'project'; // 'project' | 'category'
  let anchor = startOfDay(new Date()); // Date at local midnight of the viewed day
  let projects = [];
  let selectedIds = new Set();
  let editing = null; // { mode:'edit'|'manual', segment? }
  let drilldown = null; // { field, key, label, groups } for the bucket reassign panel
  let savedContentEl = null;
  let refreshTimer = null;

  // ---- elements ----
  const el = (id) => document.getElementById(id);
  const timeView = el('time-view');
  const contentEls = () => [el('empty-state'), el('project-detail'), el('project-form')];

  // ---- helpers ----
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function startOfWeek(d) {
    const x = startOfDay(d);
    const dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
    return x;
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.round((ms || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }
  function fmtClock(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function projectName(id) {
    if (!id) return 'Unassigned';
    const p = projects.find((pp) => (pp.id || pp.name) === id);
    return p ? p.name : id;
  }
  // Deterministic color from a string (project coloring).
  function hashColor(str) {
    if (!str) return '#555';
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 65%, 52%)`;
  }
  function segColor(seg) {
    if (seg.is_idle) return CATEGORY_COLORS.Idle;
    return groupBy === 'category'
      ? (CATEGORY_COLORS[seg.category] || CATEGORY_COLORS.Other)
      : hashColor(seg.project_id || '');
  }
  function rangeBounds() {
    if (range === 'week') {
      const from = startOfWeek(anchor).getTime();
      return { from, to: from + 7 * DAY_MS };
    }
    const from = startOfDay(anchor).getTime();
    return { from, to: from + DAY_MS };
  }
  function dateLabel() {
    const today = startOfDay(new Date()).getTime();
    if (range === 'week') {
      const s = startOfWeek(anchor);
      const e = new Date(s.getTime() + 6 * DAY_MS);
      return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    if (anchor.getTime() === today) return 'Today';
    if (anchor.getTime() === today - DAY_MS) return 'Yesterday';
    return anchor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  // ---- view mode switching ----
  function enterTimeMode() {
    savedContentEl = contentEls().find((e) => e && e.style.display !== 'none') || el('empty-state');
    contentEls().forEach((e) => { if (e) e.style.display = 'none'; });
    timeView.style.display = 'flex';
    el('nav-time-btn').classList.add('active');
    el('nav-projects-btn').classList.remove('active');
    refresh();
  }
  function exitTimeMode(restore) {
    timeView.style.display = 'none';
    el('nav-time-btn').classList.remove('active');
    el('nav-projects-btn').classList.add('active');
    if (restore && savedContentEl) savedContentEl.style.display = savedContentEl === el('empty-state') ? 'flex' : 'block';
  }

  // ---- data + render ----
  async function refresh() {
    if (timeView.style.display === 'none') return;
    projects = await ipcRenderer.invoke('get-projects');
    const { from, to } = rangeBounds();
    const [segments, projRoll, appRoll, status] = await Promise.all([
      ipcRenderer.invoke('get-time-segments', { from, to }),
      ipcRenderer.invoke('get-rollups', { range: { from, to }, groupBy: 'project' }),
      ipcRenderer.invoke('get-rollups', { range: { from, to }, groupBy: 'app' }),
      ipcRenderer.invoke('get-tracker-status'),
    ]);
    el('time-date-label').textContent = dateLabel();
    renderTimeline(segments, from, to);
    renderTotals(projRoll, appRoll);
    renderStatus(status);
  }

  function renderStatus(status) {
    el('time-status-text').textContent = `Today: ${fmtDur(status.todayActiveMs)}`;
    const dot = el('time-status-dot');
    dot.className = 'time-status-dot' + (status.paused ? ' paused' : (status.tracking ? ' active' : ' off'));
    el('time-pause-btn').textContent = status.paused ? 'RESUME' : 'PAUSE';
  }

  // The key a segment groups under depends on the current view (project vs category).
  function groupKey(s) {
    if (s.is_idle) return '__idle__';
    return groupBy === 'category' ? (s.category || 'Other') : (s.project_id || '__unassigned__');
  }

  // Merge adjacent segments sharing a group key (and idle-ness) within [from,to] into
  // display blocks. Each block keeps the ids it spans so edits apply to all of them, and
  // a "rep" (longest constituent) drives the color/label.
  function coalesce(segments, from, to) {
    const clipped = [];
    for (const s of segments) {
      const cs = Math.max(s.start_ts, from);
      const ce = Math.min(s.end_ts || Date.now(), to);
      if (ce > cs) clipped.push({ s, cs, ce });
    }
    clipped.sort((a, b) => a.cs - b.cs);
    const out = [];
    for (const c of clipped) {
      const last = out[out.length - 1];
      if (last
        && groupKey(last.rep) === groupKey(c.s)
        && !!last.rep.is_idle === !!c.s.is_idle
        && (c.cs - last.ce) <= MERGE_GAP_MS) {
        last.ce = Math.max(last.ce, c.ce);
        last.ids.push(c.s.id);
        last.activeMs += c.s.is_idle ? 0 : (c.ce - c.cs);
        const dur = c.ce - c.cs;
        if (dur > last.repDur) { last.rep = c.s; last.repDur = dur; }
      } else {
        out.push({ cs: c.cs, ce: c.ce, ids: [c.s.id], rep: c.s, repDur: c.ce - c.cs, activeMs: c.s.is_idle ? 0 : (c.ce - c.cs) });
      }
    }
    return out;
  }

  const HOUR_MS = 60 * 60 * 1000;

  // Fit the visible window to the day's actual activity (ignoring idle), so a couple of
  // hours of work fill the lane instead of being slivers on a 24h axis. Falls back to a
  // sensible working window when there's no activity, and enforces a minimum span.
  function activeBounds(segments, lo, hi) {
    let min = Infinity, max = -Infinity;
    for (const s of segments) {
      if (s.is_idle) continue;
      const st = Math.max(s.start_ts, lo);
      const en = Math.min(s.end_ts || Date.now(), hi);
      if (en <= st) continue;
      if (st < min) min = st;
      if (en > max) max = en;
    }
    if (!isFinite(min)) return { from: lo + 8 * HOUR_MS, to: Math.min(hi, lo + 18 * HOUR_MS) };
    let from = Math.max(lo, Math.floor((min - 0.5 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    let to = Math.min(hi, Math.ceil((max + 0.5 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    const MIN_SPAN = 3 * HOUR_MS;
    if (to - from < MIN_SPAN) {
      to = Math.min(hi, from + MIN_SPAN);
      from = Math.max(lo, to - MIN_SPAN);
    }
    return { from, to };
  }

  // Choose an hour step that yields ~5–10 labels across the span.
  function tickStepMs(span) {
    for (const s of [1, 2, 3, 4, 6]) if (span / (s * HOUR_MS) <= 10) return s * HOUR_MS;
    return 6 * HOUR_MS;
  }

  function renderHourTicks(hours, from, to) {
    const span = to - from;
    const step = tickStepMs(span);
    const first = Math.ceil(from / step) * step;
    for (let t = first; t <= to + 1; t += step) {
      const pct = ((t - from) / span) * 100;
      if (pct < 0 || pct > 100) continue;
      const tick = document.createElement('div');
      tick.className = 'hour-tick';
      tick.style.left = `${pct}%`;
      tick.textContent = fmtClock(t);
      hours.appendChild(tick);
    }
  }

  function renderTimeline(segments, from, to) {
    const hours = el('time-timeline-hours');
    const track = el('time-timeline');
    hours.innerHTML = '';
    track.innerHTML = '';

    if (range === 'week') {
      renderWeek(segments);
      return;
    }

    const view = activeBounds(segments, from, to);
    renderHourTicks(hours, view.from, view.to);

    const span = view.to - view.from;
    const groups = coalesce(segments, view.from, view.to);
    for (const g of groups) {
      const widthPct = ((g.ce - g.cs) / span) * 100;
      track.appendChild(makeBlock(g, ((g.cs - view.from) / span) * 100, widthPct, false));
    }
    if (groups.length === 0) {
      track.innerHTML = '<div class="timeline-empty">No activity recorded for this day.</div>';
    }
  }

  function renderWeek(segments) {
    const track = el('time-timeline');
    const weekStart = startOfWeek(anchor).getTime();
    const byDay = Array.from({ length: 7 }, () => []);
    for (const seg of segments) {
      const dayIdx = Math.floor((seg.start_ts - weekStart) / DAY_MS);
      if (dayIdx >= 0 && dayIdx < 7) byDay[dayIdx].push(seg);
    }

    // Shared hour-of-day window across the week so all lanes use one x-scale and bars
    // stay wide (offsets are ms from each day's midnight).
    let minOff = Infinity, maxOff = -Infinity;
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStart + d * DAY_MS;
      for (const s of byDay[d]) {
        if (s.is_idle) continue;
        const st = Math.max(s.start_ts, dayStart) - dayStart;
        const en = Math.min(s.end_ts || Date.now(), dayStart + DAY_MS) - dayStart;
        if (en <= st) continue;
        if (st < minOff) minOff = st;
        if (en > maxOff) maxOff = en;
      }
    }
    if (!isFinite(minOff)) { minOff = 8 * HOUR_MS; maxOff = 18 * HOUR_MS; }
    minOff = Math.max(0, Math.floor((minOff - 0.5 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    maxOff = Math.min(DAY_MS, Math.ceil((maxOff + 0.5 * HOUR_MS) / HOUR_MS) * HOUR_MS);
    if (maxOff - minOff < 3 * HOUR_MS) maxOff = Math.min(DAY_MS, minOff + 3 * HOUR_MS);
    const spanOff = maxOff - minOff;

    // Hour header aligned to the lanes (lanes are inset by the label column, so pad the
    // header the same amount via a spacer).
    const hours = el('time-timeline-hours');
    const head = document.createElement('div');
    head.className = 'week-hours-inner';
    for (let t = Math.ceil(minOff / tickStepMs(spanOff)) * tickStepMs(spanOff); t <= maxOff; t += tickStepMs(spanOff)) {
      const pct = ((t - minOff) / spanOff) * 100;
      const tick = document.createElement('div');
      tick.className = 'hour-tick';
      tick.style.left = `${pct}%`;
      tick.textContent = fmtClock(weekStart + t);
      head.appendChild(tick);
    }
    hours.appendChild(head);

    for (let d = 0; d < 7; d++) {
      const dayStart = weekStart + d * DAY_MS;
      const row = document.createElement('div');
      row.className = 'week-row';
      const label = document.createElement('div');
      label.className = 'week-row-label';
      label.textContent = new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      const lane = document.createElement('div');
      lane.className = 'week-lane';
      for (const g of coalesce(byDay[d], dayStart + minOff, dayStart + maxOff)) {
        const widthPct = ((g.ce - g.cs) / spanOff) * 100;
        lane.appendChild(makeBlock(g, ((g.cs - (dayStart + minOff)) / spanOff) * 100, widthPct, true));
      }
      row.appendChild(label);
      row.appendChild(lane);
      track.appendChild(row);
    }
  }

  function makeBlock(group, leftPct, widthPct, compact) {
    const seg = group.rep;
    const isIdle = !!seg.is_idle;
    const selected = group.ids.some((id) => selectedIds.has(id));
    const block = document.createElement('div');
    block.className = 'timeline-block' + (isIdle ? ' idle' : '') + (selected ? ' selected' : '');
    block.style.left = `${leftPct}%`;
    block.style.width = `${Math.max(widthPct, 0.15)}%`;
    block.style.background = segColor(seg);
    const count = group.ids.length;
    const tip = `${seg.app}${seg.title ? ' — ' + seg.title : ''}\n${projectName(seg.project_id)} · ${seg.category}\n${fmtClock(group.cs)}–${fmtClock(group.ce)} (${fmtDur(group.activeMs || (group.ce - group.cs))})${count > 1 ? `\n${count} segments` : ''}`;
    block.title = tip;
    if (!isIdle) {
      block.addEventListener('click', (ev) => {
        if (ev.shiftKey) { toggleSelectGroup(group.ids); return; }
        openEditor(group);
      });
    }
    return block;
  }

  function renderTotals(projRoll, appRoll) {
    renderBars(el('time-totals-project'), 'project', projRoll.map((r) => ({ key: r.key, label: projectName(r.key), color: groupBy === 'category' ? '#00a8e8' : hashColor(r.key || ''), ms: r.activeMs })));
    renderBars(el('time-totals-app'), 'app', appRoll.map((r) => ({ key: r.key, label: r.key || '(unknown)', color: '#00a8e8', ms: r.activeMs })));
  }

  function renderBars(container, field, rows) {
    container.innerHTML = '';
    if (rows.length === 0) { container.innerHTML = '<div class="totals-empty">—</div>'; return; }
    const max = Math.max(...rows.map((r) => r.ms), 1);
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'totals-row clickable';
      item.title = 'Click to view & reassign these entries';
      item.innerHTML = `
        <span class="totals-label">${escapeHtml(r.label)}</span>
        <span class="totals-bar-wrap"><span class="totals-bar" style="width:${(r.ms / max) * 100}%;background:${r.color}"></span></span>
        <span class="totals-value">${fmtDur(r.ms)}</span>`;
      item.addEventListener('click', () => openDrilldown(field, r.key, r.label));
      container.appendChild(item);
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---- selection / merge ----
  function toggleSelectGroup(ids) {
    const allSelected = ids.every((id) => selectedIds.has(id));
    for (const id of ids) { if (allSelected) selectedIds.delete(id); else selectedIds.add(id); }
    updateMergeBtn();
    refresh();
  }
  function updateMergeBtn() {
    let btn = el('time-merge-btn');
    if (selectedIds.size >= 2) {
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'time-merge-btn';
        btn.className = 'btn-primary time-merge-btn';
        btn.addEventListener('click', doMerge);
        el('time-timeline-wrap').appendChild(btn);
      }
      btn.textContent = `MERGE ${selectedIds.size}`;
      btn.style.display = 'block';
    } else if (btn) {
      btn.style.display = 'none';
    }
  }
  async function doMerge() {
    const ids = Array.from(selectedIds);
    await ipcRenderer.invoke('merge-segments', { ids, override: {} });
    selectedIds.clear();
    updateMergeBtn();
    refresh();
  }

  // ---- editor ----
  function populateSelects(seg) {
    const projSel = el('seg-editor-project');
    projSel.innerHTML = '<option value="">Unassigned</option>' +
      projects.map((p) => `<option value="${escapeHtml(p.id || p.name)}">${escapeHtml(p.name)}</option>`).join('');
    projSel.value = seg && seg.project_id ? seg.project_id : '';
    const cats = Array.from(new Set([...CATEGORIES, seg && seg.category].filter(Boolean)));
    const catSel = el('seg-editor-category');
    catSel.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join('');
    catSel.value = seg ? seg.category : 'Other';
  }
  function toLocalInput(ts) {
    const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function openEditor(group) {
    const seg = group.rep;
    editing = { mode: 'edit', ids: group.ids.slice() };
    el('seg-editor-title').textContent = 'EDIT ENTRY';
    el('seg-editor-times').style.display = 'none';
    el('seg-editor-delete').style.display = 'block';
    const count = group.ids.length;
    const appLine = `${seg.app}${seg.title ? ' — ' + seg.title : ''}`;
    const timeLine = `${fmtClock(group.cs)}–${fmtClock(group.ce)} · ${fmtDur(group.activeMs || (group.ce - group.cs))}${count > 1 ? ` · ${count} segments` : ''}`;
    el('seg-editor-meta').innerHTML = `<span class="seg-editor-app">${escapeHtml(appLine)}</span><span class="seg-editor-time">${escapeHtml(timeLine)}</span>`;
    populateSelects(seg);
    el('seg-editor').style.display = 'flex';
  }
  function openManual() {
    editing = { mode: 'manual' };
    el('seg-editor-title').textContent = 'ADD ENTRY';
    el('seg-editor-times').style.display = 'flex';
    el('seg-editor-delete').style.display = 'none';
    el('seg-editor-meta').textContent = 'Manual time entry';
    const now = Date.now();
    el('seg-editor-start').value = toLocalInput(now - 30 * 60 * 1000);
    el('seg-editor-end').value = toLocalInput(now);
    populateSelects(null);
    el('seg-editor').style.display = 'flex';
  }
  function closeEditor() {
    el('seg-editor').style.display = 'none';
    editing = null;
  }
  async function saveEditor() {
    const projectId = el('seg-editor-project').value || null;
    const category = el('seg-editor-category').value;
    if (editing.mode === 'manual') {
      const startTs = new Date(el('seg-editor-start').value).getTime();
      const endTs = new Date(el('seg-editor-end').value).getTime();
      if (!(endTs > startTs)) { alert('End time must be after start time.'); return; }
      await ipcRenderer.invoke('add-manual-segment', { startTs, endTs, projectId, category });
    } else {
      await ipcRenderer.invoke('update-segments', { ids: editing.ids, fields: { projectId, category } });
    }
    closeEditor();
    refresh();
  }
  async function deleteEditor() {
    if (editing.mode === 'edit') await ipcRenderer.invoke('delete-segments', editing.ids);
    closeEditor();
    refresh();
  }

  // ---- bucket drill-down (view + reassign everything in a project/app) ----
  function projectOptionsHtml(includeKeep) {
    let html = includeKeep ? '<option value="__keep__">— keep —</option>' : '';
    html += '<option value="">Unassigned</option>';
    html += projects.map((p) => `<option value="${escapeHtml(p.id || p.name)}">${escapeHtml(p.name)}</option>`).join('');
    return html;
  }
  function categoryOptionsHtml(includeKeep, extra) {
    const cats = Array.from(new Set([...CATEGORIES, extra].filter(Boolean)));
    let html = includeKeep ? '<option value="__keep__">— keep —</option>' : '';
    html += cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    return html;
  }

  // Fetch the current range's segments for one bucket and group them by app+project+category
  // so each row is a meaningful chunk you can reassign.
  async function openDrilldown(field, key, label) {
    projects = await ipcRenderer.invoke('get-projects');
    const { from, to } = rangeBounds();
    const segs = await ipcRenderer.invoke('get-time-segments', { from, to });
    const k = key || null;
    const filtered = segs.filter((s) => !s.is_idle && (field === 'project' ? (s.project_id || null) === k : s.app === key));
    const map = new Map();
    for (const s of filtered) {
      const gk = `${s.app}||${s.project_id || ''}||${s.category}`;
      let g = map.get(gk);
      if (!g) { g = { ids: [], app: s.app, title: s.title, project_id: s.project_id || null, category: s.category, activeMs: 0, count: 0 }; map.set(gk, g); }
      g.ids.push(s.id);
      g.activeMs += (s.active_ms != null ? s.active_ms : (s.duration_ms || 0));
      g.count += 1;
      if (!g.title && s.title) g.title = s.title;
    }
    drilldown = { field, key: k, label, groups: Array.from(map.values()).sort((a, b) => b.activeMs - a.activeMs) };
    renderDrilldown();
    el('drilldown').style.display = 'flex';
  }

  function renderDrilldown() {
    const totalMs = drilldown.groups.reduce((s, g) => s + g.activeMs, 0);
    el('drilldown-title').textContent = `${drilldown.label || drilldown.key || 'Unassigned'} · ${fmtDur(totalMs)}`;
    const bp = el('drilldown-bulk-project');
    bp.innerHTML = projectOptionsHtml(true); bp.value = '__keep__';
    const bc = el('drilldown-bulk-category');
    bc.innerHTML = categoryOptionsHtml(true); bc.value = '__keep__';

    const list = el('drilldown-list');
    list.innerHTML = '';
    if (drilldown.groups.length === 0) { list.innerHTML = '<div class="totals-empty">No entries.</div>'; return; }
    for (const g of drilldown.groups) {
      const row = document.createElement('div');
      row.className = 'drill-row';
      const main = document.createElement('div');
      main.className = 'drill-row-main';
      main.innerHTML = `<span class="drill-row-app">${escapeHtml(g.app)}</span><span class="drill-row-title">${escapeHtml(g.title || '')}</span>`;
      const time = document.createElement('span');
      time.className = 'drill-row-time';
      time.textContent = `${fmtDur(g.activeMs)}${g.count > 1 ? ` · ${g.count}` : ''}`;
      const proj = document.createElement('select');
      proj.className = 'drill-row-select';
      proj.innerHTML = projectOptionsHtml(false);
      proj.value = g.project_id || '';
      proj.addEventListener('change', () => applyRow(g, { projectId: proj.value || null }));
      const cat = document.createElement('select');
      cat.className = 'drill-row-select';
      cat.innerHTML = categoryOptionsHtml(false, g.category);
      cat.value = g.category;
      cat.addEventListener('change', () => applyRow(g, { category: cat.value }));
      const del = document.createElement('button');
      del.className = 'btn-icon drill-row-del';
      del.textContent = '×';
      del.title = 'Delete these entries';
      del.addEventListener('click', () => applyDelete(g));
      row.appendChild(main); row.appendChild(time); row.appendChild(proj); row.appendChild(cat); row.appendChild(del);
      list.appendChild(row);
    }
  }

  async function applyRow(g, fields) {
    await ipcRenderer.invoke('update-segments', { ids: g.ids, fields });
    refresh();
    await reopenDrilldown();
  }
  async function applyDelete(g) {
    await ipcRenderer.invoke('delete-segments', g.ids);
    refresh();
    await reopenDrilldown();
  }
  async function applyBulk() {
    const p = el('drilldown-bulk-project').value;
    const c = el('drilldown-bulk-category').value;
    const fields = {};
    if (p !== '__keep__') fields.projectId = p || null;
    if (c !== '__keep__') fields.category = c;
    if (Object.keys(fields).length === 0) { closeDrilldown(); return; }
    const ids = drilldown.groups.flatMap((g) => g.ids);
    await ipcRenderer.invoke('update-segments', { ids, fields });
    refresh();
    await reopenDrilldown();
  }
  async function reopenDrilldown() {
    if (!drilldown) return;
    const { field, key, label } = drilldown;
    await openDrilldown(field, key, label);
    // If the bucket is now empty (e.g. all Unassigned moved into a project), close it.
    if (drilldown.groups.length === 0) closeDrilldown();
  }
  function closeDrilldown() {
    el('drilldown').style.display = 'none';
    drilldown = null;
  }

  // ---- wiring ----
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, 800);
  }

  function init() {
    el('nav-time-btn').addEventListener('click', enterTimeMode);
    el('nav-projects-btn').addEventListener('click', () => exitTimeMode(true));
    // Switching to any project action leaves time mode (renderer shows the project view).
    el('add-project-btn').addEventListener('click', () => exitTimeMode(false));
    el('projects-list').addEventListener('click', () => exitTimeMode(false));

    el('time-prev-btn').addEventListener('click', () => { anchor = new Date(anchor.getTime() - (range === 'week' ? 7 : 1) * DAY_MS); refresh(); });
    el('time-next-btn').addEventListener('click', () => { anchor = new Date(anchor.getTime() + (range === 'week' ? 7 : 1) * DAY_MS); refresh(); });
    el('time-today-btn').addEventListener('click', () => { anchor = startOfDay(new Date()); refresh(); });

    el('time-range-toggle').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-range]'); if (!b) return;
      range = b.dataset.range;
      el('time-range-toggle').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      el('time-timeline').classList.toggle('week-mode', range === 'week');
      refresh();
    });
    el('time-group-toggle').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-group]'); if (!b) return;
      groupBy = b.dataset.group;
      el('time-group-toggle').querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      refresh();
    });

    el('time-pause-btn').addEventListener('click', async () => {
      const status = await ipcRenderer.invoke('get-tracker-status');
      await ipcRenderer.invoke('set-tracking-paused', !status.paused);
      refresh();
    });
    el('time-add-btn').addEventListener('click', openManual);
    el('time-clear-btn').addEventListener('click', async () => {
      if (confirm('Delete ALL recorded time data? This cannot be undone.')) {
        await ipcRenderer.invoke('clear-time-data');
        refresh();
      }
    });

    el('seg-editor-close').addEventListener('click', closeEditor);
    el('seg-editor-cancel').addEventListener('click', closeEditor);
    el('seg-editor-save').addEventListener('click', saveEditor);
    el('seg-editor-delete').addEventListener('click', deleteEditor);

    el('drilldown-close').addEventListener('click', closeDrilldown);
    el('drilldown-bulk-apply').addEventListener('click', applyBulk);
    // Click the dimmed backdrop (not the panel) to dismiss.
    el('drilldown').addEventListener('click', (ev) => { if (ev.target === el('drilldown')) closeDrilldown(); });

    // Live updates from the tracker.
    ipcRenderer.on('tracker-update', (_e, evt) => {
      if (timeView.style.display === 'none') return;
      if (evt && evt.status) renderStatus(evt.status);
      if (evt && (evt.type === 'segment-closed' || evt.type === 'paused')) scheduleRefresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
