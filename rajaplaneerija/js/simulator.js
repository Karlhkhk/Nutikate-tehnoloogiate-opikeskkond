'use strict';

/* Klaviatuuriga juhitav FPV-simulaator. Joonistab rajaplaneerija olemasoleva
   geomeetria perspektiivprojektsiooniga, et see töötaks ka võrguühenduseta. */
const coDroneDefaultChannels = () => ({
  // CoDrone EDU Mode 2: left Y = throttle, right X = roll,
  // right Y = pitch, left X = yaw. Y teljed on Gamepadi kokkuleppe järgi ümber pööratud.
  throttle: { axis: 1, invert: true }, roll: { axis: 2, invert: false },
  pitch: { axis: 3, invert: true }, yaw: { axis: 0, invert: false },
});
const defaultKeyboardBindings = () => ({
  forward: ['KeyW', 'ArrowUp'], backward: ['KeyS', 'ArrowDown'],
  left: ['KeyA'], right: ['KeyD'], turnLeft: ['KeyQ', 'ArrowLeft'], turnRight: ['KeyE', 'ArrowRight'],
  ascend: ['KeyR'], descend: ['KeyF'], boost: ['ShiftLeft', 'ShiftRight'],
});

class FlightSimulator {
  constructor(canvas, mapCanvas, ui, getScene, getLabels, onClose) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true });
    this.ctx = this.gl ? null : canvas.getContext('2d');
    this.mapCanvas = mapCanvas;
    this.mapCtx = mapCanvas.getContext('2d');
    this.ui = ui;
    this.getScene = getScene;
    this.getLabels = getLabels;
    this.onClose = onClose;
    this.active = false;
    this.paused = false;
    this.keys = new Set();
    this.keyboardBindingCapture = null;
    this.last = 0;
    this.loopToken = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.passed = 0;
    this.started = false;
    this.finished = false;
    this.pos = [0, 0, 0.15];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.sceneBuilt = false;
    this.themeColors = Object.create(null);
    this.pathDistances = [0];
    this.pathLength = 0;
    this.routeProgress = 0;
    this.routeDirty = true;
    this.settingsOpen = false;
    this.resumeAfterSettings = false;
    this.gamepads = [];
    this.gamepadIndex = null;
    this.controllerSource = 'gamepad';
    this.gamepadSignature = '';
    this.coDronePort = null;
    this.coDroneReader = null;
    this.coDroneWriter = null;
    this.coDroneAxes = [0, 0, 0, 0];
    this.coDroneBuffer = new Uint8Array(0);
    this.coDroneLastPacket = 0;
    this.coDronePacketCount = 0;
    this.coDroneConnectedAt = 0;
    this.coDronePingTimer = 0;
    this.controllerCalibration = null;
    this.controllerCalibrationNotice = null;
    this.controllerStorageKey = 'droonirajaplaneerija.fpvpult';
    this.settingsStorageKey = 'droonirajaplaneerija.fpvcontrols';
    this.controls = this.loadControlSettings();
    this.liveInput = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    this.liveRowsBuilt = false;
    if (this.gl) this.initGL();
    this.bind();
  }

  initGL() {
    const gl = this.gl;
    const compile = (kind, source) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER,
      'attribute vec3 aPosition; attribute vec4 aColor; uniform mat4 uMatrix; varying vec4 vColor; void main(){ gl_Position=uMatrix*vec4(aPosition,1.0); vColor=aColor; gl_PointSize=2.0; }');
    const fs = compile(gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec4 vColor; void main(){ gl_FragColor=vColor; }');
    this.program = gl.createProgram(); gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    this.glAttrs = {
      position: gl.getAttribLocation(this.program, 'aPosition'), color: gl.getAttribLocation(this.program, 'aColor'),
      matrix: gl.getUniformLocation(this.program, 'uMatrix'),
    };
    this.glTriangles = gl.createBuffer(); this.glLines = gl.createBuffer();
    this.glRouteGlow = gl.createBuffer(); this.glRouteCore = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  glColor(color) {
    const s = String(color || '#94a3b8').trim();
    if (s[0] === '#') {
      const h = s.slice(1), full = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
      return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255, 1];
    }
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) { const v = m[1].split(',').map(Number); return [v[0] / 255, v[1] / 255, v[2] / 255, v[3] == null ? 1 : v[3]]; }
    return [0.58, 0.64, 0.72, 1];
  }

  glWorld(p) { return [p[0], p[2], p[1]]; }

  themeColor(name, fallback) {
    if (!(name in this.themeColors)) this.themeColors[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return this.themeColors[name] || fallback;
  }

  setTheme() {
    this.themeColors = Object.create(null);
    this.sceneBuilt = false;
    this.routeDirty = true;
    if (this.active) this.draw();
  }

  resetPathTrail() {
    this.pathDistances = [0];
    this.pathLength = 0;
    for (let i = 1; i < (this.scene?.path.length || 0); i++) {
      const a = this.scene.path[i - 1], b = this.scene.path[i];
      this.pathLength += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      this.pathDistances.push(this.pathLength);
    }
    this.routeProgress = 0;
    this.routeDirty = true;
  }

  routeAlpha(distanceAlongPath) {
    const behind = this.routeProgress - distanceAlongPath;
    if (behind <= 0) return 0.72;
    // Hoia trajektoor drooni vahetus läheduses peenike ja lase sellel
    // sujuvalt kaduda, et kaamera lähedal olev toru ei veniks üle ekraani.
    const fadeLength = 3.2;
    if (behind >= fadeLength) return 0;
    const t = behind / fadeLength;
    const fade = 1 - t * t * (3 - 2 * t);
    return 0.68 * fade;
  }

  updatePathTrail(dt) {
    if (!this.scene || this.scene.path.length < 2) return;
    const minDistance = Math.max(0, this.routeProgress - 0.8);
    const maxDistance = Math.min(this.pathLength, this.routeProgress + Math.max(0.28, Math.hypot(...this.vel) * dt * 2.2 + 0.12));
    let nearest = this.routeProgress, nearestSq = Infinity;
    for (let i = 1; i < this.scene.path.length; i++) {
      const a = this.scene.path[i - 1], b = this.scene.path[i], start = this.pathDistances[i - 1], end = this.pathDistances[i];
      const length = end - start;
      if (length < 1e-6 || end < minDistance || start > maxDistance) continue;
      const lo = Math.max(0, (minDistance - start) / length), hi = Math.min(1, (maxDistance - start) / length);
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const t = Math.max(lo, Math.min(hi, ((this.pos[0] - a[0]) * dx + (this.pos[1] - a[1]) * dy + (this.pos[2] - a[2]) * dz) / (length * length)));
      const x = a[0] + dx * t, y = a[1] + dy * t, z = a[2] + dz * t;
      const d2 = (this.pos[0] - x) ** 2 + (this.pos[1] - y) ** 2 + (this.pos[2] - z) ** 2;
      if (d2 < nearestSq) { nearestSq = d2; nearest = start + length * t; }
    }
    if (nearestSq < 64 && nearest > this.routeProgress + 0.025) {
      this.routeProgress = nearest;
      this.routeDirty = true;
    }
  }

  buildGLScene() {
    const triangles = [], lines = [];
    const addLine = (a, b, color) => { const col = this.glColor(color); lines.push(...this.glWorld(a), ...col, ...this.glWorld(b), ...col); };
    const addTube = (a, b, color, diameter) => {
      const delta = b.map((v, i) => v - a[i]), length = Math.hypot(...delta);
      if (length < 1e-6) return;
      const tangent = delta.map(v => v / length), ref = Math.abs(tangent[2]) > 0.92 ? [0, 1, 0] : [0, 0, 1];
      const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const u0 = cross(tangent, ref), uLength = Math.hypot(...u0) || 1, u = u0.map(v => v / uLength), v = cross(tangent, u);
      const radius = Math.max(0.007, Number(diameter) / 2), sides = 10, base = this.glColor(color);
      const light = [-0.35, -0.45, 0.82], lightLength = Math.hypot(...light), emit = (point, radial) => {
        const shade = 0.62 + 0.38 * Math.max(0, radial.reduce((sum, x, i) => sum + x * light[i] / lightLength, 0));
        const shaded = [base[0] * shade, base[1] * shade, base[2] * shade, base[3]];
        triangles.push(...this.glWorld(point), ...shaded);
      };
      for (let i = 0; i < sides; i++) {
        const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
        const radial0 = u.map((x, j) => x * Math.cos(a0) + v[j] * Math.sin(a0));
        const radial1 = u.map((x, j) => x * Math.cos(a1) + v[j] * Math.sin(a1));
        const offset = radial => radial.map(x => x * radius);
        const add = (p, o) => p.map((x, j) => x + o[j]);
        const a0p = add(a, offset(radial0)), a1p = add(a, offset(radial1));
        const b0p = add(b, offset(radial0)), b1p = add(b, offset(radial1));
        emit(a0p, radial0); emit(b0p, radial0); emit(a1p, radial1);
        emit(a1p, radial1); emit(b0p, radial0); emit(b1p, radial1);
      }
    };
    const addPoly = (pts, color) => {
      if (pts.length < 3) return;
      const col = this.glColor(color), base = this.glWorld(pts[0]);
      for (let i = 1; i < pts.length - 1; i++) triangles.push(...base, ...col, ...this.glWorld(pts[i]), ...col, ...this.glWorld(pts[i + 1]), ...col);
    };
    const addSolidPoly = (pts, color, thickness = 0.02) => {
      if (pts.length < 3) return;
      const a = pts[0], ab = pts[1].map((x, i) => x - a[i]), ac = pts[2].map((x, i) => x - a[i]);
      const normal0 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const nLength = Math.hypot(...normal0) || 1, normal = normal0.map(x => x / nLength);
      const back = pts.map(p => p.map((x, i) => x - normal[i] * thickness));
      addPoly(pts, color);
      addPoly(back, color);
      const baseColor = this.glColor(color), sideColor = `rgba(${Math.round(baseColor[0] * 255 * 0.58)},${Math.round(baseColor[1] * 255 * 0.58)},${Math.round(baseColor[2] * 255 * 0.58)},${baseColor[3]})`;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        addPoly([pts[i], pts[j], back[j], back[i]], sideColor);
      }
    };
    const h = this.scene.hall;
    addPoly([[0, 0, 0], [h.w, 0, 0], [h.w, h.l, 0], [0, h.l, 0]], this.themeColor('--sim-floor', '#cbd5e1'));
    const walls = [
      [[0, 0, 0], [h.w, 0, 0], [h.w, 0, h.h], [0, 0, h.h]],
      [[h.w, 0, 0], [h.w, h.l, 0], [h.w, h.l, h.h], [h.w, 0, h.h]],
      [[h.w, h.l, 0], [0, h.l, 0], [0, h.l, h.h], [h.w, h.l, h.h]],
      [[0, h.l, 0], [0, 0, 0], [0, 0, h.h], [0, h.l, h.h]],
    ];
    walls.forEach(p => addPoly(p, this.themeColor('--sim-wall-fill', 'rgba(226,232,240,.22)')));
    const grid = this.themeColor('--sim-grid-line', 'rgba(100,116,139,.25)');
    for (let x = 0; x <= h.w + 1e-6; x += 1) addLine([x, 0, 0.008], [x, h.l, 0.008], grid);
    for (let y = 0; y <= h.l + 1e-6; y += 1) addLine([0, y, 0.008], [h.w, y, 0.008], grid);
    for (const el of this.scene.elements) for (const p of el) p.k === 'p' ? addSolidPoly(p.pts, p.f || '#94a3b8') : addTube(p.a, p.b, p.c, p.w || 0.025);
    this.triangleCount = triangles.length / 7;
    this.lineCount = lines.length / 7;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glTriangles); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glLines); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    this.sceneBuilt = true;
  }

  updateGLRoute() {
    const rgb = this.themeColor('--sim-route-rgb', '124,58,237'), path = this.scene.path;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const normalize = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
    const sides = 10, light = normalize([-0.35, -0.45, 0.82]);
    const makeTube = (radius, alphaScale) => {
      const buffer = [], rings = [];
      let previousSide = null;
      for (let i = 0; i < path.length; i++) {
        const before = path[Math.max(0, i - 1)], after = path[Math.min(path.length - 1, i + 1)];
        const tangent = normalize(after.map((x, j) => x - before[j]));
        let side = previousSide && previousSide.map((x, j) => x - tangent[j] * previousSide.reduce((sum, q, k) => sum + q * tangent[k], 0));
        if (!side || Math.hypot(...side) < 1e-5) {
          const ref = Math.abs(tangent[2]) > 0.92 ? [0, 1, 0] : [0, 0, 1];
          side = cross(tangent, ref);
        }
        side = normalize(side);
        const up = normalize(cross(tangent, side));
        previousSide = side;
        const alpha = this.routeAlpha(this.pathDistances[i]) * alphaScale;
        const ring = [];
        for (let j = 0; j < sides; j++) {
          const angle = j / sides * Math.PI * 2;
          const radial = side.map((x, k) => x * Math.cos(angle) + up[k] * Math.sin(angle));
          ring.push({ point: path[i].map((x, k) => x + radial[k] * radius), radial, alpha });
        }
        rings.push(ring);
      }
      const emit = vertex => {
        const color = this.glColor(`rgba(${rgb},${vertex.alpha})`);
        const shade = 0.72 + 0.28 * Math.max(0, vertex.radial.reduce((sum, x, i) => sum + x * light[i], 0));
        buffer.push(...this.glWorld(vertex.point), color[0] * shade, color[1] * shade, color[2] * shade, color[3]);
      };
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
        const next = (j + 1) % sides, a = rings[i][j], b = rings[i + 1][j], c = rings[i][next], d = rings[i + 1][next];
        emit(a); emit(b); emit(c);
        emit(c); emit(b); emit(d);
      }
      return buffer;
    };
    // Väike maailmaruumi läbimõõt hoiab joone ka FPV-kaamera lähedal kitsana.
    const glow = makeTube(0.010, 0.045), core = makeTube(0.0035, 1);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glRouteGlow);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(glow), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glRouteCore);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(core), gl.DYNAMIC_DRAW);
    this.routeGlowCount = glow.length / 7;
    this.routeCoreCount = core.length / 7;
    this.routeDirty = false;
  }

  lookAt(eye, target, up) {
    const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(eye.map((v, i) => v - target[i])), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }

  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  multiply4(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  }

  drawWebGL() {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    if (!this.sceneBuilt) this.buildGLScene();
    if (this.routeDirty) this.updateGLRoute();
    gl.viewport(0, 0, w, h);
    const background = this.glColor(this.themeColor('--sim-sky-top', '#7dd3fc'));
    gl.clearColor(background[0], background[1], background[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const eye = this.glWorld([this.pos[0], this.pos[1], this.pos[2] + 0.08]);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const forward = [Math.cos(this.yaw) * cp, sp, Math.sin(this.yaw) * cp];
    const target = eye.map((v, i) => v + forward[i]);
    const view = this.lookAt(eye, target, [0, 1, 0]);
    const proj = this.perspective(Math.PI / 2.25, w / Math.max(1, h), 0.08, 150);
    gl.useProgram(this.program); gl.uniformMatrix4fv(this.glAttrs.matrix, false, this.multiply4(proj, view));
    gl.enableVertexAttribArray(this.glAttrs.position); gl.enableVertexAttribArray(this.glAttrs.color);
    const bind = buffer => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(this.glAttrs.position, 3, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(this.glAttrs.color, 4, gl.FLOAT, false, 28, 12);
    };
    bind(this.glTriangles); gl.drawArrays(gl.TRIANGLES, 0, this.triangleCount);
    bind(this.glLines); gl.lineWidth(1.5); gl.drawArrays(gl.LINES, 0, this.lineCount);
    gl.depthMask(false);
    bind(this.glRouteGlow); gl.drawArrays(gl.TRIANGLES, 0, this.routeGlowCount);
    bind(this.glRouteCore); gl.drawArrays(gl.TRIANGLES, 0, this.routeCoreCount);
    gl.depthMask(true);
  }

  bind() {
    this.onKeyDown = e => {
      if (!this.active) return;
      if (this.keyboardBindingCapture) { this.handleKeyboardBindingCapture(e); return; }
      if (this.settingsOpen) {
        if (e.code === 'Escape') { e.preventDefault(); this.closeSettings(); }
        if (e.code === 'Tab') {
          const focusable = [...this.ui.settings.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
          if (!focusable.length) { e.preventDefault(); return; }
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Escape') { this.close(); return; }
      if (e.code === 'Space' && !e.repeat) { this.pause(); return; }
      this.keys.add(e.code);
    };
    this.onKeyUp = e => this.keys.delete(e.code);
    this.onBlur = () => { this.keys.clear(); this.cancelKeyboardBindingCapture(false); };
    this.onGamepadChange = () => this.scanGamepads(false);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onGamepadChange);
    window.addEventListener('gamepaddisconnected', this.onGamepadChange);
  }

  openSettings() {
    if (!this.active || this.settingsOpen) return;
    this.settingsOpen = true;
    this.resumeAfterSettings = !this.paused;
    if (!this.paused) this.pause();
    this.ui.settings.hidden = false;
    this.refreshSettings();
    this.ui.settingsClose.focus();
  }

  closeSettings() {
    if (!this.settingsOpen) return;
    this.cancelControllerCalibration();
    this.cancelKeyboardBindingCapture(false);
    this.settingsOpen = false;
    this.ui.settings.hidden = true;
    if (this.resumeAfterSettings && this.paused) this.pause();
    this.resumeAfterSettings = false;
    this.ui.settingsOpen.focus();
    this.ui.settingsClosed?.();
  }

  loadControlSettings() {
    const defaults = {
      mode: 'keyboard', deadzone: 0.03,
      channelProfileVersion: 1,
      keyboard: defaultKeyboardBindings(),
      channels: {
        throttle: { axis: 1, invert: true }, roll: { axis: 2, invert: false },
        pitch: { axis: 3, invert: true }, yaw: { axis: 0, invert: false },
      },
      coDroneChannels: coDroneDefaultChannels(),
      coDroneCustomized: false,
    };
    try {
      const stored = JSON.parse(localStorage.getItem(this.settingsStorageKey));
      if (!stored || typeof stored !== 'object') return defaults;
      defaults.mode = stored.mode === 'controller' ? 'controller' : 'keyboard';
      defaults.coDroneCustomized = stored.coDroneCustomized === true;
      defaults.deadzone = Number.isFinite(stored.deadzone) ? Math.max(0, Math.min(0.2, stored.deadzone)) : defaults.deadzone;
      const usedKeys = new Set();
      for (const action of Object.keys(defaults.keyboard)) {
        const saved = Array.isArray(stored.keyboard?.[action]) ? stored.keyboard[action] : defaults.keyboard[action];
        let binding = saved.filter(code => typeof code === 'string' && code.length <= 24 && !usedKeys.has(code));
        if (!binding.length) binding = defaults.keyboard[action].filter(code => !usedKeys.has(code));
        defaults.keyboard[action] = binding.length ? binding : defaults.keyboard[action];
        defaults.keyboard[action].forEach(code => usedKeys.add(code));
      }
      for (const key of Object.keys(defaults.channels)) {
        if (stored.channelProfileVersion === 1 && stored.channels && stored.channels[key]) {
          const channel = stored.channels[key];
          if (Number.isInteger(channel.axis) && channel.axis >= 0 && channel.axis < 32) defaults.channels[key].axis = channel.axis;
          defaults.channels[key].invert = Boolean(channel.invert);
        }
        if (stored.coDroneChannels && stored.coDroneChannels[key]) {
          const channel = stored.coDroneChannels[key];
          if (Number.isInteger(channel.axis) && channel.axis >= 0 && channel.axis < 4) defaults.coDroneChannels[key].axis = channel.axis;
          defaults.coDroneChannels[key].invert = Boolean(channel.invert);
        }
      }
    } catch (e) { /* salvestus pole saadaval */ }
    return defaults;
  }

  saveControlSettings() {
    try { localStorage.setItem(this.settingsStorageKey, JSON.stringify(this.controls)); } catch (e) { /* salvestus pole saadaval */ }
  }

  activeChannels() {
    return this.controllerSource === 'codrone' ? this.controls.coDroneChannels : this.controls.channels;
  }

  setControlMode(mode) {
    if (mode !== 'keyboard') this.cancelKeyboardBindingCapture(false);
    if (mode !== 'controller') this.cancelControllerCalibration();
    this.controls.mode = mode === 'controller' ? 'controller' : 'keyboard';
    this.keys.clear();
    this.saveControlSettings();
    this.refreshSettings();
    this.updateControlHint();
  }

  setDeadzone(value) {
    this.controls.deadzone = Math.max(0, Math.min(0.2, Number(value) || 0));
    this.saveControlSettings();
    this.refreshSettings();
  }

  setChannelAxis(channel, axis) {
    const channels = this.activeChannels();
    if (!channels[channel]) return;
    channels[channel].axis = Math.max(0, Math.min(this.controllerSource === 'codrone' ? 3 : 31, Number(axis) || 0));
    this.saveControlSettings();
    this.buildControlRows();
  }

  setChannelInvert(channel, checked) {
    const channels = this.activeChannels();
    if (!channels[channel]) return;
    channels[channel].invert = Boolean(checked);
    this.saveControlSettings();
    this.refreshLiveInput();
  }

  refreshSettings() {
    if (!this.settingsOpen) return;
    this.ui.settings.querySelectorAll('input[name="simControlMode"]').forEach(input => { input.checked = input.value === this.controls.mode; });
    this.ui.radioSettings.hidden = this.controls.mode !== 'controller';
    this.ui.keyboardHelp.hidden = this.controls.mode !== 'keyboard';
    this.ui.deadzone.value = String(this.controls.deadzone * 100);
    this.ui.deadzoneValue.value = `${(this.controls.deadzone * 100).toFixed(1)}%`;
    if (this.controls.mode === 'controller') {
      this.scanGamepads(false);
      this.buildControlRows();
      this.refreshLiveInput();
    } else {
      this.buildKeyboardBindings();
    }
  }

  buildKeyboardBindings() {
    if (!this.settingsOpen || !this.ui.keyboardBindings) return;
    const labels = this.getLabels(), names = {
      forward: labels.keyboardForward, backward: labels.keyboardBackward, left: labels.keyboardLeft, right: labels.keyboardRight,
      turnLeft: labels.keyboardYawLeft, turnRight: labels.keyboardYawRight, ascend: labels.keyboardAscend,
      descend: labels.keyboardDescend, boost: labels.keyboardBoost,
    };
    this.ui.keyboardBindings.replaceChildren();
    for (const [action, label] of Object.entries(names)) {
      const row = document.createElement('div'); row.className = 'sim-keyboard-row';
      const name = document.createElement('span'); name.textContent = label;
      const current = document.createElement('kbd'); current.textContent = this.formatKeyBinding(this.controls.keyboard[action]);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.keyAction = action;
      button.textContent = this.keyboardBindingCapture === action ? labels.keyboardPressKey : labels.keyboardChange;
      button.addEventListener('click', () => this.startKeyboardBindingCapture(action));
      row.append(name, current, button);
      this.ui.keyboardBindings.append(row);
    }
    if (this.ui.keyboardReset) this.ui.keyboardReset.onclick = () => this.resetKeyboardBindings();
  }

  formatKeyBinding(codes) {
    const labels = this.getLabels();
    const friendly = {
      ArrowUp: labels.keyboardKeyArrowUp, ArrowDown: labels.keyboardKeyArrowDown,
      ArrowLeft: labels.keyboardKeyArrowLeft, ArrowRight: labels.keyboardKeyArrowRight,
      ShiftLeft: labels.keyboardKeyShift, ShiftRight: labels.keyboardKeyShift,
      Space: labels.keyboardKeySpace,
    };
    const names = codes.map(code => friendly[code] || (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code.replace('Numpad', 'Num ')));
    return [...new Set(names)].join(' / ');
  }

  startKeyboardBindingCapture(action) {
    if (this.keyboardBindingCapture === action) {
      this.keyboardBindingCapture = null;
      this.ui.keyboardBindingStatus.textContent = this.getLabels().keyboardCaptureCancelled;
    } else {
      this.keyboardBindingCapture = action;
      this.ui.keyboardBindingStatus.textContent = this.getLabels().keyboardPressKey;
    }
    this.buildKeyboardBindings();
    this.ui.keyboardBindings.querySelector(`[data-key-action="${action}"]`)?.focus();
  }

  cancelKeyboardBindingCapture(showMessage = true) {
    const action = this.keyboardBindingCapture;
    if (!action) return;
    this.keyboardBindingCapture = null;
    if (showMessage && this.ui.keyboardBindingStatus) this.ui.keyboardBindingStatus.textContent = this.getLabels().keyboardCaptureCancelled;
    this.buildKeyboardBindings();
  }

  handleKeyboardBindingCapture(event) {
    const action = this.keyboardBindingCapture;
    if (!action) return false;
    event.preventDefault();
    if (event.code === 'Escape') {
      this.cancelKeyboardBindingCapture(true);
      this.ui.keyboardBindings.querySelector(`[data-key-action="${action}"]`)?.focus();
      return true;
    }
    const labels = this.getLabels();
    if (event.code === 'Tab' || /^(Control|Alt|Meta)/.test(event.code)) return true;
    if (event.code === 'Space') {
      this.ui.keyboardBindingStatus.textContent = labels.keyboardKeyUnavailable;
      return true;
    }
    const duplicate = Object.entries(this.controls.keyboard).find(([other, codes]) => other !== action && codes.includes(event.code));
    if (duplicate) {
      this.ui.keyboardBindingStatus.textContent = `${labels.keyboardKeyInUse} ${this.keyboardActionLabel(duplicate[0])}`;
      return true;
    }
    this.controls.keyboard[action] = [event.code];
    this.keyboardBindingCapture = null;
    this.ui.keyboardBindingStatus.textContent = '';
    this.keys.clear();
    this.saveControlSettings();
    this.buildKeyboardBindings();
    this.updateControlHint();
    this.ui.keyboardBindings.querySelector(`[data-key-action="${action}"]`)?.focus();
    return true;
  }

  keyboardActionLabel(action) {
    const labels = this.getLabels();
    return ({ forward: labels.keyboardForward, backward: labels.keyboardBackward, left: labels.keyboardLeft, right: labels.keyboardRight,
      turnLeft: labels.keyboardYawLeft, turnRight: labels.keyboardYawRight, ascend: labels.keyboardAscend,
      descend: labels.keyboardDescend, boost: labels.keyboardBoost })[action] || action;
  }

  resetKeyboardBindings() {
    this.keyboardBindingCapture = null;
    this.controls.keyboard = defaultKeyboardBindings();
    this.keys.clear();
    this.saveControlSettings();
    this.ui.keyboardBindingStatus.textContent = this.getLabels().keyboardResetDone;
    this.buildKeyboardBindings();
    this.updateControlHint();
  }

  buildControlRows() {
    if (!this.settingsOpen) return;
    const labels = this.getLabels();
    const channels = ['throttle', 'roll', 'pitch', 'yaw'];
    if (!this.liveRowsBuilt) {
      this.ui.liveRows.replaceChildren();
      for (const key of channels) {
        const row = document.createElement('div'); row.className = 'sim-live-row'; row.dataset.channel = key;
        const name = document.createElement('span'); name.className = 'sim-live-name'; name.textContent = labels['channel' + key[0].toUpperCase() + key.slice(1)];
        const track = document.createElement('div'); track.className = `sim-live-track${key === 'throttle' ? ' throttle' : ''}`;
        const fill = document.createElement('i'); fill.className = 'sim-live-fill'; track.append(fill);
        const value = document.createElement('b'); value.className = 'sim-live-value';
        const invertLabel = document.createElement('label'); invertLabel.className = 'sim-live-invert';
        const invert = document.createElement('input'); invert.type = 'checkbox'; invert.setAttribute('aria-label', `${labels['channel' + key[0].toUpperCase() + key.slice(1)]} · ${labels.invertLabel}`);
        invert.addEventListener('change', () => this.setChannelInvert(key, invert.checked));
        invertLabel.append(invert);
        row.append(name, track, value, invertLabel);
        this.ui.liveRows.append(row);
      }
      this.liveRowsBuilt = true;
    }
    this.ui.axisSettings.replaceChildren();
    const selected = this.gamepads.find(p => p.index === this.gamepadIndex);
    const axisCount = this.controllerSource === 'codrone' && this.coDronePort ? 4 : (selected ? selected.axes.length : 0);
    for (const key of channels) {
      const row = document.createElement('label'); row.className = 'sim-axis-row';
      const name = document.createElement('span'); name.textContent = labels['channel' + key[0].toUpperCase() + key.slice(1)];
      const select = document.createElement('select'); select.dataset.channel = key;
      const count = axisCount;
      if (!count) {
        const option = document.createElement('option'); option.value = ''; option.textContent = labels.settingsNoAxes; select.append(option); select.disabled = true;
      } else {
        for (let i = 0; i < count; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `${labels.controllerAxes} ${i + 1}`; select.append(option); }
        const mappings = this.activeChannels(), axis = mappings[key].axis;
        if (axis >= count) mappings[key].axis = Math.min(count - 1, ({ throttle: 1, roll: 2, pitch: 3, yaw: 0 })[key]);
        select.value = String(mappings[key].axis);
        select.addEventListener('change', () => this.setChannelAxis(key, select.value));
      }
      row.append(name, select); this.ui.axisSettings.append(row);
    }
    this.ui.liveRows.querySelectorAll('.sim-live-row').forEach(row => {
      const key = row.dataset.channel;
      row.querySelector('.sim-live-name').textContent = labels['channel' + key[0].toUpperCase() + key.slice(1)];
      row.querySelector('.sim-live-invert input').setAttribute('aria-label', `${labels['channel' + key[0].toUpperCase() + key.slice(1)]} · ${labels.invertLabel}`);
      row.querySelector('.sim-live-invert input').checked = this.activeChannels()[key].invert;
    });
    this.saveControlSettings();
  }

  updateControlHint() {
    if (!this.ui.controlHint) return;
    const labels = this.getLabels();
    this.ui.controlHint.textContent = this.controls.mode === 'controller' ? labels.settingsControllerHint : labels.keyboardHelp;
  }

  readControllerInput() {
    const values = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
    this.gamepadAvailable = false;
    if (this.controls.mode !== 'controller') return values;
    if (this.controllerSource === 'codrone' && this.coDronePort) {
      // Kui jadaside hangub, ära hoia viimast juhtkäsku aktiivsena.
      if (!this.coDroneLastPacket || Date.now() - this.coDroneLastPacket > 1200) return values;
      this.gamepadAvailable = true;
      for (const key of Object.keys(values)) {
        const mapping = this.controls.coDroneChannels[key];
        let value = Number(this.coDroneAxes[mapping.axis]) || 0;
        if (mapping.invert) value *= -1;
        const magnitude = Math.abs(value), dz = this.controls.deadzone;
        values[key] = magnitude <= dz ? 0 : Math.sign(value) * (magnitude - dz) / (1 - dz);
      }
      return values;
    }
    if (this.gamepadIndex == null || !navigator.getGamepads) return values;
    try {
      const pad = navigator.getGamepads()[this.gamepadIndex];
      if (!pad || !pad.connected) return values;
      this.gamepadAvailable = true;
      for (const key of Object.keys(values)) {
        const mapping = this.controls.channels[key];
        let value = Number(pad.axes[mapping.axis]) || 0;
        if (mapping.invert) value *= -1;
        const magnitude = Math.abs(value), dz = this.controls.deadzone;
        values[key] = magnitude <= dz ? 0 : Math.sign(value) * (magnitude - dz) / (1 - dz);
      }
    } catch (e) { /* seade eemaldati lugemise ajal */ }
    return values;
  }

  refreshLiveInput() {
    this.liveInput = this.readControllerInput();
    this.updateCalibrationAvailability();
    if (!this.settingsOpen || this.controls.mode !== 'controller') return;
    if (this.controllerCalibration && Date.now() - this.controllerCalibration.phaseStarted > 12000) this.failControllerCalibration();
    const rawAxes = this.readRawControllerAxes();
    if (this.controllerCalibration && rawAxes) this.advanceControllerCalibration(rawAxes);
    if (this.controllerSource === 'codrone' && this.coDronePort) {
      const labels = this.getLabels(), age = Date.now() - (this.coDroneLastPacket || this.coDroneConnectedAt);
      if (this.controllerCalibrationNotice && this.controllerCalibrationNotice.until > Date.now()) {
        this.ui.controllerState.textContent = this.controllerCalibrationNotice.text;
      } else if (this.controllerCalibration) {
        // Kalibreerimise samm jääb nähtavale kuni järgmise sisendi tuvastamiseni.
      } else if (!this.coDronePacketCount) {
        this.ui.controllerState.textContent = age > 2500 ? labels.codroneNoData : labels.codroneWaiting;
      } else if (age > 2500) {
        this.ui.controllerState.textContent = labels.codroneNoData;
        this.ui.controllerState.classList.remove('connected');
      } else {
        this.ui.controllerState.textContent = labels.codroneConnected;
        this.ui.controllerState.classList.add('connected');
      }
    }
    const rows = this.ui.liveRows.querySelectorAll('.sim-live-row');
    rows.forEach(row => {
      const key = row.dataset.channel, value = this.liveInput[key];
      const fill = row.querySelector('.sim-live-fill'), output = row.querySelector('.sim-live-value');
      if (key === 'throttle') {
        const pct = Math.round((value + 1) * 50);
        fill.style.width = `${pct}%`; output.textContent = `${pct}%`;
      } else {
        const pct = Math.min(50, Math.abs(value) * 50);
        fill.style.width = `${pct}%`; fill.style.left = value < 0 ? `${50 - pct}%` : '50%';
        output.textContent = `${Math.round(value * 100)}%`;
      }
    });
    this.updateStickVisual();
  }

  readRawControllerAxes() {
    if (this.controllerSource === 'codrone' && this.coDronePort) {
      return Date.now() - this.coDroneLastPacket <= 1200 ? this.coDroneAxes.slice() : null;
    }
    if (this.controllerSource !== 'gamepad' || this.gamepadIndex == null || !navigator.getGamepads) return null;
    try {
      const pad = navigator.getGamepads()[this.gamepadIndex];
      return pad?.connected ? Array.from(pad.axes, value => Number(value) || 0) : null;
    } catch (e) { return null; }
  }

  updateCalibrationAvailability() {
    const button = this.ui.controllerCalibrate;
    if (!button) return;
    const axes = this.readRawControllerAxes();
    const connected = Boolean(axes && axes.length >= 4);
    button.disabled = Boolean(this.controllerCalibration || !connected);
  }

  cancelControllerCalibration() {
    const calibration = this.controllerCalibration;
    if (!calibration) return;
    if (calibration.source === 'codrone') this.controls.coDroneChannels = calibration.original;
    else this.controls.channels = calibration.original;
    this.controllerCalibration = null;
    this.saveControlSettings();
    this.updateCalibrationAvailability();
  }

  updateStickVisual() {
    if (!this.ui.stickVisual) return;
    const labels = this.getLabels();
    const connected = this.gamepadAvailable;
    this.ui.stickVisual.classList.toggle('connected', connected);
    if (this.controllerSource === 'codrone' && this.coDronePort) {
      this.ui.stickDevice.textContent = labels.codroneName;
    } else if (connected) {
      const selected = this.gamepads.find(p => p.index === this.gamepadIndex);
      this.ui.stickDevice.textContent = selected?.id || labels.controllerDevice;
    } else {
      this.ui.stickDevice.textContent = labels.controllerNone;
    }

    // Kasuta aktiivsete juhtkanalite väärtusi, nii järgib pilt ka kasutaja telgede seadeid.
    const place = (marker, x, y, originX) => {
      const dx = Math.max(-1, Math.min(1, x)) * 26;
      const dy = Math.max(-1, Math.min(1, y)) * 26;
      marker.setAttribute('transform', `translate(${originX + dx} ${105 + dy})`);
    };
    place(this.ui.stickLeft, this.liveInput.yaw, -this.liveInput.throttle, 78);
    place(this.ui.stickRight, this.liveInput.roll, -this.liveInput.pitch, 222);
  }

  openController() {
    this.openSettings();
    this.setControlMode('controller');
  }

  closeController() {
    this.closeSettings();
  }

  selectGamepad(indexValue) {
    this.cancelControllerCalibration();
    if (indexValue === 'codrone' && this.coDronePort) {
      this.controllerSource = 'codrone';
      this.buildControlRows();
      this.refreshLiveInput();
      return;
    }
    this.controllerSource = 'gamepad';
    const index = indexValue === '' ? null : Number(indexValue);
    this.gamepadIndex = Number.isInteger(index) ? index : null;
    const selected = this.gamepads.find(p => p.index === this.gamepadIndex);
    try {
      if (selected) localStorage.setItem(this.controllerStorageKey, selected.id);
      else localStorage.removeItem(this.controllerStorageKey);
    } catch (e) { /* salvestus pole saadaval */ }
    this.renderGamepads(true);
    this.buildControlRows();
    this.refreshLiveInput();
  }

  async toggleCoDrone() {
    if (this.coDronePort) return this.disconnectCoDrone();
    const labels = this.getLabels();
    if (!navigator.serial) {
      this.ui.controllerState.textContent = labels.codroneUnsupported;
      this.ui.controllerState.classList.remove('connected');
      return;
    }
    this.ui.coDroneConnect.disabled = true;
    this.ui.controllerState.textContent = labels.codroneWaiting;
    this.ui.controllerState.classList.remove('connected');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none' });
      this.coDronePort = port;
      // CoDrone EDU telgede paigutus on kindel. Rakenda see igal ühendamisel,
      // et varasem käsitsi või ekslikult salvestatud seadistus ei juhiks valesti.
      if (!this.controls.coDroneCustomized) this.controls.coDroneChannels = coDroneDefaultChannels();
      this.saveControlSettings();
      this.coDroneAxes = [0, 0, 0, 0];
      this.coDroneBuffer = new Uint8Array(0);
      this.coDroneLastPacket = 0;
      this.coDronePacketCount = 0;
      this.coDroneDisconnectMessage = '';
      this.coDroneConnectedAt = Date.now();
      this.controllerCalibration = null;
      this.controllerCalibrationNotice = null;
      this.controllerSource = 'codrone';
      this.coDroneWriter = port.writable.getWriter();
      this.coDroneReader = port.readable.getReader();
      this.ui.coDroneConnect.textContent = labels.codroneDisconnect;
      this.ui.coDroneConnect.disabled = false;
      this.updateCalibrationAvailability();
      this.setControlMode('controller');
      this.scanGamepads(true);
      this.ui.controllerState.textContent = labels.codroneWaiting;
      const reader = this.coDroneReader;
      void this.readCoDrone(reader, port);
      this.coDronePingTimer = window.setInterval(() => { void this.sendCoDronePing(); }, 160);
    } catch (error) {
      this.ui.coDroneConnect.disabled = false;
      const message = error?.name === 'NotFoundError' ? labels.codroneError : `${labels.codroneError}: ${error?.message || error}`;
      if (this.coDronePort) await this.disconnectCoDrone(message);
      this.ui.controllerState.textContent = message;
      this.ui.controllerState.classList.remove('connected');
    }
  }

  coDroneCrc(bytes) {
    let crc = 0x0000;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  async sendCoDronePing() {
    if (!this.coDroneWriter) return;
    // CoDrone EDU: Ping (0x01), Base (0x70) -> Controller (0x20).
    const stamp = Date.now();
    const payload = [stamp & 0xff, (stamp >>> 8) & 0xff, (stamp >>> 16) & 0xff, (stamp >>> 24) & 0xff, 0, 0, 0, 0];
    const body = new Uint8Array([0x01, payload.length, 0x70, 0x20, ...payload]);
    const crc = this.coDroneCrc(body);
    const packet = new Uint8Array([0x0a, 0x55, ...body, crc & 0xff, crc >>> 8]);
    try { await this.coDroneWriter.write(packet); }
    catch (error) {
      this.ui.controllerState.textContent = `${this.getLabels().codroneError}: ${error?.message || error}`;
      this.ui.controllerState.classList.remove('connected');
    }
  }

  readCoDrone(reader, port) {
    return (async () => {
      try {
        while (this.coDronePort === port) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) this.parseCoDroneBytes(value);
        }
      } catch (error) {
        let disconnectMessage = '';
        if (this.coDronePort === port) {
          disconnectMessage = `${this.getLabels().codroneError}: ${error?.message || error}`;
        }
        if (disconnectMessage) this.coDroneDisconnectMessage = disconnectMessage;
      } finally {
        try { reader.releaseLock(); } catch (error) { /* lugemislukk vabastati juba */ }
        if (this.coDronePort === port) await this.disconnectCoDrone(this.coDroneDisconnectMessage || this.getLabels().codroneNoData);
      }
    })();
  }

  parseCoDroneBytes(chunk) {
    const joined = new Uint8Array(this.coDroneBuffer.length + chunk.length);
    joined.set(this.coDroneBuffer); joined.set(chunk, this.coDroneBuffer.length);
    let offset = 0;
    while (offset + 8 <= joined.length) {
      if (joined[offset] !== 0x0a || joined[offset + 1] !== 0x55) { offset++; continue; }
      const length = joined[offset + 3], frameLength = length + 8;
      if (offset + frameLength > joined.length) break;
      const body = joined.subarray(offset + 2, offset + 6 + length);
      const actualCrc = joined[offset + 6 + length] | (joined[offset + 7 + length] << 8);
      if (this.coDroneCrc(body) !== actualCrc) { offset++; continue; }
      if (joined[offset + 2] === 0x71 && length === 8) {
        // Payload = left(x,y,direction,event), right(x,y,direction,event).
        // x ja y on signed 8-bit väärtused vahemikus -100…100.
        const readAxis = index => {
          const raw = body[4 + index];
          const signed = raw > 0x7f ? raw - 0x100 : raw;
          return Math.max(-1, Math.min(1, signed / 100));
        };
        this.coDroneAxes = [readAxis(0), readAxis(1), readAxis(4), readAxis(5)];
        this.coDroneLastPacket = Date.now();
        this.coDronePacketCount++;
        if (this.settingsOpen && this.controllerSource === 'codrone' && !this.controllerCalibration && !(this.controllerCalibrationNotice && this.controllerCalibrationNotice.until > Date.now())) {
          this.ui.controllerState.textContent = this.getLabels().codroneConnected;
          this.ui.controllerState.classList.add('connected');
          this.ui.controllerCounts.textContent = `${this.getLabels().codroneAxes}: 4`;
        }
      }
      offset += frameLength;
    }
    this.coDroneBuffer = joined.slice(offset);
    if (this.coDroneBuffer.length > 2048) this.coDroneBuffer = this.coDroneBuffer.slice(-16);
  }

  startControllerCalibration() {
    const axes = this.readRawControllerAxes();
    if (!axes || axes.length < 4) return;
    const channels = this.activeChannels();
    this.controllerCalibration = {
      source: this.controllerSource, phase: 'center', step: 0, samples: [], center: [], usedAxes: [],
      phaseStarted: Date.now(), original: JSON.parse(JSON.stringify(channels)),
    };
    this.controllerCalibrationNotice = null;
    this.ui.controllerCalibrate.disabled = true;
    this.ui.controllerState.textContent = this.getLabels().controllerCenter;
    this.buildControlRows();
    this.refreshLiveInput();
  }

  advanceControllerCalibration(axes) {
    const calibration = this.controllerCalibration;
    if (!calibration || calibration.source !== this.controllerSource) return;
    const labels = this.getLabels();
    const channels = ['throttle', 'roll', 'pitch', 'yaw'];
    const prompts = [labels.controllerMoveThrottle, labels.controllerMoveRoll, labels.controllerMovePitch, labels.controllerMoveYaw];
    const sourceChannels = calibration.source === 'codrone' ? this.controls.coDroneChannels : this.controls.channels;
    if (calibration.phase === 'center') {
      calibration.samples.push(axes.slice());
      if (calibration.samples.length < 8) return;
      calibration.center = axes.map((_, axis) => calibration.samples.reduce((sum, sample) => sum + (sample[axis] || 0), 0) / calibration.samples.length);
      calibration.phase = 'move';
      calibration.phaseStarted = Date.now();
      this.ui.controllerState.textContent = prompts[calibration.step];
      return;
    }
    if (Date.now() - calibration.phaseStarted > 12000) {
      this.failControllerCalibration();
      return;
    }
    if (calibration.phase === 'move') {
      const deltas = axes.map((value, axis) => value - (calibration.center[axis] || 0));
      let axis = -1, magnitude = 0;
      for (let i = 0; i < deltas.length; i++) {
        if (calibration.usedAxes.includes(i)) continue;
        if (Math.abs(deltas[i]) > magnitude) { axis = i; magnitude = Math.abs(deltas[i]); }
      }
      if (axis < 0 || magnitude < 0.35) return;
      const channel = channels[calibration.step];
      sourceChannels[channel] = { axis, invert: deltas[axis] < 0 };
      calibration.usedAxes.push(axis);
      calibration.releaseAxis = axis;
      calibration.phase = 'release';
      calibration.phaseStarted = Date.now();
      this.saveControlSettings();
      this.buildControlRows();
      this.ui.controllerState.textContent = labels.controllerRelease;
      return;
    }
    if (calibration.phase === 'release' && Math.abs((axes[calibration.releaseAxis] || 0) - (calibration.center[calibration.releaseAxis] || 0)) < 0.18) {
      calibration.step++;
      if (calibration.step >= channels.length) {
        this.controllerCalibration = null;
        if (calibration.source === 'codrone') this.controls.coDroneCustomized = true;
        this.ui.controllerState.textContent = labels.controllerCalibrationDone;
        this.ui.controllerState.classList.add('connected');
        this.controllerCalibrationNotice = { text: labels.controllerCalibrationDone, until: Date.now() + 5000 };
        this.saveControlSettings();
        this.buildControlRows();
        this.updateCalibrationAvailability();
      } else {
        calibration.phase = 'move';
        calibration.phaseStarted = Date.now();
        this.ui.controllerState.textContent = prompts[calibration.step];
      }
    }
  }

  failControllerCalibration() {
    const calibration = this.controllerCalibration;
    if (!calibration) return;
    if (calibration.source === 'codrone') this.controls.coDroneChannels = calibration.original;
    else this.controls.channels = calibration.original;
    this.controllerCalibration = null;
    this.ui.controllerState.textContent = this.getLabels().controllerCalibrationFailed;
    this.controllerCalibrationNotice = { text: this.getLabels().controllerCalibrationFailed, until: Date.now() + 5000 };
    this.saveControlSettings();
    this.buildControlRows();
    this.updateCalibrationAvailability();
  }

  async disconnectCoDrone(finalMessage = '') {
    this.cancelControllerCalibration();
    const port = this.coDronePort, reader = this.coDroneReader, writer = this.coDroneWriter;
    this.coDronePort = null; this.coDroneReader = null; this.coDroneWriter = null;
    window.clearInterval(this.coDronePingTimer); this.coDronePingTimer = 0;
    this.coDroneAxes = [0, 0, 0, 0]; this.coDroneBuffer = new Uint8Array(0);
    this.coDronePacketCount = 0; this.coDroneLastPacket = 0;
    this.controllerCalibration = null;
    this.controllerCalibrationNotice = null;
    if (reader) {
      try { await reader.cancel(); } catch (error) { /* port võis lahti ühendada */ }
      try { reader.releaseLock(); } catch (error) { /* lugemislukk vabastati juba */ }
    }
    if (writer) { try { writer.releaseLock(); } catch (error) { /* kirjutuslukk vabastati juba */ } }
    if (port) { try { await port.close(); } catch (error) { /* port sulgus juba */ } }
    this.ui.coDroneConnect.disabled = false;
    this.ui.coDroneConnect.textContent = this.getLabels().codroneConnect;
    this.updateCalibrationAvailability();
    this.controllerSource = 'gamepad';
    this.scanGamepads(true);
    if (finalMessage) {
      this.ui.controllerState.textContent = finalMessage;
      this.ui.controllerState.classList.remove('connected');
    }
  }

  scanGamepads(force) {
    if (!this.ui.controllerSelect || !this.active) return;
    if (!navigator.getGamepads) {
      this.gamepads = [];
      this.gamepadIndex = null;
      this.renderGamepads(true, true);
      this.buildControlRows();
      return;
    }
    let pads = [];
    try { pads = Array.from(navigator.getGamepads() || []).filter(p => p && p.connected); } catch (e) { /* brauser ei saanud seadmeid lugeda */ }
    this.gamepads = pads;
    const current = pads.find(p => p.index === this.gamepadIndex);
    let preferred = '';
    try { preferred = localStorage.getItem(this.controllerStorageKey) || ''; } catch (e) { /* salvestus pole saadaval */ }
    const selected = current || pads.find(p => p.id === preferred) || pads[0] || null;
    this.gamepadIndex = selected ? selected.index : null;
    this.renderGamepads(Boolean(force), false);
  }

  renderGamepads(force, unsupported) {
    const labels = this.getLabels();
    const signature = `${unsupported ? 'unsupported' : 'supported'}|${this.gamepads.map(p => `${p.index}:${p.id}:${p.axes.length}:${p.buttons.length}`).join('|')}|${this.gamepadIndex}|${this.controllerSource}|${Boolean(this.coDronePort)}`;
    if (!force && signature === this.gamepadSignature) return;
    this.gamepadSignature = signature;
    const select = this.ui.controllerSelect;
    select.replaceChildren();
    select.disabled = false;
    if (!this.gamepads.length && !this.coDronePort) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = unsupported ? labels.controllerUnsupported : labels.controllerNone;
      select.append(option);
      select.disabled = Boolean(unsupported);
      this.ui.controllerState.textContent = unsupported ? labels.controllerUnsupported : labels.controllerNone;
      this.ui.controllerState.classList.remove('connected');
      this.ui.controllerCounts.textContent = '';
      this.buildControlRows();
      return;
    }
    if (this.coDronePort) {
      const option = document.createElement('option');
      option.value = 'codrone';
      option.textContent = labels.codroneName;
      select.append(option);
    }
    for (const pad of this.gamepads) {
      const option = document.createElement('option');
      option.value = String(pad.index);
      option.textContent = pad.id || labels.controllerDevice;
      select.append(option);
    }
    select.value = this.controllerSource === 'codrone' && this.coDronePort ? 'codrone' : String(this.gamepadIndex ?? '');
    if (this.controllerSource === 'codrone' && this.coDronePort) {
      const gotData = this.coDronePacketCount > 0;
      this.ui.controllerState.textContent = gotData ? labels.codroneConnected : labels.codroneWaiting;
      this.ui.controllerCounts.textContent = `${labels.codroneAxes}: 4`;
      this.ui.controllerState.classList.add('connected');
      this.buildControlRows();
      return;
    }
    const selected = this.gamepads.find(p => p.index === this.gamepadIndex);
    if (selected) {
      this.ui.controllerState.textContent = labels.controllerConnected;
      this.ui.controllerState.classList.add('connected');
      this.ui.controllerCounts.textContent = `${labels.controllerSelectedAxes}: ${selected.axes.length} · ${labels.controllerSelectedButtons}: ${selected.buttons.length}`;
    }
    this.buildControlRows();
  }

  start() {
    const scene = this.getScene();
    if (!scene.route.length) return false;
    const alreadyActive = this.active;
    this.scene = scene;
    this.sceneBuilt = false;
    this.resetPathTrail();
    this.active = true;
    this.paused = false;
    this.keys.clear();
    this.elapsed = 0;
    this.distance = 0;
    this.passed = 0;
    this.started = false;
    this.finished = false;
    this.pos = scene.start.slice();
    this.pos[2] = Math.max(0.15, this.pos[2]);
    this.vel = [0, 0, 0];
    const first = scene.path.slice(1).find(p => Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1]) > 0.05);
    this.yaw = first ? Math.atan2(first[1] - this.pos[1], first[0] - this.pos[0]) : Math.PI / 2;
    this.pitch = 0;
    this.last = performance.now();
    this.ui.root.hidden = false;
    this.ui.root.setAttribute('aria-hidden', 'false');
    this.ui.pause.textContent = this.getLabels().pause;
    this.updateControlHint();
    this.resize();
    if (!alreadyActive) { const token = ++this.loopToken; requestAnimationFrame(t => this.tick(t, token)); }
    return true;
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.settingsOpen = false;
    this.ui.settings.hidden = true;
    this.loopToken++;
    this.keys.clear();
    if (this.coDronePort) void this.disconnectCoDrone();
    this.ui.root.hidden = true;
    this.ui.root.setAttribute('aria-hidden', 'true');
    this.onClose();
  }

  pause() {
    if (!this.active || this.finished) return;
    this.paused = !this.paused;
    this.keys.clear();
    this.ui.pause.textContent = this.paused ? this.getLabels().resume : this.getLabels().pause;
  }

  resize() {
    if (!this.active) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.canvas, this.mapCanvas]) {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      if (c === this.canvas && this.gl) this.gl.viewport(0, 0, c.width, c.height);
      else {
        const context = c === this.canvas ? this.ctx : this.mapCtx;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
  }

  tick(now, token) {
    if (!this.active || token !== this.loopToken) return;
    const dt = Math.min(0.04, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.settingsOpen) this.scanGamepads(false);
    this.refreshLiveInput();
    if (!this.paused && !this.finished) this.update(dt);
    this.draw();
    requestAnimationFrame(t => this.tick(t, token));
  }

  update(dt) {
    const k = this.keys;
    const controller = this.controls.mode === 'controller' ? this.readControllerInput() : null;
    const down = action => this.controls.keyboard[action].some(code => k.has(code));
    const forward = controller ? controller.pitch : Number(down('forward')) - Number(down('backward'));
    const side = controller ? controller.roll : Number(down('right')) - Number(down('left'));
    const vertical = controller ? controller.throttle : Number(down('ascend')) - Number(down('descend'));
    const turn = controller ? controller.yaw : Number(down('turnRight')) - Number(down('turnLeft'));
    const boost = !controller && down('boost') ? 1.8 : 1;
    if (controller && !this.gamepadAvailable) this.vel = [0, 0, 0];
    const accel = 4.2, drag = Math.exp(-1.5 * dt);
    this.yaw += turn * 1.65 * dt;
    const fx = Math.cos(this.yaw), fy = Math.sin(this.yaw), rx = -fy, ry = fx;
    this.vel[0] = (this.vel[0] + (fx * forward + rx * side) * accel * boost * dt) * drag;
    this.vel[1] = (this.vel[1] + (fy * forward + ry * side) * accel * boost * dt) * drag;
    this.vel[2] = (this.vel[2] + vertical * 3.3 * dt) * Math.exp(-2.2 * dt);
    const max = 3.2 * boost, planar = Math.hypot(this.vel[0], this.vel[1]);
    if (planar > max) { this.vel[0] *= max / planar; this.vel[1] *= max / planar; }
    this.vel[2] = Math.max(-1.8, Math.min(1.8, this.vel[2]));
    const prev = this.pos.slice();
    this.pos = [this.pos[0] + this.vel[0] * dt, this.pos[1] + this.vel[1] * dt, this.pos[2] + this.vel[2] * dt];
    const h = this.scene.hall;
    if (this.pos[0] < 0.12 || this.pos[0] > h.w - 0.12) { this.pos[0] = Math.max(0.12, Math.min(h.w - 0.12, this.pos[0])); this.vel[0] = 0; }
    if (this.pos[1] < 0.12 || this.pos[1] > h.l - 0.12) { this.pos[1] = Math.max(0.12, Math.min(h.l - 0.12, this.pos[1])); this.vel[1] = 0; }
    if (this.pos[2] < 0.12 || this.pos[2] > h.h - 0.1) { this.pos[2] = Math.max(0.12, Math.min(h.h - 0.1, this.pos[2])); this.vel[2] = 0; }
    this.updatePathTrail(dt);
    const moved = Math.hypot(this.pos[0] - prev[0], this.pos[1] - prev[1], this.pos[2] - prev[2]);
    this.distance += moved;
    if (this.pos[2] > 0.3 && !this.finished) this.started = true;
    if (this.started) this.elapsed += dt;
    this.pitch = Math.max(-0.12, Math.min(0.12, -Math.hypot(this.vel[0], this.vel[1]) * 0.025));
    this.checkWaypoint(prev);
    this.updateHud();
  }

  checkWaypoint(prev) {
    const wp = this.scene.route[this.passed];
    if (!wp || this.finished) return;
    let hit = false;
    if (wp.kind === 'gate' && wp.opening) {
      const o = wp.opening, n = o.dir, a = prev.map((v, i) => v - o.c[i]), b = this.pos.map((v, i) => v - o.c[i]);
      const da = a[0] * n[0] + a[1] * n[1] + a[2] * n[2], db = b[0] * n[0] + b[1] * n[1] + b[2] * n[2];
      const along = wp.direction[0] * n[0] + wp.direction[1] * n[1] + wp.direction[2] * n[2];
      if (da * db <= 0 && Math.abs(da - db) > 1e-5 && (db - da) * along > 0) {
        const t = da / (da - db), cross = a.map((v, i) => v + (b[i] - v) * t);
        const normalPart = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
        const radial = Math.hypot(cross[0] - n[0] * normalPart, cross[1] - n[1] * normalPart, cross[2] - n[2] * normalPart);
        hit = radial <= Math.max(0.04, o.size / 2 - 0.09);
      }
    } else {
      const d = Math.hypot(this.pos[0] - wp.position[0], this.pos[1] - wp.position[1], this.pos[2] - wp.position[2]);
      hit = d < (wp.kind === 'pad' ? 0.7 : wp.kind === 'flag' ? 0.55 : 0.45);
      if (wp.kind === 'pad') hit = hit && this.pos[2] < 0.65;
    }
    if (hit) {
      this.passed++;
      if (this.passed >= this.scene.route.length && this.pos[2] < 0.55) this.finished = true;
    }
  }

  updateHud() {
    const l = this.getLabels(), speed = Math.hypot(...this.vel);
    this.ui.time.textContent = this.formatTime(this.elapsed);
    this.ui.speed.textContent = speed.toFixed(1) + ' m/s';
    this.ui.alt.textContent = this.pos[2].toFixed(1) + ' m';
    this.ui.distance.textContent = this.distance.toFixed(1) + ' m';
    const heading = ((Math.round(this.yaw * 180 / Math.PI) % 360) + 360) % 360;
    this.ui.heading.textContent = heading + '°';
    this.ui.points.textContent = `${Math.min(this.passed, this.scene.route.length)} / ${this.scene.route.length}`;
    this.ui.next.textContent = this.finished ? l.complete : this.scene.route[this.passed]?.label || l.complete;
    this.ui.status.textContent = this.finished ? l.complete : this.paused ? l.paused : this.started ? l.flying : l.ready;
    this.ui.pause.disabled = this.finished;
  }

  formatTime(s) { const m = Math.floor(s / 60), ss = (s % 60).toFixed(1).padStart(4, '0'); return `${String(m).padStart(2, '0')}:${ss}`; }

  cameraPoint(p) {
    const x = p[0] - this.pos[0], y = p[1] - this.pos[1], z = p[2] - this.pos[2] - 0.08;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const right = -x * sy + y * cy;
    const depth = (x * cy + y * sy) * cp + z * sp;
    const up = -(x * cy + y * sy) * sp + z * cp;
    return [right, up, depth];
  }

  project(v, w, h) {
    const f = Math.min(w, h) * 0.82;
    return [w / 2 + v[0] * f / v[2], h * 0.52 - v[1] * f / v[2], v[2]];
  }

  draw() {
    if (!this.active) return;
    this.drawWorld();
    this.drawMap();
    this.updateHud();
  }

  drawWorld() {
    if (this.gl) { this.drawWebGL(); return; }
    const c = this.ctx, r = this.canvas.getBoundingClientRect(), w = r.width, h = r.height;
    c.clearRect(0, 0, w, h);
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, this.themeColor('--sim-sky-top', '#7dd3fc'));
    sky.addColorStop(0.56, this.themeColor('--sim-sky-mid', '#dbeafe'));
    sky.addColorStop(0.57, this.themeColor('--sim-sky-horizon', '#8798a8'));
    sky.addColorStop(1, this.themeColor('--sim-ground', '#374151'));
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    const items = [], pushPoly = (pts, fill, stroke) => items.push({ type: 'poly', pts, fill, stroke, depth: pts.reduce((a, p) => a + p[2], 0) / pts.length });
    const hall = this.scene.hall, floor = [[0, 0, 0], [hall.w, 0, 0], [hall.w, hall.l, 0], [0, hall.l, 0]];
    pushPoly(floor, this.themeColor('--sim-floor', '#cbd5e1'), this.themeColor('--sim-floor-stroke', '#64748b'));
    const grid = this.themeColor('--sim-grid-line', 'rgba(100,116,139,.22)');
    for (let x = 0; x <= hall.w + 1e-6; x += 1) items.push({ type: 'line', pts: [[x, 0, 0.01], [x, hall.l, 0.01]], color: grid, width: 0.008 });
    for (let y = 0; y <= hall.l + 1e-6; y += 1) items.push({ type: 'line', pts: [[0, y, 0.01], [hall.w, y, 0.01]], color: grid, width: 0.008 });
    for (const wall of [
      [[0, 0, 0], [hall.w, 0, 0], [hall.w, 0, hall.h], [0, 0, hall.h]],
      [[hall.w, 0, 0], [hall.w, hall.l, 0], [hall.w, hall.l, hall.h], [hall.w, 0, hall.h]],
      [[hall.w, hall.l, 0], [0, hall.l, 0], [0, hall.l, hall.h], [hall.w, hall.l, hall.h]],
      [[0, hall.l, 0], [0, 0, 0], [0, 0, hall.h], [0, hall.l, hall.h]],
    ]) pushPoly(wall, this.themeColor('--sim-wall-fill', 'rgba(226,232,240,.22)'), this.themeColor('--sim-wall-stroke', 'rgba(255,255,255,.35)'));
    for (const el of this.scene.elements) for (const p of el) {
      if (p.k === 'p') pushPoly(p.pts, p.f || 'rgba(148,163,184,.45)', p.s || null);
      else items.push({ type: 'line', pts: [p.a, p.b], color: p.c, width: p.w, depth: (p.a[1] + p.b[1]) / 2 });
    }
    // Raja ees olev joon helendab; drooni taha jääv osa hääbub järk-järgult.
    const routeRgb = this.themeColor('--sim-route-rgb', '124,58,237');
    for (let i = 1; i < this.scene.path.length; i++) {
      const start = this.pathDistances[i - 1], end = this.pathDistances[i], alpha = this.routeAlpha((start + end) / 2);
      if (alpha < 0.012) continue;
      const a = this.scene.path[i - 1], b = this.scene.path[i];
      items.push({ type: 'line', pts: [a, b], color: `rgba(${routeRgb},${alpha})`, width: 0.8, glow: true, depth: (a[1] + b[1]) / 2 });
    }
    for (const item of items) {
      const cam = item.pts.map(p => this.cameraPoint(p));
      const clipped = item.type === 'poly' ? this.clipNear(cam) : this.clipLine(cam);
      if (!clipped || clipped.length < 2 || clipped.some(p => p[2] < 0.08)) continue;
      item.screen = clipped.map(p => this.project(p, w, h));
      item.z = clipped.reduce((a, p) => a + p[2], 0) / clipped.length;
    }
    items.sort((a, b) => (b.z || 0) - (a.z || 0));
    for (const item of items) {
      if (!item.screen) continue;
      c.beginPath(); item.screen.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      if (item.type === 'poly') { c.closePath(); c.fillStyle = item.fill; c.fill(); if (item.stroke) { c.strokeStyle = item.stroke; c.lineWidth = 1.2; c.stroke(); } }
      else {
        if (item.glow) { c.shadowColor = item.color; c.shadowBlur = 5; }
        c.strokeStyle = item.color; c.lineWidth = item.glow ? 1.6 : Math.max(1, item.width * 5); c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
        if (item.glow) c.shadowBlur = 0;
      }
    }
  }

  clipNear(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], ina = a[2] > 0.08, inb = b[2] > 0.08;
      if (ina) out.push(a);
      if (ina !== inb) { const t = (0.08 - a[2]) / (b[2] - a[2]); out.push(a.map((v, j) => v + (b[j] - v) * t)); }
    }
    return out;
  }

  clipLine(points) {
    let [a, b] = points;
    if (a[2] <= 0.08 && b[2] <= 0.08) return [];
    if (a[2] <= 0.08 || b[2] <= 0.08) {
      const t = (0.08 - a[2]) / (b[2] - a[2]), p = a.map((v, i) => v + (b[i] - v) * t);
      if (a[2] <= 0.08) a = p; else b = p;
    }
    return [a, b];
  }

  drawReticle(w, h) {
    const c = this.ctx, x = w / 2, y = h / 2;
    c.strokeStyle = this.themeColor('--sim-boundary', 'rgba(15,23,42,.75)'); c.lineWidth = 2;
    c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x - 4, y); c.moveTo(x + 4, y); c.lineTo(x + 12, y); c.moveTo(x, y - 12); c.lineTo(x, y - 4); c.moveTo(x, y + 4); c.lineTo(x, y + 12); c.stroke();
  }

  drawMap() {
    const c = this.mapCtx, r = this.mapCanvas.getBoundingClientRect(), w = r.width, h = r.height, hall = this.scene.hall;
    c.clearRect(0, 0, w, h); c.fillStyle = this.themeColor('--sim-map-bg', 'rgba(248,250,252,.96)'); c.fillRect(0, 0, w, h);
    const pad = 12, scale = Math.min((w - pad * 2) / hall.w, (h - pad * 2) / hall.l), ox = (w - hall.w * scale) / 2, oy = (h - hall.l * scale) / 2;
    c.strokeStyle = this.themeColor('--sim-map-line', '#64748b'); c.lineWidth = 2; c.strokeRect(ox, oy, hall.w * scale, hall.l * scale);
    if (this.scene.path.length) {
      c.beginPath(); this.scene.path.forEach((p, i) => { const x = ox + p[0] * scale, y = oy + (hall.l - p[1]) * scale; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.strokeStyle = this.themeColor('--sim-map-route', 'rgba(124,58,237,.55)'); c.lineWidth = 2; c.stroke();
    }
    this.scene.route.forEach((p, i) => { c.beginPath(); c.arc(ox + p.position[0] * scale, oy + (hall.l - p.position[1]) * scale, i < this.passed ? 4 : 3, 0, Math.PI * 2); c.fillStyle = i < this.passed ? '#16a34a' : '#7c3aed'; c.fill(); });
    const x = ox + this.pos[0] * scale, y = oy + (hall.l - this.pos[1]) * scale;
    c.save(); c.translate(x, y); c.rotate(Math.PI / 2 - this.yaw); c.fillStyle = '#f97316'; c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill(); c.restore();
  }
}
