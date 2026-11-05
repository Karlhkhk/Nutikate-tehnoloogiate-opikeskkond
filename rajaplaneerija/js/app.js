'use strict';
/* Droonirajaplaneerija: raja koostamine lohistades, lennutrajektoor, 2,5D-vaade ja eksport. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const rad = d => d * Math.PI / 180;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n, d = 2) => { const s = (+n.toFixed(d)).toString(); return LANG === 'en' ? s : s.replace('.', ','); };
  const themeColors = { light: Object.create(null), dark: Object.create(null) };
  const themeColor = name => {
    const colors = themeColors[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];
    if (!(name in colors)) colors[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return colors[name];
  };
  const money = n => '$' + n.toFixed(2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const len3 = a => Math.hypot(a[0], a[1], a[2]);
  const dist = (a, b) => len3(sub(a, b));

  const DRONES = {
    codrone: { name: 'CoDrone EDU', speed: 0.5, minGap: 0.4, takeoffZ: 0.8, code: true },
    neo2: { name: 'DJI Neo 2', speed: 2.0, minGap: 0.6, takeoffZ: 1.2, code: false },
  };
  const STORE = 'droonirajaplaneerija.v1';
  const LIB = 'droonirajaplaneerija.rajad';
  const THEME_KEY = 'droonirajaplaneerija.teema';
  const PATH_COLOR = '#7c3aed';

  const canvas = $('#scene'), ctx = canvas.getContext('2d');
  const prof = $('#profile'), pctx = prof.getContext('2d');
  const panelBody = $('#panelBody');

  let state = null;
  const ui = { mode: 'build', sel: null, wp: null, tab: 'props' };
  const view = { yaw: -32, pitch: 36, scale: 40, panX: 0, panY: 0 };
  const anim = { playing: false, s: 0, mult: 4, last: 0 };
  let flight = null, issues = [], hits = [], badges = [];
  let W = 0, H = 0, PW = 0, PH = 0, dpr = 1;
  let undoS = [], redoS = [], editing = false;

  const simUi = {
    root: $('#simOverlay'), pause: $('#simPause'), status: $('#simStatus'), time: $('#simTime'), speed: $('#simSpeed'),
    alt: $('#simAltitude'), distance: $('#simDistance'), heading: $('#simHeading'), points: $('#simPoints'), next: $('#simNext'),
    settingsOpen: $('#simSettingsOpen'), settings: $('#simSettings'), settingsClose: $('#simSettingsClose'),
    menu: $('#simMenu'), menuSummary: $('#simMenuSummary'), keyboardBindings: $('#simKeyboardBindings'),
    keyboardBindingStatus: $('#simKeyboardBindingStatus'), keyboardReset: $('#simKeyboardReset'),
    settingsClosed: () => { simUi.menu.open = true; simUi.menuSummary.focus(); },
    controllerState: $('#simControllerState'), controllerSelect: $('#simControllerSelect'), controllerRescan: $('#simControllerRescan'),
    coDroneConnect: $('#simCoDroneConnect'),
    controllerCalibrate: $('#simControllerCalibrate'),
    controllerCounts: $('#simControllerCounts'), radioSettings: $('#simRadioSettings'), keyboardHelp: $('#simKeyboardHelp'),
    liveRows: $('#simLiveRows'), stickVisual: $('#simStickVisual'), stickLeft: $('#simStickLeft'), stickRight: $('#simStickRight'), stickDevice: $('#simStickDevice'),
    deadzone: $('#simDeadzone'), deadzoneValue: $('#simDeadzoneValue'), axisSettings: $('#simAxisSettings'),
    controlHint: $('#simControlHint'),
  };
  const simulator = new FlightSimulator($('#simCanvas'), $('#simMap'), simUi, simulationScene, simulationLabels, () => {});

  function simulationLabels() {
    return {
      pause: tr('sim.pause'), resume: tr('sim.resume'), paused: tr('sim.paused'), ready: tr('sim.ready'),
      flying: tr('sim.flying'), complete: tr('sim.complete'),
      controllerNone: tr('sim.controller.none'), controllerConnected: tr('sim.controller.connected'),
      controllerUnsupported: tr('sim.controller.unsupported'), controllerDevice: tr('sim.controller.deviceOption'),
      controllerAxes: tr('sim.controller.axes'), controllerButtons: tr('sim.controller.buttons'),
      controllerSelectedAxes: tr('sim.controller.selectedAxes'), controllerSelectedButtons: tr('sim.controller.selectedButtons'),
      codroneName: tr('sim.codrone.name'), codroneConnect: tr('sim.codrone.connect'), codroneDisconnect: tr('sim.codrone.disconnect'),
      codroneUnsupported: tr('sim.codrone.unsupported'), codroneConnected: tr('sim.codrone.connected'), codroneWaiting: tr('sim.codrone.waiting'),
      codroneNoData: tr('sim.codrone.noData'), codroneAxes: tr('sim.codrone.axes'), codroneError: tr('sim.codrone.error'),
      controllerCalibrate: tr('sim.controller.calibrate'), controllerCenter: tr('sim.controller.calibrateCenter'), controllerRelease: tr('sim.controller.calibrateRelease'),
      controllerMoveThrottle: tr('sim.controller.calibrateThrottle'), controllerMoveRoll: tr('sim.controller.calibrateRoll'),
      controllerMovePitch: tr('sim.controller.calibratePitch'), controllerMoveYaw: tr('sim.controller.calibrateYaw'),
      controllerCalibrationDone: tr('sim.controller.calibrationDone'), controllerCalibrationFailed: tr('sim.controller.calibrationFailed'),
      keyboardForward: tr('sim.keyboard.forward'), keyboardBackward: tr('sim.keyboard.backward'),
      keyboardLeft: tr('sim.keyboard.left'), keyboardRight: tr('sim.keyboard.right'),
      keyboardYawLeft: tr('sim.keyboard.yawLeft'), keyboardYawRight: tr('sim.keyboard.yawRight'),
      keyboardAscend: tr('sim.keyboard.ascend'), keyboardDescend: tr('sim.keyboard.descend'), keyboardBoost: tr('sim.keyboard.boost'),
      keyboardChange: tr('sim.keyboard.change'), keyboardPressKey: tr('sim.keyboard.pressKey'),
      keyboardKeyInUse: tr('sim.keyboard.keyInUse'), keyboardKeyUnavailable: tr('sim.keyboard.keyUnavailable'), keyboardCaptureCancelled: tr('sim.keyboard.captureCancelled'),
      keyboardResetDone: tr('sim.keyboard.resetDone'), keyboardHelp: tr('sim.keyboard.help'),
      keyboardKeyShift: tr('sim.keyboard.keyShift'), keyboardKeyArrowUp: tr('sim.keyboard.keyArrowUp'),
      keyboardKeyArrowDown: tr('sim.keyboard.keyArrowDown'), keyboardKeyArrowLeft: tr('sim.keyboard.keyArrowLeft'),
      keyboardKeyArrowRight: tr('sim.keyboard.keyArrowRight'), keyboardKeySpace: tr('sim.keyboard.keySpace'),
      channelThrottle: tr('sim.channel.throttle'), channelRoll: tr('sim.channel.roll'), channelPitch: tr('sim.channel.pitch'), channelYaw: tr('sim.channel.yaw'),
      settingsControllerHint: tr('sim.settings.controllerHint'), settingsNoAxes: tr('sim.settings.noAxes'),
      controlsHint: tr('sim.controls'), invertLabel: tr('sim.controller.invert'),
    };
  }
  function simulationScene() {
    const route = [], seen = new Set();
    for (const q of flight.marks) {
      const m = q.mark;
      if (seen.has(m.wp)) continue;
      seen.add(m.wp);
      const before = sampleAt(Math.max(0, q.s - 0.15)).p, after = sampleAt(Math.min(flight.length, q.s + 0.15)).p;
      route.push({
        kind: m.kind, position: q.p.slice(), opening: m.o || null,
        direction: sub(after, before), label: wpLabel(state.path[m.wp], m.wp),
      });
    }
    if (route.length && route[route.length - 1].kind !== 'pad') {
      const end = flight.pts[flight.pts.length - 1]?.p;
      if (end) route.push({ kind: 'pad', position: end.slice(), opening: null, direction: [0, 0, 0], label: tr('act.land') });
    }
    return {
      hall: { ...state.hall }, drone: state.drone, elements: state.elements.map(worldPrims),
      path: flight.pts.map(q => q.p), route, start: flight.pts[0]?.p.slice() || [state.hall.w / 2, state.hall.l / 2, 0.15],
    };
  }
  function startSimulation() {
    if (!flight || flight.length < 0.01) { alert(tr('chk.nopath')); return; }
    if (anim.playing) setPlaying(false);
    simulator.start();
  }

  // ---------- olek ----------
  function defaultState() {
    return { name: tr('track.new'), hall: { w: 20, l: 12, h: 5, grid: 0.5 }, drone: 'codrone', cruise: 1.0, elements: [], path: [] };
  }
  function byId(id) { return state.elements.find(e => e.id === id); }
  function T(el) { return TYPES[el.type]; }
  function V(el) { return T(el).variants[el.v] || T(el).variants[0]; }
  function elZ(el) { return el.z != null ? el.z : V(el).z; }
  // Inglise keeles on elemendi nimi kataloogi nimi (või nameEn, kui kataloogi nimi on tootekood)
  const TYPE_NAMES_FI = {
    'Blade flag': 'Lippu', 'Landing pad': 'Laskeutumisalusta', 'Circular ring': 'Rengas',
    'Stacked loop': 'Päällekkäiset renkaat', 'Tri-gates': 'Kolmoisrenkaat',
    'Horizontal round gate': 'Vaakasuora rengasportti', 'Horizontal gates': 'Vaakaportit',
    'Arch gate': 'Kaariportti', 'Square gate': 'Neliöportti', 'Offset gate': 'Korkeusportti',
    'Gravity gate': 'Painovoimaportti', 'Cube gate': 'Kuutiportti', 'Tunnel': 'Tunneli',
    'Ground tunnel': 'Maatunneli', 'Shaft': 'Kuilu', 'Net tunnel': 'Verkkotunneli',
  };
  const GROUPS_FI = { Märgid: 'Merkit', Rõngad: 'Renkaat', Väravad: 'Portit', Tunnelid: 'Tunnelit' };
  const typeName = t => LANG === 'en' ? t.nameEn || t.en : LANG === 'fi' ? TYPE_NAMES_FI[t.nameEn || t.en] || t.en : t.name;
  const groupName = g => LANG === 'en' ? GROUPS_EN[g] || g : LANG === 'fi' ? GROUPS_FI[g] || g : g;

  function wpDefaults(kind) {
    if (kind === 'pylon') return { side: 'left', turn: 'pass', hover: 0 };
    if (kind === 'gate') return { opening: 0, dir: 'auto', hover: 0 };
    return { hover: 0 };
  }

  function checkpoint() { undoS.push(JSON.stringify(state)); if (undoS.length > 150) undoS.shift(); redoS = []; }
  function beginEdit() { if (!editing) { checkpoint(); editing = true; } }
  function endEdit() { editing = false; }
  function undo() { if (!undoS.length) return; redoS.push(JSON.stringify(state)); state = JSON.parse(undoS.pop()); afterLoad(); }
  function redo() { if (!redoS.length) return; undoS.push(JSON.stringify(state)); state = JSON.parse(redoS.pop()); afterLoad(); }

  function updateSimRouteCurrent() {
    const current = $('#simRouteCurrent');
    if (current && state) current.textContent = state.name || tr('track.untitled');
  }

  function updateSimDroneCurrent() {
    if (!state) return;
    const drone = DRONES[state.drone] || DRONES.codrone;
    const current = $('#simDroneCurrent');
    const select = $('#simDroneSelect');
    if (current) current.textContent = drone.name;
    if (select) select.value = state.drone;
  }

  function afterLoad() {
    if (ui.sel && !byId(ui.sel)) ui.sel = null;
    if (ui.wp != null && ui.wp >= state.path.length) ui.wp = null;
    $('#trackName').value = state.name;
    updateSimRouteCurrent();
    updateSimDroneCurrent();
    anim.s = Math.min(anim.s, 0);
    invalidate();
    renderPanel();
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* salvestus pole saadaval */ } }, 300);
  }

  function loadTemplate(t) {
    const ids = t.items.map(() => uid());
    const s = defaultState();
    s.name = t.name;
    s.hall = Object.assign(s.hall, t.hall);
    s.drone = state ? state.drone : s.drone;
    s.elements = t.items.map(([type, v, x, y, rot], i) => ({ id: ids[i], type, v, x, y, rot: rot || 0 }));
    s.path = t.path.map(([i, o]) => Object.assign({ id: uid(), el: ids[i] }, wpDefaults(TYPES[t.items[i][0]].kind), o || {}));
    state = s;
  }

  // ---------- geomeetria maailmas ----------
  function xf(el, p) {
    const r = rad(el.rot), c = Math.cos(r), s = Math.sin(r);
    return [el.x + p[0] * c - p[1] * s, el.y + p[0] * s + p[1] * c, p[2]];
  }
  function xd(el, d) {
    const r = rad(el.rot), c = Math.cos(r), s = Math.sin(r);
    return [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]];
  }
  function worldPrims(el) {
    return T(el).geom(V(el), elZ(el)).map(p => p.k === 'l'
      ? { k: 'l', a: xf(el, p.a), b: xf(el, p.b), c: p.c, w: p.w }
      : { k: 'p', pts: p.pts.map(q => xf(el, q)), f: p.f, s: p.s });
  }
  function openings(el) { return T(el).openings(V(el), elZ(el)).map(o => Object.assign({}, o, { c: xf(el, o.c), dir: xd(el, o.dir) })); }
  function footprint(el, shrink) {
    const [hx, hy] = T(el).fp(V(el)), k = shrink || 0;
    return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => xf(el, [x - Math.sign(x) * k, y - Math.sign(y) * k, 0]));
  }
  function topZ(el) {
    let z = 0;
    for (const p of T(el).geom(V(el), elZ(el))) for (const q of p.k === 'l' ? [p.a, p.b] : p.pts) z = Math.max(z, q[2]);
    return z;
  }
  function snap(v, free) { const g = state.hall.grid; return free || !g ? Math.round(v * 100) / 100 : Math.round(v / g) * g; }

  // ---------- projektsioon (2,5D) ----------
  function proj(p) {
    const x = p[0] - state.hall.w / 2, y = p[1] - state.hall.l / 2;
    const c = Math.cos(rad(view.yaw)), s = Math.sin(rad(view.yaw));
    const xr = x * c - y * s, yr = x * s + y * c;
    const sp = Math.sin(rad(view.pitch)), cp = Math.cos(rad(view.pitch));
    return [W / 2 + view.panX + xr * view.scale, H / 2 + view.panY - (yr * sp + p[2] * cp) * view.scale, -yr * cp + p[2] * sp];
  }
  function ground(sx, sy) {
    const xr = (sx - W / 2 - view.panX) / view.scale;
    const yr = -(sy - H / 2 - view.panY) / (view.scale * Math.sin(rad(view.pitch)));
    const c = Math.cos(rad(view.yaw)), s = Math.sin(rad(view.yaw));
    return [xr * c + yr * s + state.hall.w / 2, -xr * s + yr * c + state.hall.l / 2];
  }
  function fitView() {
    const { w, l } = state.hall;
    const keep = { scale: view.scale, panX: view.panX, panY: view.panY };
    view.scale = 1; view.panX = 0; view.panY = 0;
    const pts = [];
    for (const z of [0, 2.2]) for (const [x, y] of [[0, 0], [w, 0], [w, l], [0, l]]) pts.push(proj([x, y, z]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    if (!W || !H || !bw) { Object.assign(view, keep); return; }
    const k = Math.min((W - 60) / bw, (H - 70) / bh);
    view.scale = k;
    view.panX = -((Math.max(...xs) + Math.min(...xs)) / 2 - W / 2) * k;
    view.panY = -((Math.max(...ys) + Math.min(...ys)) / 2 - H / 2) * k + 8;
  }

  // ---------- lennutrajektoor ----------
  function wpLabel(wp, i) {
    if (!wp.el) return `${i + 1}. ${tr('wp.free')}`;
    const el = byId(wp.el);
    if (!el) return `${i + 1}. ?`;
    const t = T(el), os = t.kind === 'gate' ? t.openings(V(el), elZ(el)) : [];
    return `${i + 1}. ${typeName(t)}${os.length > 1 ? ' – ' + loc(os[Math.min(wp.opening || 0, os.length - 1)], 'name').toLowerCase() : ''}`;
  }
  function wpAction(wp, i, n) {
    if (!wp.el) return tr('act.fly');
    const el = byId(wp.el);
    if (!el) return '';
    const k = T(el).kind;
    if (k === 'pad') return tr(i === 0 ? 'act.takeoff' : i === n - 1 ? 'act.land' : 'act.touch');
    if (k === 'pylon') return tr('act.pylon', { turn: tr('turn.' + (wp.turn || 'pass')), side: tr('side.' + (wp.side || 'left')) });
    return tr('act.gate') + (wp.dir === 'rev' ? tr('act.rev') : '');
  }

  function computePath() {
    const wps = state.path.filter(wp => !wp.el || byId(wp.el));
    const cruise = state.cruise, ctrl = [], ops = [], n = wps.length;
    const push = (p, wp, mark) => ctrl.push({ p, wp, mark: mark || null });
    const last = () => ctrl.length ? ctrl[ctrl.length - 1].p : null;
    const anchorOf = wp => {
      if (!wp) return null;
      if (!wp.el) return [wp.x, wp.y, wp.z];
      const el = byId(wp.el);
      return [el.x, el.y, cruise];
    };

    wps.forEach((wp, i) => {
      const idx = state.path.indexOf(wp), label = wpLabel(wp, idx), act = wpAction(wp, i, n);
      const move = p => ops.push({ op: 'move', p, wp: idx, label, act });
      if (!wp.el) {
        const p = [wp.x, wp.y, wp.z];
        if (i === 0) { push([p[0], p[1], 0], idx); ops.push({ op: 'takeoff', p, wp: idx, label, act: tr('act.takeoff') }); }
        push(p, idx, { wp: idx, kind: 'free', anchor: p });
        move(p);
      } else {
        const el = byId(wp.el), t = T(el);
        if (t.kind === 'pad') {
          const g = [el.x, el.y, 0], up = [el.x, el.y, cruise], mark = { wp: idx, kind: 'pad', anchor: g };
          if (i === 0) {
            push(g, idx, mark); push(up, idx);
            ops.push({ op: 'takeoff', p: g, wp: idx, label, act }); move(up);
          } else if (i === n - 1) {
            push(up, idx); push(g, idx, mark);
            move(up); ops.push({ op: 'land', wp: idx, label, act });
          } else {
            push(up, idx); push(g, idx, mark); push(up, idx);
            move(up); ops.push({ op: 'land', wp: idx, label, act });
            ops.push({ op: 'wait', t: Math.max(2, wp.hover || 0), wp: idx, label, act: tr('act.wait') });
            ops.push({ op: 'takeoff', p: g, wp: idx, label, act }); move(up);
          }
        } else if (t.kind === 'pylon') {
          const h = wp.z != null ? wp.z : cruise, R = wp.r || 0.7, F = [el.x, el.y];
          const P = last() || anchorOf(wps[i + 1]) || [el.x - 1, el.y, h];
          const a = Math.atan2(P[1] - F[1], P[0] - F[0]), s = wp.side === 'right' ? -1 : 1;
          const end = { pass: 135, uturn: 315, circle: 405 }[wp.turn || 'pass'];
          const steps = Math.ceil((end - 45) / 30), mid = Math.round(steps / 2);
          if (i === 0) {
            const p0 = [F[0] + Math.cos(a + s * rad(45)) * R, F[1] + Math.sin(a + s * rad(45)) * R, 0];
            push(p0, idx); ops.push({ op: 'takeoff', p: p0, wp: idx, label, act: tr('act.takeoff') });
          }
          for (let k = 0; k <= steps; k++) {
            const th = a + s * rad(45 + (end - 45) * k / steps);
            const p = [F[0] + Math.cos(th) * R, F[1] + Math.sin(th) * R, h];
            push(p, idx, k === mid ? { wp: idx, kind: 'flag', anchor: [el.x, el.y, V(el).h] } : null);
            move(p);
          }
        } else {
          const os = openings(el), o = os[Math.min(wp.opening || 0, os.length - 1)];
          if (!o) return;
          const d = Math.max(o.depth / 2 + 0.4, 0.6);
          const A = sub(o.c, mul(o.dir, d)), B = add(o.c, mul(o.dir, d));
          let flip = wp.dir === 'rev';
          if (wp.dir !== 'fwd' && wp.dir !== 'rev' && o.dir[2] === 0) {
            const P = last() || (i === 0 ? anchorOf(wps[i + 1]) : null);
            if (P) flip = dist(P, B) < dist(P, A);
          }
          const [e1, e2] = flip ? [B, A] : [A, B];
          if (i === 0) { push([e1[0], e1[1], 0], idx); ops.push({ op: 'takeoff', p: e1, wp: idx, label, act: tr('act.takeoff') }); }
          push(e1, idx);
          push(o.c, idx, { wp: idx, kind: 'gate', anchor: o.c, o });
          push(e2, idx);
          move(e1); move(e2);
        }
      }
      if (wp.hover > 0 && !(wp.el && T(byId(wp.el)).kind === 'pad' && i > 0 && i < n - 1)) {
        ops.push({ op: 'wait', t: wp.hover, wp: idx, label, act: tr('act.hover', { s: num(wp.hover, 1) }) });
      }
    });

    if (ops.length && ops[ops.length - 1].op !== 'land') {
      const p = last();
      push([p[0], p[1], 0], ctrl[ctrl.length - 1].wp);
      ops.push({ op: 'land', wp: ctrl[ctrl.length - 1].wp, label: tr('act.end'), act: tr('act.land') });
    }

    // Nurkade ümardamine – läbi avade jääb lend sirgeks
    const pts = [];
    if (ctrl.length) pts.push(ctrl[0]);
    for (let i = 1; i < ctrl.length - 1; i++) {
      const A = ctrl[i - 1].p, P = ctrl[i].p, B = ctrl[i + 1].p;
      const la = dist(A, P), lb = dist(B, P);
      if (la < 1e-6 || lb < 1e-6) { pts.push(ctrl[i]); continue; }
      const u1 = mul(sub(A, P), 1 / la), u2 = mul(sub(B, P), 1 / lb);
      if (u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2] < -0.995) { pts.push(ctrl[i]); continue; }
      const r = Math.min(0.45, la * 0.45, lb * 0.45), p0 = add(P, mul(u1, r)), p1 = add(P, mul(u2, r));
      for (let k = 0; k <= 8; k++) {
        const t = k / 8, q = add(add(mul(p0, (1 - t) * (1 - t)), mul(P, 2 * (1 - t) * t)), mul(p1, t * t));
        pts.push({ p: q, wp: ctrl[i].wp, mark: k === 4 ? ctrl[i].mark : null });
      }
    }
    if (ctrl.length > 1) pts.push(ctrl[ctrl.length - 1]);
    let s = 0;
    pts.forEach((q, i) => { if (i) s += dist(pts[i - 1].p, q.p); q.s = s; });
    return { pts, ops, length: s, marks: pts.filter(q => q.mark) };
  }

  function flightTime() {
    const d = DRONES[state.drone];
    let t = flight.length / d.speed;
    for (const o of flight.ops) t += o.op === 'wait' ? o.t : o.op === 'takeoff' || o.op === 'land' ? 3 : 0;
    return t;
  }

  function sampleAt(s) {
    const pts = flight.pts;
    if (!pts.length) return null;
    if (s <= 0) return { p: pts[0].p, dir: pts[1] ? sub(pts[1].p, pts[0].p) : [0, 1, 0] };
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].s >= s) {
        const a = pts[i - 1], b = pts[i], t = (s - a.s) / Math.max(1e-9, b.s - a.s);
        return { p: add(a.p, mul(sub(b.p, a.p), t)), dir: sub(b.p, a.p) };
      }
    }
    const L = pts[pts.length - 1];
    return { p: L.p, dir: [0, 1, 0] };
  }

  // ---------- kontroll ----------
  function overlap(a, b) {
    for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4], nx = q[1] - p[1], ny = p[0] - q[0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = v[0] * nx + v[1] * ny; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = v[0] * nx + v[1] * ny; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 || b1 <= a0) return false;
    }
    return true;
  }
  function inPoly(pt, poly) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }

  // Kattumise keeld: element ei tohi uues asendis katta ühtegi elementi, mida ta varem ei katnud
  // (nii saab juba kattuvaid elemente vanadest radadest siiski lahti lohistada).
  function covered(el) {
    const fp = footprint(el, 0.05);
    return state.elements.filter(o => o !== el && o.id !== el.id && overlap(fp, footprint(o, 0.05))).map(o => o.id);
  }
  function tryMove(el, change) {
    const old = { x: el.x, y: el.y, rot: el.rot, v: el.v, z: el.z }, before = covered(el);
    change(el);
    if (covered(el).every(id => before.includes(id))) return true;
    Object.assign(el, old);
    if (old.z === undefined) delete el.z;
    notice(tr('msg.occupied'));
    return false;
  }
  function placeFree(el) {
    const g = state.hall.grid || 0.25, { w, l } = state.hall, x0 = el.x, y0 = el.y;
    for (let r = 0; r <= 60; r++) for (let i = -r; i <= r; i++) for (const j of r ? [-r, r] : [0]) {
      for (const [dx, dy] of [[i, j], [j, i]]) {
        el.x = snap(x0 + dx * g); el.y = snap(y0 + dy * g);
        if (el.x < 0 || el.y < 0 || el.x > w || el.y > l) continue;
        if (!covered(el).length) return true;
      }
    }
    return false;
  }
  let noticeT = 0;
  function notice(msg) {
    const h = $('#hint');
    h.textContent = msg; h.classList.add('warn');
    clearTimeout(noticeT);
    noticeT = setTimeout(() => { h.classList.remove('warn'); updateHint(); }, 2500);
  }

  function validate() {
    const out = [], { w, l, h } = state.hall, drone = DRONES[state.drone];
    const els = state.elements, fps = els.map(e => footprint(e, 0.05));
    els.forEach((el, i) => {
      if (footprint(el).some(([x, y]) => x < -0.01 || y < -0.01 || x > w + 0.01 || y > l + 0.01))
        out.push({ lvl: 'err', el: el.id, msg: tr('chk.outside', { name: typeName(T(el)) }) });
      if (topZ(el) > h) out.push({ lvl: 'err', el: el.id, msg: tr('chk.tall', { name: typeName(T(el)), h: num(topZ(el), 1) }) });
      for (let j = i + 1; j < els.length; j++) {
        if (overlap(fps[i], fps[j])) out.push({ lvl: 'warn', el: el.id, msg: tr('chk.overlap', { a: typeName(T(el)), b: typeName(T(els[j])).toLowerCase() }) });
      }
    });

    const wps = state.path;
    if (!wps.length) { out.push({ lvl: 'info', msg: tr('chk.nopath') }); return out; }
    const first = wps[0].el && byId(wps[0].el), lastEl = wps[wps.length - 1].el && byId(wps[wps.length - 1].el);
    if (!first || T(first).kind !== 'pad') out.push({ lvl: 'info', msg: tr('chk.start') });
    if (!lastEl || T(lastEl).kind !== 'pad') out.push({ lvl: 'info', msg: tr('chk.end') });

    wps.forEach((wp, i) => {
      const el = wp.el && byId(wp.el);
      if (!el || T(el).kind !== 'gate') return;
      const os = openings(el), o = os[Math.min(wp.opening || 0, os.length - 1)];
      if (o && o.size < drone.minGap) out.push({ lvl: 'warn', el: el.id, msg: tr('chk.narrow', { i: i + 1, name: typeName(T(el)), cm: Math.round(o.size * 100), drone: drone.name }) });
    });

    let outside = false, ceiling = false;
    const hitEls = new Set(), tops = new Map(els.map(e => [e.id, topZ(e)]));
    const elFp = new Map(els.map((e, i) => [e.id, fps[i]]));
    const near = i => [i - 1, i, i + 1].map(k => wps[k] && wps[k].el).filter(Boolean);
    flight.pts.forEach(q => {
      const [x, y, z] = q.p;
      if (x < 0.2 || y < 0.2 || x > w - 0.2 || y > l - 0.2) outside = true;
      if (z > h - 0.3) ceiling = true;
      if (z < 0.15) return;
      const skip = near(q.wp);
      for (const el of els) {
        if (hitEls.has(el.id) || skip.includes(el.id) || T(el).kind === 'pad') continue;
        if (z < tops.get(el.id) + 0.1 && inPoly([x, y], elFp.get(el.id))) hitEls.add(el.id);
      }
    });
    if (outside) out.push({ lvl: 'err', msg: tr('chk.wall') });
    if (ceiling) out.push({ lvl: 'err', msg: tr('chk.ceiling') });
    for (const id of hitEls) out.push({ lvl: 'warn', el: id, msg: tr('chk.hit', { name: typeName(T(byId(id))).toLowerCase() }) });
    return out;
  }

  // ---------- joonistamine ----------
  let renderQueued = false;
  function requestRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); } }
  function invalidate() {
    flight = computePath();
    issues = validate();
    anim.s = Math.min(anim.s, flight.length);
    const errs = issues.filter(i => i.lvl === 'err').length, warns = issues.filter(i => i.lvl === 'warn').length;
    const b = $('#checkBadge');
    b.textContent = errs + warns || '';
    b.className = 'badge' + (errs ? ' err' : '');
    save();
    requestRender();
  }

  function polyPath(c, pts) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); }

  function drawFloor() {
    const { w, l, h, grid } = state.hall;
    const wallFill = themeColor('--wall-fill'), wallStroke = themeColor('--wall-stroke');
    const floorColor = themeColor('--floor'), majorGrid = themeColor('--grid-major'), minorGrid = themeColor('--grid-minor');
    const gridText = themeColor('--grid-text');
    const corners = [[0, 0], [w, 0], [w, l], [0, l]];
    // tagumised seinad annavad ruumitunde
    if (view.pitch < 89) {
      const cd = proj([w / 2, l / 2, 0])[2];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], m = proj([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
        if (m[2] < cd) {
          const q = [proj([a[0], a[1], 0]), proj([b[0], b[1], 0]), proj([b[0], b[1], h]), proj([a[0], a[1], h])];
          polyPath(ctx, q); ctx.fillStyle = wallFill; ctx.fill();
          ctx.strokeStyle = wallStroke; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    }
    const fl = corners.map(([x, y]) => proj([x, y, 0]));
    polyPath(ctx, fl); ctx.fillStyle = floorColor; ctx.fill();
    ctx.lineWidth = 1;
    for (let x = 0; x <= w + 1e-6; x += grid) {
      const major = Math.abs(x - Math.round(x)) < 1e-6;
      ctx.strokeStyle = major ? majorGrid : minorGrid;
      const a = proj([x, 0, 0]), b = proj([x, l, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (let y = 0; y <= l + 1e-6; y += grid) {
      const major = Math.abs(y - Math.round(y)) < 1e-6;
      ctx.strokeStyle = major ? majorGrid : minorGrid;
      const a = proj([0, y, 0]), b = proj([w, y, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    polyPath(ctx, fl); ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.stroke();
    // meetrite märgid
    ctx.fillStyle = gridText; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const step = view.scale < 22 ? 4 : 2;
    for (let x = 0; x <= w + 1e-6; x += step) { const p = proj([x, -0.45, 0]); ctx.fillText(x + ' m', p[0], p[1]); }
    for (let y = step; y <= l + 1e-6; y += step) { const p = proj([-0.55, y, 0]); ctx.fillText(y + ' m', p[0], p[1]); }
  }

  function drawCompass() {
    const o = proj([state.hall.w / 2, state.hall.l / 2, 0]), n = proj([state.hall.w / 2, state.hall.l / 2 + 1, 0]);
    let dx = n[0] - o[0], dy = n[1] - o[1];
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const cx = W - 34, cy = 34;
    ctx.save();
    ctx.fillStyle = themeColor('--compass-bg'); ctx.strokeStyle = themeColor('--compass-border');
    ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = themeColor('--compass-ink'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - dx * 11, cy - dy * 11); ctx.lineTo(cx + dx * 11, cy + dy * 11); ctx.stroke();
    ctx.fillStyle = themeColor('--compass-ink');
    ctx.beginPath(); ctx.moveTo(cx + dx * 13, cy + dy * 13); ctx.lineTo(cx + dx * 5 - dy * 5, cy + dy * 5 + dx * 5); ctx.lineTo(cx + dx * 5 + dy * 5, cy + dy * 5 - dx * 5); ctx.fill();
    ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Y', cx, cy + 30);
    ctx.restore();
  }

  function itemFromPrim(p, sel) {
    if (p.k === 'l') {
      const a = proj(p.a), b = proj(p.b);
      return { k: 'l', a, b, c: p.c, w: Math.max(1, p.w * view.scale), d: (a[2] + b[2]) / 2, sel };
    }
    const pts = p.pts.map(proj);
    return { k: 'p', pts, f: p.f, s: p.s, d: pts.reduce((s, q) => s + q[2], 0) / pts.length, sel };
  }

  function drawItem(it) {
    if (it.sel) { ctx.shadowColor = 'rgba(124,58,237,0.9)'; ctx.shadowBlur = 6; }
    if (it.k === 'l') {
      ctx.strokeStyle = it.c; ctx.lineWidth = it.w; ctx.lineCap = 'round';
      ctx.setLineDash(it.dash || []);
      ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]); ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.k === 'p') {
      polyPath(ctx, it.pts);
      if (it.f) { ctx.fillStyle = it.f; ctx.fill(); }
      if (it.s) { ctx.strokeStyle = it.s; ctx.lineWidth = 1; ctx.stroke(); }
    } else if (it.k === 'fn') it.fn();
    ctx.shadowBlur = 0;
  }

  function arrowItems(a, b, color, items, width) {
    const pa = proj(a), pb = proj(b);
    items.push({ k: 'l', a: pa, b: pb, c: color, w: width || 2, d: Math.max(pa[2], pb[2]) + 0.01, dash: [5, 4] });
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], L = Math.hypot(dx, dy);
    if (L < 4) return;
    const ux = dx / L, uy = dy / L;
    items.push({ k: 'p', pts: [[pb[0], pb[1]], [pb[0] - ux * 10 - uy * 5, pb[1] - uy * 10 + ux * 5], [pb[0] - ux * 10 + uy * 5, pb[1] - uy * 10 - ux * 5]], f: color, d: pb[2] + 0.01 });
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = themeColor('--canvas-bg'); ctx.fillRect(0, 0, W, H);
    drawFloor();

    const items = [];
    hits = [];
    const drone = anim.s > 0 || anim.playing ? sampleAt(anim.s) : null;

    // põrandajäljed ja valiku märk
    for (const el of state.elements) {
      const fp = footprint(el).map(proj);
      polyPath(ctx, fp); ctx.fillStyle = themeColor('--footprint-shadow'); ctx.fill();
      if (el.id === ui.sel) {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = PATH_COLOR; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // trajektoori vari põrandal
    if (flight.pts.length > 1) {
      ctx.beginPath();
      flight.pts.forEach((q, i) => { const p = proj([q.p[0], q.p[1], 0]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.strokeStyle = 'rgba(124,58,237,0.22)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (drone) {
      const g = proj([drone.p[0], drone.p[1], 0]);
      ctx.fillStyle = 'rgba(15,23,42,0.18)';
      ctx.beginPath(); ctx.ellipse(g[0], g[1], 0.2 * view.scale, 0.2 * view.scale * Math.sin(rad(view.pitch)), 0, 0, Math.PI * 2); ctx.fill();
    }

    for (const el of state.elements) {
      const sel = el.id === ui.sel, its = worldPrims(el).map(p => itemFromPrim(p, sel));
      items.push(...its);
      const c = proj([el.x, el.y, topZ(el) / 2]);
      hits.push({ el, items: its, fp: footprint(el).map(proj), d: c[2] });
      if (sel && T(el).kind === 'gate') {
        const o = openings(el)[0];
        arrowItems(sub(o.c, mul(o.dir, 0.8)), add(o.c, mul(o.dir, 0.8)), '#d97706', items, 2);
      }
      if (sel && T(el).kind === 'pad') {
        const f = xd(el, [0, 1, 0]);
        arrowItems([el.x, el.y, 0.02], [el.x + f[0] * 0.9, el.y + f[1] * 0.9, 0.02], '#d97706', items, 2);
      }
    }

    // trajektoor
    const pw = Math.max(2, 0.045 * view.scale);
    for (let i = 1; i < flight.pts.length; i++) {
      const a = proj(flight.pts[i - 1].p), b = proj(flight.pts[i].p);
      items.push({ k: 'l', a, b, c: PATH_COLOR, w: pw, d: (a[2] + b[2]) / 2 });
    }
    for (let s = 0.9; s < flight.length - 0.3; s += 1.6) {
      const q = sampleAt(s), L = len3(q.dir);
      if (L < 1e-6) continue;
      const u = mul(q.dir, 1 / L), side = [-u[1], u[0], 0], k = 0.13;
      const tip = proj(add(q.p, mul(u, k))), l1 = proj(add(sub(q.p, mul(u, k)), mul(side, k))), r1 = proj(sub(sub(q.p, mul(u, k)), mul(side, k)));
      items.push({ k: 'p', pts: [tip, l1, r1], f: PATH_COLOR, d: tip[2] + 0.001 });
    }
    if (drone) {
      const p = drone.p, dp = proj(p);
      items.push({ k: 'fn', d: dp[2] + 0.05, fn: () => drawDrone(p, drone.dir) });
    }

    items.sort((a, b) => a.d - b.d);
    for (const it of items) drawItem(it);

    // lennupunktide numbrid
    badges = [];
    ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const seen = new Set();
    for (const m of flight.marks) {
      if (seen.has(m.mark.wp)) continue;
      seen.add(m.mark.wp);
      const a = m.mark.anchor, p = proj(m.mark.kind === 'pad' ? a : [a[0], a[1], a[2] + (m.mark.kind === 'flag' ? 0.25 : 0)]);
      const on = ui.wp === m.mark.wp, r = on ? 11 : 9;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#f59e0b' : PATH_COLOR; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(String(m.mark.wp + 1), p[0], p[1] + 0.5);
      badges.push({ wp: m.mark.wp, x: p[0], y: p[1] });
    }
    drawCompass();
    drawProfile();
  }

  function drawDrone(p, dir) {
    const L = Math.hypot(dir[0], dir[1]) || 1, f = [dir[0] / L, dir[1] / L], r = [f[1], -f[0]], a = 0.12;
    const rotors = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [p[0] + (f[0] * i + r[0] * j) * a, p[1] + (f[1] * i + r[1] * j) * a, p[2]]);
    const c = proj(p), g = proj([p[0], p[1], 0]);
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = themeColor('--footprint-shadow'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(g[0], g[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = themeColor('--compass-ink'); ctx.lineWidth = Math.max(2, 0.03 * view.scale);
    ctx.beginPath(); ctx.moveTo(...proj(rotors[0]).slice(0, 2)); ctx.lineTo(...proj(rotors[2]).slice(0, 2));
    ctx.moveTo(...proj(rotors[1]).slice(0, 2)); ctx.lineTo(...proj(rotors[3]).slice(0, 2)); ctx.stroke();
    rotors.forEach((q, i) => {
      const s = proj(q);
      ctx.beginPath(); ctx.ellipse(s[0], s[1], 0.07 * view.scale, 0.07 * view.scale * Math.max(0.35, Math.sin(rad(view.pitch))), 0, 0, Math.PI * 2);
      ctx.fillStyle = i < 2 ? 'rgba(239,68,68,0.55)' : themeColor('--footprint-shadow'); ctx.fill();
      ctx.strokeStyle = themeColor('--compass-ink'); ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(3, 0.035 * view.scale), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------- kõrgusprofiil ----------
  function drawProfile() {
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.fillStyle = themeColor('--profile-bg'); pctx.fillRect(0, 0, PW, PH);
    pctx.font = '11px system-ui, sans-serif'; pctx.textBaseline = 'middle';
    if (flight.length < 0.01) {
      pctx.fillStyle = themeColor('--grid-text'); pctx.textAlign = 'center';
      pctx.fillText(tr('profile.empty'), PW / 2, PH / 2);
      return;
    }
    const L = flight.length, zMax = Math.max(state.hall.h, 2.5), l0 = 40, r0 = 14, t0 = 16, b0 = 20;
    const X = s => l0 + s / L * (PW - l0 - r0), Y = z => PH - b0 - z / zMax * (PH - t0 - b0);
    pctx.strokeStyle = themeColor('--profile-grid'); pctx.lineWidth = 1; pctx.fillStyle = themeColor('--profile-text'); pctx.textAlign = 'right';
    for (let z = 0; z <= zMax + 1e-6; z += 0.5) {
      pctx.beginPath(); pctx.moveTo(l0, Y(z)); pctx.lineTo(PW - r0, Y(z)); pctx.stroke();
      if (Math.abs(z - Math.round(z)) < 1e-6) pctx.fillText(z + ' m', l0 - 5, Y(z));
    }
    const step = [1, 2, 5, 10, 20].find(k => L / k < 14) || 50;
    pctx.textAlign = 'center';
    for (let s = 0; s <= L; s += step) pctx.fillText(s + ' m', X(s), PH - 8);
    // lagi
    pctx.strokeStyle = '#dc2626'; pctx.setLineDash([5, 4]);
    pctx.beginPath(); pctx.moveTo(l0, Y(state.hall.h)); pctx.lineTo(PW - r0, Y(state.hall.h)); pctx.stroke(); pctx.setLineDash([]);
    // avade lubatud kõrgusvahemikud
    const done = new Set();
    for (const m of flight.marks) {
      const k = m.mark, x = X(m.s);
      if (k.kind === 'gate' && k.o.zMin != null) {
        pctx.fillStyle = 'rgba(22,163,74,0.18)'; pctx.fillRect(x - 5, Y(k.o.zMax), 10, Y(k.o.zMin) - Y(k.o.zMax));
        pctx.strokeStyle = '#16a34a'; pctx.lineWidth = 2;
        pctx.beginPath(); pctx.moveTo(x - 7, Y(k.o.zMax)); pctx.lineTo(x + 7, Y(k.o.zMax)); pctx.moveTo(x - 7, Y(k.o.zMin)); pctx.lineTo(x + 7, Y(k.o.zMin)); pctx.stroke();
      } else if (k.kind === 'gate') {
        pctx.strokeStyle = '#16a34a'; pctx.lineWidth = 2;
        pctx.beginPath(); pctx.moveTo(x - 9, Y(k.anchor[2])); pctx.lineTo(x + 9, Y(k.anchor[2])); pctx.stroke();
      } else if (k.kind === 'flag') {
        pctx.strokeStyle = '#2563eb'; pctx.lineWidth = 1.5;
        pctx.beginPath(); pctx.moveTo(x, Y(0)); pctx.lineTo(x, Y(k.anchor[2])); pctx.stroke();
      }
      if (!done.has(k.wp)) {
        done.add(k.wp);
        pctx.fillStyle = ui.wp === k.wp ? '#f59e0b' : PATH_COLOR;
        pctx.beginPath(); pctx.arc(x, 8, 7, 0, Math.PI * 2); pctx.fill();
        pctx.fillStyle = '#fff'; pctx.font = 'bold 9px system-ui'; pctx.fillText(String(k.wp + 1), x, 8.5); pctx.font = '11px system-ui, sans-serif';
      }
    }
    pctx.strokeStyle = PATH_COLOR; pctx.lineWidth = 2.2; pctx.lineJoin = 'round';
    pctx.beginPath();
    flight.pts.forEach((q, i) => i ? pctx.lineTo(X(q.s), Y(q.p[2])) : pctx.moveTo(X(q.s), Y(q.p[2])));
    pctx.stroke();
    if (anim.s > 0 || anim.playing) {
      const q = sampleAt(anim.s);
      pctx.strokeStyle = '#f59e0b'; pctx.lineWidth = 1.5;
      pctx.beginPath(); pctx.moveTo(X(anim.s), t0); pctx.lineTo(X(anim.s), PH - b0); pctx.stroke();
      pctx.fillStyle = '#f59e0b'; pctx.beginPath(); pctx.arc(X(anim.s), Y(q.p[2]), 4.5, 0, Math.PI * 2); pctx.fill();
    }
  }

  // ---------- animatsioon ----------
  function setPlaying(on) {
    anim.playing = on;
    $('#playBtn').textContent = tr(on ? 'btn.stop' : 'btn.play');
    if (on) {
      if (anim.s >= flight.length - 1e-3) anim.s = 0;
      anim.last = performance.now();
      requestAnimationFrame(tick);
    }
    requestRender();
  }
  function tick(t) {
    if (!anim.playing) return;
    const dt = Math.min(0.1, (t - anim.last) / 1000);
    anim.last = t;
    anim.s += dt * DRONES[state.drone].speed * anim.mult;
    if (anim.s >= flight.length) { anim.s = flight.length; setPlaying(false); }
    render();
    if (anim.playing) requestAnimationFrame(tick);
  }

  // ---------- elementide muutmine ----------
  function addElement(type, x, y) {
    const t = TYPES[type];
    checkpoint();
    const el = { id: uid(), type, v: t.defaultV || 0, x: snap(x), y: snap(y), rot: 0 };
    el.x = clamp(el.x, 0, state.hall.w); el.y = clamp(el.y, 0, state.hall.l);
    if (!placeFree(el)) { undoS.pop(); notice(tr('msg.noSpace')); return; }
    state.elements.push(el);
    ui.sel = el.id;
    if (ui.mode === 'build') ui.tab = 'props';
    invalidate(); renderPanel();
  }
  function freeSpot() {
    const { w, l } = state.hall;
    for (let k = 0; k < 40; k++) {
      const x = snap(w / 2 + ((k % 7) - 3) * 1.5), y = snap(l / 2 + (Math.floor(k / 7) - 2) * 1.5);
      if (!state.elements.some(e => Math.hypot(e.x - x, e.y - y) < 1.2)) return [x, y];
    }
    return [w / 2, l / 2];
  }
  function deleteSelected() {
    if (ui.mode === 'path' && ui.wp != null) { deleteWp(ui.wp); return; }
    const el = ui.sel && byId(ui.sel);
    if (!el) return;
    checkpoint();
    state.elements = state.elements.filter(e => e !== el);
    state.path = state.path.filter(wp => wp.el !== el.id);
    ui.sel = null; ui.wp = null;
    invalidate(); renderPanel();
  }
  function duplicateSelected() {
    const el = ui.sel && byId(ui.sel);
    if (!el) return;
    checkpoint();
    const c = Object.assign({}, el, { id: uid(), x: clamp(el.x + 1, 0, state.hall.w), y: clamp(el.y + 1, 0, state.hall.l) });
    if (!placeFree(c)) { undoS.pop(); notice(tr('msg.noSpace')); return; }
    state.elements.push(c);
    ui.sel = c.id;
    invalidate(); renderPanel();
  }
  function rotateSelected(deg) {
    const el = ui.sel && byId(ui.sel);
    if (!el) return;
    checkpoint();
    if (!tryMove(el, e => { e.rot = ((e.rot + deg + 540) % 360) - 180; })) { undoS.pop(); return; }
    invalidate(); renderPanel();
  }
  function nudge(dx, dy) {
    const el = ui.sel && byId(ui.sel);
    if (!el) return;
    checkpoint();
    const g = state.hall.grid || 0.1;
    if (!tryMove(el, e => {
      e.x = clamp(+(e.x + dx * g).toFixed(2), 0, state.hall.w);
      e.y = clamp(+(e.y + dy * g).toFixed(2), 0, state.hall.l);
    })) { undoS.pop(); return; }
    invalidate(); renderPanel();
  }

  // ---------- lennupunktide muutmine ----------
  function insertWp(wp) {
    checkpoint();
    const at = ui.wp != null && ui.wp < state.path.length - 1 ? ui.wp + 1 : state.path.length;
    state.path.splice(at, 0, wp);
    ui.wp = at;
    ui.tab = 'path';
    invalidate(); renderPanel();
  }
  function addWpForElement(el) {
    insertWp(Object.assign({ id: uid(), el: el.id }, wpDefaults(T(el).kind)));
  }
  function addFreeWp(x, y) {
    insertWp({ id: uid(), el: null, x: snap(x), y: snap(y), z: state.cruise, hover: 0 });
  }
  function deleteWp(i) {
    checkpoint();
    state.path.splice(i, 1);
    ui.wp = state.path.length ? Math.min(i, state.path.length - 1) : null;
    invalidate(); renderPanel();
  }
  function moveWp(i, d) {
    const j = i + d;
    if (j < 0 || j >= state.path.length) return;
    checkpoint();
    [state.path[i], state.path[j]] = [state.path[j], state.path[i]];
    ui.wp = j;
    invalidate(); renderPanel();
  }
  // Tõstab punkti `from` kohale, kus ta on enne punkti `before` (before = path.length → lõppu)
  function moveWpTo(from, before) {
    const to = before > from ? before - 1 : before;
    if (to === from) return;
    checkpoint();
    const [wp] = state.path.splice(from, 1);
    state.path.splice(to, 0, wp);
    ui.wp = to;
    invalidate(); renderPanel();
  }

  // ---------- režiim ja vaated ----------
  function setMode(m) {
    ui.mode = m;
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    canvas.classList.toggle('path-mode', m === 'path');
    ui.tab = m === 'path' ? 'path' : 'props';
    if (m === 'build') ui.wp = null;
    updateHint(); renderPanel(); requestRender();
  }
  function updateHint() {
    $('#hint').innerHTML = tr(ui.mode === 'path' ? 'hint.path' : 'hint.build');
  }

  // ---------- hiir ----------
  function localPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function segDist(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L, 0, 1) : 0;
    return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
  }
  function hitElement(mx, my) {
    let best = null;
    for (const h of hits) {
      let ok = inPoly([mx, my], h.fp);
      if (!ok) for (const it of h.items) {
        if (it.k === 'l' ? segDist(mx, my, it.a, it.b) < Math.max(5, it.w / 2 + 2) : inPoly([mx, my], it.pts)) { ok = true; break; }
      }
      if (ok && (!best || h.d > best.d)) best = h;
    }
    return best && best.el;
  }
  function hitBadge(mx, my) { const b = badges.find(b => Math.hypot(b.x - mx, b.y - my) < 11); return b ? b.wp : null; }

  let drag = null, spaceDown = false;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.focus();
    const [mx, my] = localPos(e);
    const pan = () => { drag = { kind: 'pan', mx, my, px: view.panX, py: view.panY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); };
    if (e.button === 1 || e.button === 2 || spaceDown) return pan();
    if (e.button !== 0) return;
    if (ui.mode === 'path') {
      const b = hitBadge(mx, my);
      if (b != null) { ui.wp = b; ui.tab = 'path'; renderPanel(); requestRender(); return; }
      const el = hitElement(mx, my);
      if (el) addWpForElement(el);
      else {
        const [x, y] = ground(mx, my);
        if (x >= 0 && y >= 0 && x <= state.hall.w && y <= state.hall.l) addFreeWp(x, y);
        else pan();
      }
      return;
    }
    const el = hitElement(mx, my);
    if (!el) {
      if (ui.sel) { ui.sel = null; renderPanel(); }
      return pan();
    }
    if (ui.sel !== el.id) { ui.sel = el.id; ui.tab = 'props'; renderPanel(); }
    drag = { kind: 'move', el, start: ground(mx, my), ox: el.x, oy: el.y, snap: JSON.stringify(state), moved: false };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    requestRender();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const [mx, my] = localPos(e);
    if (drag.kind === 'pan') {
      view.panX = drag.px + mx - drag.mx; view.panY = drag.py + my - drag.my;
      requestRender(); return;
    }
    const g = ground(mx, my), el = drag.el;
    const nx = clamp(snap(drag.ox + g[0] - drag.start[0], e.shiftKey), 0, state.hall.w);
    const ny = clamp(snap(drag.oy + g[1] - drag.start[1], e.shiftKey), 0, state.hall.l);
    if ((nx !== el.x || ny !== el.y) && tryMove(el, e => { e.x = nx; e.y = ny; })) {
      if (!drag.moved) { undoS.push(drag.snap); redoS = []; drag.moved = true; }
      flight = computePath();
      requestRender();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.kind === 'move' && drag.moved;
    drag = null;
    canvas.classList.remove('dragging');
    if (moved) { invalidate(); renderPanel(); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if ((e.shiftKey || e.altKey) && ui.sel && ui.mode === 'build') { rotateSelected(e.deltaY > 0 ? 15 : -15); return; }
    const [mx, my] = localPos(e), k = Math.exp(-e.deltaY * 0.0015), ns = clamp(view.scale * k, 8, 260);
    const kx = (mx - W / 2 - view.panX) / view.scale, ky = (my - H / 2 - view.panY) / view.scale;
    view.scale = ns;
    view.panX = mx - W / 2 - kx * ns; view.panY = my - H / 2 - ky * ns;
    requestRender();
  }, { passive: false });

  // lohistamine paletist
  canvas.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data.startsWith('track:')) return;
    const type = data.slice(6);
    if (!TYPES[type]) return;
    const [mx, my] = localPos(e), [x, y] = ground(mx, my);
    addElement(type, x, y);
  });

  // profiilil klõps kerib animatsiooni
  prof.addEventListener('pointerdown', e => {
    if (flight.length < 0.01) return;
    const r = prof.getBoundingClientRect(), x = e.clientX - r.left;
    anim.s = clamp((x - 40) / (PW - 54) * flight.length, 0, flight.length);
    setPlaying(false);
  });

  // ---------- klaviatuur ----------
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('#simOverlay')) return;
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveToLib(); return; }
    if (ctrl) return;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === 'r' || k === 'R') rotateSelected(e.shiftKey ? -15 : 15);
    else if (k === 'Escape') { ui.sel = null; ui.wp = null; if (ui.mode === 'path') setMode('build'); else { renderPanel(); requestRender(); } }
    else if (k === 'b' || k === 'B') setMode('build');
    else if (k === 'l' || k === 'L') setMode('path');
    else if (k === 'p' || k === 'P') setPlaying(!anim.playing);
    else if (k === 'f' || k === 'F') { fitView(); requestRender(); }
    else if (k === 't' || k === 'T') toggleTop();
    else if (k === '[') rotateView(-45);
    else if (k === ']') rotateView(45);
    else if (k.startsWith('Arrow') && ui.sel && ui.mode === 'build') {
      e.preventDefault();
      // nooled liigutavad ekraanisuunas: leia lähim maailmatelg
      const sx = { ArrowLeft: -1, ArrowRight: 1 }[k] || 0, sy = { ArrowUp: -1, ArrowDown: 1 }[k] || 0;
      const o = ground(W / 2, H / 2), t = ground(W / 2 + sx * 50, H / 2 + sy * 50);
      const dx = t[0] - o[0], dy = t[1] - o[1];
      Math.abs(dx) > Math.abs(dy) ? nudge(Math.sign(dx), 0) : nudge(0, Math.sign(dy));
    }
  });
  document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

  function rotateView(d) { view.yaw += d; fitView(); requestRender(); }
  function toggleTop() {
    view.pitch = view.pitch > 80 ? 36 : 90;
    $('#topBtn').textContent = tr(view.pitch > 80 ? 'btn.top25' : 'btn.top');
    fitView(); requestRender();
  }

  // ---------- failid ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = typeof text === 'string' && text.startsWith('data:') ? text : URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const fileBase = () => (state.name || tr('file.base')).replace(/[^\p{L}\p{N}_-]+/gu, '_');
  function saveFile() { download(fileBase() + '.droonirada.json', JSON.stringify(state, null, 2), 'application/json'); }

  // „Minu rajad“: salvestatud rajad selle brauseri mälus
  function loadLib() { try { const l = JSON.parse(localStorage.getItem(LIB)); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function saveLib(lib) {
    try { localStorage.setItem(LIB, JSON.stringify(lib)); return true; }
    catch (e) { alert(tr('msg.noStorage')); return false; }
  }
  function saveToLib() {
    const lib = loadLib(), name = state.name.trim() || tr('track.untitled'), i = lib.findIndex(r => r.name === name);
    const entry = { name, saved: Date.now(), data: JSON.parse(JSON.stringify(state)) };
    if (i >= 0) lib[i] = entry; else lib.push(entry);
    lib.sort((a, b) => a.name.localeCompare(b.name, LANG));
    if (!saveLib(lib)) return;
    fillTrackSelect();
    const b = document.querySelector('.topbar [data-act="save"]');
    b.textContent = tr(i >= 0 ? 'btn.updated' : 'btn.saved');
    clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = tr('btn.save'); }, 1800);
    if (ui.tab === 'export') renderPanel();
  }
  function openState(data, name) {
    if (!data || !Array.isArray(data.elements) || !Array.isArray(data.path)) { alert(tr('msg.invalid', { name })); return false; }
    if (state.elements.length && !confirm(tr('msg.openConfirm', { name }))) return false;
    checkpoint();
    const copy = JSON.parse(JSON.stringify(data));
    state = Object.assign(defaultState(), copy, { hall: Object.assign(defaultState().hall, copy.hall) });
    if (name) state.name = name;
    state.elements = state.elements.filter(e => TYPES[e.type]);
    ui.sel = null; ui.wp = null;
    afterLoad(); fitView(); requestRender();
    return true;
  }
  function openFromLib(i) { const r = loadLib()[i]; return r ? openState(r.data, r.name) : false; }
  // Juhendaja rajad: JSON-failid kaustas rajad/, nimekirja (rajad/index.json) koostab GitHubi töövoog.
  // Failist avatud lehel (file://) fetch ei tööta – siis jääb rühm lihtsalt tühjaks.
  let instructorList = [];
  const instructorTracks = () => instructorList;
  async function loadInstructorTracks() {
    try {
      const res = await fetch('rajad/index.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const names = await res.json();
      const tracks = await Promise.all(names.map(n => fetch('rajad/' + encodeURIComponent(n), { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null)
        .then(t => t && Array.isArray(t.elements) && Array.isArray(t.path) ? Object.assign(t, { name: t.name || n.replace(/\.json$/i, '') }) : null)
        .catch(() => null)));
      instructorList = tracks.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, LANG));
      fillTrackSelect();
    } catch (e) { /* juhendaja radu pole saadaval */ }
  }
  function deleteFromLib(i) {
    const lib = loadLib();
    if (!lib[i] || !confirm(tr('msg.delConfirm', { name: lib[i].name }))) return;
    lib.splice(i, 1);
    saveLib(lib); fillTrackSelect(); renderPanel();
  }
  const dateStr = t => new Date(t).toLocaleString(tr('locale'), { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // Raja elementide hind kataloogi järgi (ainult komplektis müüdavad elemendid jäävad välja)
  function trackPrice(data) {
    let sum = 0;
    for (const el of data.elements || []) {
      const t = TYPES[el.type], v = t && (t.variants[el.v] || t.variants[0]);
      if (v && v.price != null) sum += v.price;
    }
    return sum;
  }
  function fillTrackSelect() {
    const lib = loadLib(), ins = instructorTracks();
    const options = `<option value="">${tr('tracks')}</option>` +
      (lib.length ? `<optgroup label="${tr('tracks.mine')}">${lib.map((r, i) => `<option value="m:${i}">${esc(r.name)} (${money(trackPrice(r.data))})</option>`).join('')}</optgroup>` : '') +
      (ins.length ? `<optgroup label="${tr('tracks.instructor')}">${ins.map((r, i) => `<option value="j:${i}">${esc(r.name || tr('track.n', { n: i + 1 }))} (${money(trackPrice(r))})</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="${tr('tracks.catalog')}">${TEMPLATES.map((t, i) => `<option value="t:${i}">${esc(t.name)} (${money(t.price)})</option>`).join('')}</optgroup>`;
    tsel.innerHTML = options;
    $('#simTrackSelect').innerHTML = options;
  }

  function loadSelectedTrack(value) {
    if (!value) return false;
    const [kind, rawIndex] = value.split(':'), index = Number(rawIndex);
    if (kind === 'm') return openFromLib(index);
    if (kind === 'j') {
      const route = instructorTracks()[index];
      return route ? openState(route, route.name || tr('track.instructor')) : false;
    }
    const template = kind === 't' ? TEMPLATES[index] : null;
    if (!template || (state.elements.length && !confirm(tr('msg.loadConfirm', { name: template.name })))) return false;
    checkpoint(); loadTemplate(template); ui.sel = null; ui.wp = null; afterLoad(); fitView(); requestRender();
    return true;
  }
  function openFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (!Array.isArray(s.elements) || !Array.isArray(s.path)) throw new Error(tr('msg.badFormat'));
        s.elements = s.elements.filter(e => TYPES[e.type]);
        checkpoint();
        state = Object.assign(defaultState(), s, { hall: Object.assign(defaultState().hall, s.hall) });
        ui.sel = null; ui.wp = null;
        afterLoad(); fitView(); requestRender();
      } catch (err) { alert(tr('msg.openFail', { err: err.message })); }
    };
    r.readAsText(file);
  }

  // ---------- eksport ----------
  function startHeading() {
    const w0 = state.path[0], el = w0 && w0.el && byId(w0.el);
    return el && T(el).kind === 'pad' ? el.rot : 0;
  }
  function codroneCode() {
    const d = DRONES.codrone, ops = flight.ops;
    const rot = rad(startHeading()), f = [-Math.sin(rot), Math.cos(rot)], l = [-f[1], f[0]];
    const lines = [
      `# ${state.name} – CoDrone EDU`,
      tr('py.gen', { date: new Date().toLocaleDateString(tr('locale')) }),
      tr('py.place'),
      tr('py.move'),
      tr('py.safety'),
      '',
      'from codrone_edu.drone import *',
      'import time',
      '',
      'drone = Drone()',
      'drone.pair()',
      '',
    ];
    if (!ops.length) return lines.concat([tr('py.empty'), 'drone.close()']).join('\n');
    let pos = null, lastWp = -1;
    for (const o of ops) {
      if (o.wp !== lastWp && o.op !== 'land') { lines.push('', `# ${o.label} – ${o.act}`); lastWp = o.wp; }
      if (o.op === 'takeoff') { lines.push('drone.takeoff()', 'time.sleep(1)'); pos = [o.p[0], o.p[1], d.takeoffZ]; }
      else if (o.op === 'move' && pos) {
        const v = sub(o.p, pos);
        if (len3(v) < 0.03) continue;
        const fw = v[0] * f[0] + v[1] * f[1], lf = v[0] * l[0] + v[1] * l[1];
        lines.push(`drone.move_distance(${fw.toFixed(2)}, ${lf.toFixed(2)}, ${v[2].toFixed(2)}, ${d.speed})`);
        pos = o.p;
      } else if (o.op === 'wait') lines.push(`time.sleep(${o.t})`);
      else if (o.op === 'land') { lines.push('', `# ${o.label} – ${tr('act.land')}`, 'drone.land()'); pos = null; lastWp = -1; }
    }
    lines.push('drone.close()');
    return lines.join('\n');
  }
  function flightPlan() {
    const rows = [];
    let pos = null, cur = null;
    for (const o of flight.ops) {
      if (o.op === 'takeoff') { pos = [o.p[0], o.p[1], 0]; cur = { wp: o.wp, label: o.label, act: tr('act.takeoff'), dist: 0, hdg: null, z: 0 }; rows.push(cur); continue; }
      if (o.op === 'land') {
        if (cur && cur.wp === o.wp) { cur.act = tr('act.land'); cur.z = 0; }
        else rows.push({ label: o.label, act: tr('act.land'), dist: 0, hdg: null, z: 0 });
        cur = null; continue;
      }
      if (o.op === 'wait') { rows.push({ label: o.label, act: o.act, dist: 0, hdg: null, z: pos ? pos[2] : 0 }); cur = null; continue; }
      if (!pos) continue;
      const v = sub(o.p, pos), h = Math.hypot(v[0], v[1]);
      if (!cur || cur.wp !== o.wp) {
        cur = { wp: o.wp, label: o.label, act: o.act, dist: 0, hdg: h > 0.02 ? (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360 : null, z: o.p[2] };
        rows.push(cur);
      }
      if (cur.hdg == null && h > 0.02) cur.hdg = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
      cur.dist += h; cur.z = o.p[2];
      pos = o.p;
    }
    return rows;
  }
  // Eestikeelne Excel ootab semikoolonit ja komakohta, ingliskeelne koma ja punkti
  function csv(head, rows) {
    const sep = LANG === 'en' ? ',' : ';';
    const cell = c => { c = String(c); return c.includes(sep) || c.includes('"') ? '"' + c.replace(/"/g, '""') + '"' : c; };
    return [head.split('|')].concat(rows).map(r => r.map(cell).join(sep)).join('\n');
  }
  function planCsv() {
    return csv(tr('csv.plan'), flightPlan().map((r, i) => [i + 1, r.label, r.act, num(r.dist, 2), r.hdg == null ? '' : Math.round(r.hdg), num(r.z, 2)]));
  }
  function materials() {
    const m = new Map();
    for (const el of state.elements) {
      const key = el.type + '|' + el.v;
      if (!m.has(key)) m.set(key, { t: T(el), v: V(el), n: 0 });
      m.get(key).n++;
    }
    return [...m.values()].sort((a, b) => GROUPS.indexOf(a.t.group) - GROUPS.indexOf(b.t.group) || typeName(a.t).localeCompare(typeName(b.t), LANG));
  }
  function materialsCsv() {
    const usd = n => n == null ? '' : LANG === 'en' ? n.toFixed(2) : n.toFixed(2).replace('.', ',');
    return csv(tr('csv.mat'), materials().map(r => [typeName(r.t), r.t.en, loc(r.v, 'label'), r.n, usd(r.v.price), usd(r.v.price == null ? null : r.v.price * r.n)]));
  }
  function exportPng() {
    const was = ui.sel;
    ui.sel = null; render();
    download(fileBase() + '.png', canvas.toDataURL('image/png'));
    ui.sel = was; render();
  }

  // ---------- paneel ----------
  function field(label, html) { return `<label class="field"><span>${label}</span>${html}</label>`; }
  function numIn(k, v, min, max, step) { return `<input type="number" data-k="${k}" value="${+v.toFixed(2)}" min="${min}" max="${max}" step="${step}">`; }
  function rangeIn(k, v, min, max, step, unit) {
    return `<div class="range"><input type="range" data-k="${k}" value="${v}" min="${min}" max="${max}" step="${step}"><output data-out="${k}">${num(v, 2)}${unit}</output></div>`;
  }
  function selectIn(k, opts, cur) {
    return `<select data-k="${k}">${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  }

  function panelProps() {
    const el = ui.sel && byId(ui.sel);
    if (!el) {
      const h = state.hall;
      return `<h2>${tr('p.hall')}</h2>
        ${field(tr('p.width'), numIn('hall.w', h.w, 4, 60, 0.5))}
        ${field(tr('p.length'), numIn('hall.l', h.l, 4, 60, 0.5))}
        ${field(tr('p.ceiling'), numIn('hall.h', h.h, 2, 15, 0.1))}
        ${field(tr('p.grid'), selectIn('hall.grid', [[0.25, '25 cm'], [0.5, '50 cm'], [1, '1 m']], h.grid))}
        <h4>${tr('p.howto')}</h4>
        <p class="note">${tr('p.howto1')}</p>
        <p class="note">${tr('p.howto2')}</p>
        <p class="note">${tr('p.howto3')}</p>`;
    }
    const t = T(el), v = V(el), z = elZ(el);
    const os = t.kind === 'gate' ? openings(el) : [];
    const inPath = state.path.map((w, i) => w.el === el.id ? i + 1 : null).filter(Boolean);
    const sub = [typeName(t) !== t.en ? t.en : '', inPath.length ? tr('p.inPath', { list: inPath.join(', ') }) : ''].filter(Boolean).join(' · ');
    let html = `<h2><img src="../assets/track/${t.icon}" alt="">${esc(typeName(t))}</h2>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
      ${field(tr('p.size'), selectIn('el.v', t.variants.map((x, i) => [i, loc(x, 'label') + (x.price != null ? ' – ' + money(x.price) : '')]), el.v))}
      ${field(tr('p.rot'), rangeIn('el.rot', el.rot, -180, 180, 15, '°'))}
      ${field('X (m)', numIn('el.x', el.x, 0, state.hall.w, state.hall.grid))}
      ${field('Y (m)', numIn('el.y', el.y, 0, state.hall.l, state.hall.grid))}`;
    if (t.adjustable) {
      const [a, b] = t.zRange(v);
      html += field(tr('p.zc'), rangeIn('el.z', z, +a.toFixed(2), b, 0.05, ' m'));
    }
    html += `<div class="row">
        <button data-act="el-addwp" class="primary">${tr('p.addwp')}</button>
        <button data-act="el-rot90">${tr('p.rot90')}</button>
        <button data-act="el-dup">${tr('p.dup')}</button>
        <button data-act="el-del" class="danger">${tr('p.del')}</button>
      </div>`;
    if (os.length) {
      html += `<h4>${tr('p.openings')}</h4><p class="note">` + os.map(o => `${esc(loc(o, 'name'))}: ${Math.round(o.size * 100)} cm` +
        (o.zMin != null ? tr('p.at', { a: num(o.zMin, 2), b: num(o.zMax, 2) }) : tr('p.fromAbove'))).join('<br>') +
        `</p><p class="note">${tr('p.arrowGate')}</p>`;
    }
    if (t.kind === 'pad') html += `<p class="note">${tr('p.arrowPad')}</p>`;
    return html;
  }

  function panelPath() {
    const d = DRONES[state.drone];
    let html = `${field(tr('path.drone'), selectIn('drone', Object.entries(DRONES).map(([k, x]) => [k, x.name]), state.drone))}
      ${field(tr('path.cruise'), rangeIn('cruise', state.cruise, 0.4, Math.min(3, state.hall.h - 0.3), 0.1, ' m'))}`;
    if (flight.length > 0) {
      const t = flightTime();
      html += `<div class="stats">
        <div class="stat"><b>${num(flight.length, 1)} m</b><span>${tr('path.len')}</span></div>
        <div class="stat"><b>${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}</b><span>${tr('path.time', { v: num(d.speed, 1) })}</span></div>
      </div>`;
    }
    html += `<h4>${tr('path.wps')}</h4>`;
    if (!state.path.length) {
      html += `<div class="empty">${tr(ui.mode === 'path' ? 'path.emptyPath' : 'path.emptyBuild')}</div>`;
    } else {
      html += '<ol class="wp-list">' + state.path.map((wp, i) => {
        const lbl = wpLabel(wp, i).replace(/^\d+\.\s*/, '');
        return `<li data-wp="${i}" class="${ui.wp === i ? 'on' : ''}" draggable="true" title="${tr('path.drag')}">
          <span class="wp-grip" aria-hidden="true">⠿</span>
          <span class="wp-num">${i + 1}</span>
          <span class="wp-text">${esc(lbl)}<small>${esc(wpAction(wp, i, state.path.length))}</small></span>
          <button data-act="wp-up" data-i="${i}" title="${tr('path.up')}">↑</button>
          <button data-act="wp-down" data-i="${i}" title="${tr('path.down')}">↓</button>
          <button data-act="wp-del" data-i="${i}" title="${tr('path.remove')}" class="danger">✕</button>
        </li>`;
      }).join('') + '</ol>';
      html += `<div class="row"><button data-act="path-rev">${tr('path.rev')}</button><button data-act="path-clear" class="danger">${tr('path.clear')}</button></div>`;
    }
    const wp = ui.wp != null && state.path[ui.wp];
    if (wp) {
      html += `<h4>${tr('path.point', { n: ui.wp + 1 })}</h4>`;
      const el = wp.el && byId(wp.el), kind = el ? T(el).kind : 'free';
      if (kind === 'gate') {
        const os = T(el).openings(V(el), elZ(el));
        if (os.length > 1) html += field(tr('path.opening'), selectIn('wp.opening', os.map((o, i) => [i, loc(o, 'name')]), wp.opening || 0));
        html += field(tr('path.dir'), selectIn('wp.dir', ['auto', 'fwd', 'rev'].map(k => [k, tr('dir.' + k)]), wp.dir || 'auto'));
      } else if (kind === 'pylon') {
        html += field(tr('path.flagSide'), selectIn('wp.side', ['left', 'right'].map(k => [k, tr('flag.' + k)]), wp.side || 'left'));
        html += field(tr('path.turn'), selectIn('wp.turn', ['pass', 'uturn', 'circle'].map(k => [k, tr('turn.' + k)]), wp.turn || 'pass'));
        html += field(tr('path.height'), rangeIn('wp.z', wp.z != null ? wp.z : state.cruise, 0.4, Math.min(3, state.hall.h - 0.3), 0.1, ' m'));
        html += field(tr('path.radius'), rangeIn('wp.r', wp.r || 0.7, 0.4, 2, 0.1, ' m'));
      } else if (kind === 'free') {
        html += field('X (m)', numIn('wp.x', wp.x, 0, state.hall.w, 0.25));
        html += field('Y (m)', numIn('wp.y', wp.y, 0, state.hall.l, 0.25));
        html += field(tr('path.height'), rangeIn('wp.z', wp.z, 0.3, Math.min(3, state.hall.h - 0.3), 0.1, ' m'));
      }
      if (kind !== 'pad' || (ui.wp > 0 && ui.wp < state.path.length - 1)) {
        html += field(tr(kind === 'pad' ? 'path.wait' : 'path.hover'), rangeIn('wp.hover', wp.hover || 0, 0, 10, 0.5, ' s'));
      }
    }
    return html;
  }

  function panelCheck() {
    if (!issues.length) return '<ul class="issues"><li><span class="lvl ok">✓</span>' + tr('chk.ok') + '</li></ul>';
    const icon = { err: '!', warn: '!', info: 'i' };
    return `<ul class="issues">${issues.map(i => `<li${i.el ? ` data-el="${i.el}"` : ''}><span class="lvl ${i.lvl}">${icon[i.lvl]}</span><span>${esc(i.msg)}</span></li>`).join('')}</ul>
      <p class="note">${tr('chk.note')}</p>`;
  }

  function panelMat() {
    const rows = materials();
    if (!rows.length) return `<div class="empty">${tr('mat.empty')}</div>`;
    let total = 0, missing = 0;
    const body = rows.map(r => {
      if (r.v.price == null) missing++; else total += r.v.price * r.n;
      return `<tr><td>${esc(typeName(r.t))}<br><small class="note">${esc(loc(r.v, 'label'))}</small></td><td class="num">${r.n}</td>
        <td class="num">${r.v.price == null ? '–' : money(r.v.price)}</td><td class="num">${r.v.price == null ? '–' : money(r.v.price * r.n)}</td></tr>`;
    }).join('');
    return `<table class="mat"><thead><tr><th>${tr('mat.el')}</th><th class="num">${tr('mat.pcs')}</th><th class="num">${tr('mat.price')}</th><th class="num">${tr('mat.total')}</th></tr></thead>
      <tbody>${body}</tbody><tfoot><tr><td>${tr('mat.total')}</td><td class="num">${state.elements.length}</td><td></td><td class="num">${money(total)}</td></tr></tfoot></table>
      <p class="note">${tr('mat.note')}${missing ? tr('mat.setOnly') : ''}</p>
      <div class="row"><button data-act="mat-csv">${tr('dl.csv')}</button></div>`;
  }

  function panelExport() {
    const d = DRONES[state.drone];
    let html = `${field(tr('path.drone'), selectIn('drone', Object.entries(DRONES).map(([k, x]) => [k, x.name]), state.drone))}`;
    if (d.code) {
      html += `<h4>Python (CoDrone EDU)</h4>
        <p class="note">${tr('ex.pyNote')}</p>
        <textarea class="code" readonly spellcheck="false">${esc(codroneCode())}</textarea>
        <div class="row"><button data-act="copy-code">${tr('ex.copy')}</button><button data-act="dl-code">${tr('ex.dlPy')}</button></div>`;
    } else {
      const rows = flightPlan();
      html += `<h4>${tr('ex.plan')} (DJI Neo 2)</h4>
        <p class="note">${tr('ex.planNote')}</p>
        ${rows.length ? `<table class="plan"><thead><tr><th>#</th><th>${tr('ex.stage')}</th><th>${tr('ex.action')}</th><th class="num">m</th><th class="num">°</th><th class="num">h</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label.replace(/^\d+\.\s*/, ''))}</td><td>${esc(r.act)}</td><td class="num">${num(r.dist, 1)}</td><td class="num">${r.hdg == null ? '' : Math.round(r.hdg)}</td><td class="num">${num(r.z, 1)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">${tr('ex.noPath')}</div>`}
        <div class="row"><button data-act="dl-csv">${tr('dl.csv')}</button></div>`;
    }
    html += `<h4>${tr('ex.track')}</h4><div class="row"><button data-act="save">${tr('ex.saveList')}</button><button data-act="download">${tr('ex.dlJson')}</button><button data-act="png">${tr('ex.png')}</button><button data-act="print">${tr('ex.print')}</button></div>`;
    const lib = loadLib();
    html += `<h4>${tr('tracks.mine')}</h4>` + (lib.length
      ? '<ol class="wp-list">' + lib.map((r, i) => `<li class="${r.name === state.name ? 'on' : ''}">
          <span class="wp-text">${esc(r.name)}<small>${dateStr(r.saved)} · ${tr('ex.elements', { n: r.data.elements.length })} · ${money(trackPrice(r.data))}</small></span>
          <button data-act="lib-open" data-i="${i}">${tr('ex.open')}</button>
          <button data-act="lib-del" data-i="${i}" class="danger" title="${tr('ex.libDel')}">✕</button></li>`).join('') + '</ol>'
      : `<div class="empty">${tr('ex.libEmpty')}</div>`) +
      `<p class="note">${tr('ex.libNote')}</p>
      <h4>${tr('ex.instr')}</h4>
      <p class="note">${tr('ex.instrNote')}</p>`;
    return html;
  }

  function renderPanel() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const f = { props: panelProps, path: panelPath, check: panelCheck, mat: panelMat, export: panelExport }[ui.tab];
    panelBody.innerHTML = f();
  }

  function applyField(k, val) {
    const el = ui.sel && byId(ui.sel), wp = ui.wp != null && state.path[ui.wp];
    const [a, b] = k.split('.');
    if (a === 'hall') {
      if (b === 'grid') state.hall.grid = +val;
      else state.hall[b] = clamp(val, b === 'h' ? 2 : 4, b === 'h' ? 15 : 60);
      if (b !== 'h' && b !== 'grid') { fitView(); }
    } else if (a === 'el' && el) {
      return tryMove(el, el => {
        if (b === 'v') { el.v = +val; delete el.z; }
        else if (b === 'rot') el.rot = val;
        else if (b === 'x') el.x = clamp(val, 0, state.hall.w);
        else if (b === 'y') el.y = clamp(val, 0, state.hall.l);
        else if (b === 'z') el.z = val;
      });
    } else if (a === 'wp' && wp) {
      wp[b] = ['opening', 'x', 'y', 'z', 'r', 'hover'].includes(b) ? +val : val;
    } else if (k === 'cruise') state.cruise = val;
    else if (k === 'drone') state.drone = val;
  }

  function onField(e, commit) {
    const t = e.target, k = t.dataset.k;
    if (!k) return;
    const val = t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
    if ((t.type === 'number' || t.type === 'range') && !isFinite(val)) return;
    beginEdit();
    if (applyField(k, val) === false) { if (commit) { endEdit(); renderPanel(); } return; }
    const out = panelBody.querySelector(`[data-out="${k}"]`);
    if (out) out.textContent = num(val, 2) + (k.endsWith('rot') ? '°' : k.endsWith('hover') ? ' s' : ' m');
    invalidate();
    if (commit) { endEdit(); if (t.tagName === 'SELECT' || t.type === 'range') renderPanel(); }
  }
  panelBody.addEventListener('input', e => onField(e, false));
  panelBody.addEventListener('change', e => onField(e, true));
  // lennupunktide järjestamine lohistades
  let wpDrag = null;
  const clearDropMarks = () => panelBody.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
  const dropTarget = e => {
    const li = e.target.closest('li[data-wp]');
    if (!li) return null;
    const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    return { li, before: +li.dataset.wp + (after ? 1 : 0), after };
  };
  panelBody.addEventListener('dragstart', e => {
    const li = e.target.closest('li[data-wp]');
    if (!li) return;
    wpDrag = +li.dataset.wp;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'wp:' + wpDrag);
    li.classList.add('dragging');
  });
  panelBody.addEventListener('dragover', e => {
    if (wpDrag == null) return;
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    t.li.classList.add(t.after ? 'drop-after' : 'drop-before');
  });
  panelBody.addEventListener('drop', e => {
    if (wpDrag == null) return;
    const t = dropTarget(e);
    e.preventDefault();
    const from = wpDrag;
    wpDrag = null;
    clearDropMarks();
    if (t) moveWpTo(from, t.before);
  });
  panelBody.addEventListener('dragend', () => {
    wpDrag = null;
    clearDropMarks();
    panelBody.querySelectorAll('li.dragging').forEach(n => n.classList.remove('dragging'));
  });

  panelBody.addEventListener('click', e => {
    const li = e.target.closest('li[data-wp]'), act = e.target.closest('[data-act]');
    if (act) {
      const i = +act.dataset.i;
      switch (act.dataset.act) {
        case 'el-del': deleteSelected(); break;
        case 'el-dup': duplicateSelected(); break;
        case 'el-rot90': rotateSelected(90); break;
        case 'el-addwp': if (ui.sel && byId(ui.sel)) addWpForElement(byId(ui.sel)); break;
        case 'wp-up': moveWp(i, -1); break;
        case 'wp-down': moveWp(i, 1); break;
        case 'wp-del': deleteWp(i); break;
        case 'path-clear': if (confirm(tr('msg.clearConfirm'))) { checkpoint(); state.path = []; ui.wp = null; invalidate(); renderPanel(); } break;
        case 'path-rev': checkpoint(); state.path.reverse(); state.path.forEach(w => { if (w.side) w.side = w.side === 'left' ? 'right' : 'left'; }); invalidate(); renderPanel(); break;
        case 'copy-code': navigator.clipboard.writeText(codroneCode()).then(() => { act.textContent = tr('ex.copied'); }); break;
        case 'dl-code': download(fileBase() + '.py', codroneCode(), 'text/x-python'); break;
        case 'dl-csv': download(fileBase() + '-' + tr('file.plan') + '.csv', '﻿' + planCsv(), 'text/csv'); break;
        case 'mat-csv': download(fileBase() + '-' + tr('file.mat') + '.csv', '﻿' + materialsCsv(), 'text/csv'); break;
        case 'save': saveToLib(); break;
        case 'download': saveFile(); break;
        case 'lib-open': openFromLib(i); break;
        case 'lib-del': deleteFromLib(i); break;
        case 'png': exportPng(); break;
        case 'print': window.print(); break;
      }
      return;
    }
    if (li) { ui.wp = +li.dataset.wp; renderPanel(); requestRender(); return; }
    const iss = e.target.closest('li[data-el]');
    if (iss && byId(iss.dataset.el)) { ui.sel = iss.dataset.el; if (ui.mode !== 'build') setMode('build'); else { ui.tab = 'props'; renderPanel(); requestRender(); } }
  });

  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { ui.tab = b.dataset.tab; renderPanel(); } });

  // ---------- ülariba ----------
  document.querySelector('.topbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) { setMode(b.dataset.mode); return; }
    if (b.dataset.lang) { setLang(b.dataset.lang); return; }
    switch (b.dataset.act) {
      case 'new':
        if (state.elements.length && !confirm(tr('msg.newConfirm'))) return;
        checkpoint(); state = Object.assign(defaultState(), { drone: state.drone }); ui.sel = null; ui.wp = null; afterLoad(); fitView(); requestRender(); break;
      case 'open': $('#fileIn').click(); break;
      case 'save': saveToLib(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'rotL': rotateView(-45); break;
      case 'rotR': rotateView(45); break;
      case 'top': toggleTop(); break;
      case 'fit': fitView(); requestRender(); break;
      case 'play': setPlaying(!anim.playing); break;
      case 'sim': startSimulation(); break;
      case 'png': exportPng(); break;
    }
  });
  $('#fileIn').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('#simPause').addEventListener('click', () => simulator.pause());
  $('#simSettingsOpen').addEventListener('click', () => { updateSimRouteCurrent(); updateSimDroneCurrent(); simulator.openSettings(); });
  document.querySelector('.sim-menu').addEventListener('click', e => {
    if (e.target.closest('button')) e.currentTarget.open = false;
    else if (e.target === e.currentTarget) e.currentTarget.open = false;
  });
  $('#simSettingsClose').addEventListener('click', () => simulator.closeSettings());
  $('#simSettings').addEventListener('click', e => { if (e.target === e.currentTarget) simulator.closeSettings(); });
  document.querySelectorAll('[data-settings-tab]').forEach(tab => tab.addEventListener('click', () => {
    const selected = tab.dataset.settingsTab;
    document.querySelectorAll('[data-settings-tab]').forEach(button => {
      const active = button === tab;
      button.classList.toggle('on', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-settings-page]').forEach(page => { page.hidden = page.dataset.settingsPage !== selected; });
  }));
  $('#simControllerRescan').addEventListener('click', () => simulator.scanGamepads(true));
  $('#simControllerSelect').addEventListener('change', e => simulator.selectGamepad(e.target.value));
  $('#simCoDroneConnect').addEventListener('click', () => simulator.toggleCoDrone());
  $('#simControllerCalibrate').addEventListener('click', () => simulator.startControllerCalibration());
  document.querySelectorAll('input[name="simControlMode"]').forEach(input => input.addEventListener('change', e => simulator.setControlMode(e.target.value)));
  $('#simDeadzone').addEventListener('input', e => simulator.setDeadzone(Number(e.target.value) / 100));
  $('#simRestart').addEventListener('click', () => simulator.start());
  $('#simClose').addEventListener('click', () => simulator.close());
  $('#speedSel').addEventListener('change', e => { anim.mult = +e.target.value; });
  $('#trackName').addEventListener('change', e => { checkpoint(); state.name = e.target.value.trim() || tr('track.untitled'); save(); });
  const tsel = $('#templateSel');
  const simTrackSelect = $('#simTrackSelect');
  fillTrackSelect();
  loadInstructorTracks();
  tsel.addEventListener('change', () => {
    const value = tsel.value;
    tsel.value = '';
    simTrackSelect.value = '';
    loadSelectedTrack(value);
  });
  simTrackSelect.addEventListener('change', () => {
    const value = simTrackSelect.value;
    simTrackSelect.value = '';
    tsel.value = '';
    const feedback = $('#simRouteFeedback');
    if (!loadSelectedTrack(value)) {
      feedback.textContent = tr('sim.settings.routeCancelled');
      return;
    }
    if (simulator.start()) {
      simulator.pause();
      feedback.textContent = tr('sim.settings.routeLoaded');
    } else {
      feedback.textContent = tr('sim.settings.routeNoFlight');
    }
  });
  $('#simDroneSelect').addEventListener('change', e => {
    const drone = e.target.value;
    if (!DRONES[drone] || state.drone === drone) return;
    checkpoint();
    state.drone = drone;
    save();
    invalidate();
    renderPanel();
    updateSimDroneCurrent();
    if (simulator.active && simulator.scene) simulator.scene.drone = drone;
  });

  // ---------- palett ----------
  function renderPalette() {
    // Kataloogi hind või hinnavahemik (ainult komplektis müüdavad variandid jäävad välja)
    const priceRange = t => {
      const p = t.variants.map(v => v.price).filter(x => x != null);
      if (!p.length) return '';
      const lo = Math.min(...p), hi = Math.max(...p);
      return lo === hi ? money(lo) : money(lo) + '–' + hi.toFixed(2);
    };
    $('#palette').innerHTML = GROUPS.map(g => `<h3>${groupName(g)}</h3><div class="pal-grid">${Object.entries(TYPES).filter(([, t]) => t.group === g).map(([k, t]) =>
      `<button class="pal-item" draggable="true" data-type="${k}" title="${esc(tr('palette.item.t', { name: typeName(t), en: t.en }))}"><img src="../assets/track/${t.icon}" alt=""><span>${esc(typeName(t))}</span><small class="pal-price">${priceRange(t)}</small></button>`).join('')}</div>`).join('');
  }
  $('#palette').addEventListener('dragstart', e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    e.dataTransfer.setData('text/plain', 'track:' + b.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
    const img = b.querySelector('img');
    if (img) e.dataTransfer.setDragImage(img, 20, 20);
  });
  $('#palette').addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    const [x, y] = freeSpot();
    addElement(b.dataset.type, x, y);
  });

  // ---------- keel ----------
  // Staatilised tekstid on HTML-is atribuutidega data-i18n (sisu), data-i18n-title ja data-i18n-aria
  function applyTheme(theme, persist = true) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.colorScheme = selected;
    document.querySelectorAll('[data-theme-select]').forEach(select => { select.value = selected; });
    if (persist) {
      try { localStorage.setItem(THEME_KEY, selected); } catch (e) { /* teema jääb selleks laadimiseks */ }
    }
    requestRender();
    simulator.setTheme();
  }

  function applyLang() {
    document.documentElement.lang = LANG;
    document.title = tr('app.title');
    document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = tr(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = tr(n.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria]').forEach(n => n.setAttribute('aria-label', tr(n.dataset.i18nAria)));
    document.querySelectorAll('#langSeg button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
    $('#playBtn').textContent = tr(anim.playing ? 'btn.stop' : 'btn.play');
    $('#topBtn').textContent = tr(view.pitch > 80 ? 'btn.top25' : 'btn.top');
    $('#simPause').textContent = tr(simulator.paused ? 'sim.resume' : 'sim.pause');
    simulator.updateControlHint();
    if (simulator.settingsOpen) simulator.refreshSettings();
  }
  function setLang(l) {
    if (!I18N[l] || l === LANG) return;
    LANG = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* salvestus pole saadaval */ }
    applyLang(); renderPalette(); fillTrackSelect(); updateHint();
    invalidate(); renderPanel();
  }
  document.querySelectorAll('[data-theme-select]').forEach(select => select.addEventListener('change', () => applyTheme(select.value)));

  // ---------- suurus ja käivitus ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect(), q = prof.getBoundingClientRect();
    const first = !W;
    W = r.width; H = r.height; PW = q.width; PH = q.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    prof.width = Math.round(PW * dpr); prof.height = Math.round(PH * dpr);
    if (simulator.active) simulator.resize();
    if (first) fitView();
    requestRender();
  }

  try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && Array.isArray(s.elements)) state = Object.assign(defaultState(), s); } catch (e) { /* tühi */ }
  if (!state) { state = defaultState(); loadTemplate(TEMPLATES[0]); }
  state.elements = state.elements.filter(e => TYPES[e.type]);
  $('#trackName').value = state.name;
  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem(THEME_KEY) || savedTheme; } catch (e) { /* kasuta heledat teemat */ }
  applyTheme(savedTheme, false);
  applyLang();
  renderPalette();
  setMode('build');
  window.addEventListener('resize', resize);
  resize();
  invalidate();
  renderPanel();
})();
