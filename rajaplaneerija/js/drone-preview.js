'use strict';

class DroneModelPreview {
  constructor(canvas, status, getMessages) {
    this.canvas = canvas;
    this.status = status;
    this.getMessages = getMessages;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: true, depth: true });
    this.url = '';
    this.model = null;
    this.pending = null;
    this.yaw = 0.34;
    this.pitch = 0.38;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.distance = 2.65;
    this.drag = null;
    this.orbitFrame = 0;
    this.lastOrbitFrame = 0;
    this.lastSize = '';
    if (!this.gl) { this.setStatus('unsupported'); return; }
    try { this.initGL(); }
    catch (error) { this.gl = null; this.setStatus('failed'); }
    this.bind();
  }

  messages() { return this.getMessages(); }
  setStatus(key) { if (this.status) this.status.textContent = this.messages()[key] || ''; }

  initGL() {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER,
      'attribute vec3 aPosition; attribute vec3 aNormal; attribute vec2 aUv; uniform mat4 uMvp; uniform mat4 uModelView; varying vec3 vNormal; varying vec2 vUv; void main(){ gl_Position=uMvp*vec4(aPosition,1.0); vNormal=mat3(uModelView)*aNormal; vUv=aUv; }');
    const fs = compile(gl.FRAGMENT_SHADER,
      'precision mediump float; varying vec3 vNormal; varying vec2 vUv; uniform sampler2D uTexture; uniform float uUnlit; void main(){ vec3 srgb=texture2D(uTexture,vUv).rgb; if(uUnlit>0.5){ gl_FragColor=vec4(srgb,1.0); return; } vec3 albedo=pow(srgb,vec3(2.2)); vec3 N=normalize(vNormal); vec3 L=normalize(vec3(-0.4,0.72,0.82)); vec3 V=vec3(0.0,0.0,1.0); vec3 H=normalize(L+V); float diffuse=max(dot(N,L),0.0); float specular=pow(max(dot(N,H),0.0),28.0)*0.22; vec3 lit=albedo*(1.35+1.1*diffuse)+vec3(specular); gl_FragColor=vec4(pow(max(lit,vec3(0.0)),vec3(1.0/2.2)),1.0); }');
    const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.attrs = { position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'), uv: gl.getAttribLocation(program, 'aUv'), mvp: gl.getUniformLocation(program, 'uMvp'), modelView: gl.getUniformLocation(program, 'uModelView'), texture: gl.getUniformLocation(program, 'uTexture'), unlit: gl.getUniformLocation(program, 'uUnlit') };
    this.positionBuffer = gl.createBuffer(); this.normalBuffer = gl.createBuffer(); this.uvBuffer = gl.createBuffer(); this.indexBuffer = gl.createBuffer(); this.texture = gl.createTexture();
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([150, 170, 190, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  bind() {
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 && event.button !== 2) return;
      this.drag = { x: event.clientX, y: event.clientY, yaw: this.targetYaw, pitch: this.targetPitch };
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.drag) return;
      // Reverse the drag direction and ease the view toward the pointer target.
      this.targetYaw = this.drag.yaw - (event.clientX - this.drag.x) * 0.006;
      this.targetPitch = Math.max(-1.2, Math.min(1.2, this.drag.pitch + (event.clientY - this.drag.y) * 0.005));
      this.animateOrbit();
    });
    const endDrag = () => { this.drag = null; this.canvas.classList.remove('dragging'); };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.distance = Math.max(1.8, Math.min(8, this.distance * Math.exp(event.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.draw()).observe(this.canvas);
    else window.addEventListener('resize', () => this.draw());
  }

  animateOrbit() {
    if (this.orbitFrame) return;
    this.orbitFrame = requestAnimationFrame(time => {
      this.orbitFrame = 0;
      const elapsed = this.lastOrbitFrame ? Math.min(40, time - this.lastOrbitFrame) : 16.7;
      this.lastOrbitFrame = time;
      const ease = 1 - Math.exp(-elapsed / 75);
      let yawDelta = this.targetYaw - this.yaw;
      yawDelta = ((yawDelta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const pitchDelta = this.targetPitch - this.pitch;
      this.yaw += yawDelta * ease;
      this.pitch += pitchDelta * ease;
      if (Math.abs(yawDelta) < 0.0003 && Math.abs(pitchDelta) < 0.0003) {
        this.yaw = this.targetYaw;
        this.pitch = this.targetPitch;
        this.lastOrbitFrame = 0;
        this.draw();
        return;
      }
      this.draw();
      this.animateOrbit();
    });
  }

  async load(url) {
    if (!this.gl) { this.setStatus('unsupported'); return; }
    if (this.url === url && this.model) { this.setStatus('ready'); this.draw(); return; }
    if (this.pending && this.url === url) return this.pending;
    this.url = url; this.model = null; this.setStatus('loading');
    this.pending = this.loadFile(url).then(model => {
      if (this.url !== url) return;
      this.model = model; this.pending = null; this.setStatus('ready'); this.draw();
    }).catch(error => {
      if (this.url !== url) return;
      this.pending = null; this.setStatus('failed');
      console.error('CoDrone EDU GLB preview failed:', error);
    });
    return this.pending;
  }

  async loadFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Model request failed (${response.status})`);
    const file = await response.arrayBuffer(), view = new DataView(file);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('Unsupported GLB file');
    let offset = 12, gltf = null, binary = null;
    while (offset + 8 <= file.byteLength) {
      const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true), start = offset + 8;
      if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(file, start, length)).trim());
      else if (type === 0x004e4942) binary = new Uint8Array(file, start, length);
      offset = start + length;
    }
    if (!gltf || !binary) throw new Error('GLB data is incomplete');
    const primitive = gltf.meshes?.[0]?.primitives?.[0];
    if (!primitive) throw new Error('GLB has no mesh');
    const positions = this.readAccessor(gltf, binary, primitive.attributes.POSITION);
    const normals = this.readAccessor(gltf, binary, primitive.attributes.NORMAL);
    const uvs = this.readAccessor(gltf, binary, primitive.attributes.TEXCOORD_0);
    const indexAccessor = gltf.accessors[primitive.indices];
    const indices = this.readAccessor(gltf, binary, primitive.indices, true);
    const ext = this.gl.getExtension('OES_element_index_uint');
    if (indexAccessor.componentType === 5125 && !ext) throw new Error('32-bit mesh indices are not supported by this browser');
    const bounds = gltf.accessors[primitive.attributes.POSITION];
    const min = bounds.min || [0, 0, 0], max = bounds.max || [1, 1, 1];
    const center = min.map((value, i) => (value + max[i]) / 2);
    const maxSpan = Math.max(...max.map((value, i) => value - min[i]), 0.01);
    const imageIndex = this.textureImageIndex(gltf, primitive.material);
    const image = gltf.images?.[imageIndex];
    if (image?.bufferView == null) throw new Error('GLB has no embedded preview texture');
    const imageView = gltf.bufferViews[image.bufferView];
    const imageBytes = binary.slice((imageView.byteOffset || 0), (imageView.byteOffset || 0) + imageView.byteLength);
    await this.uploadImage(imageBytes, image.mimeType || 'image/png');
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    const material = gltf.materials?.[primitive.material] || {};
    return { count: indices.length, indexType: indexAccessor.componentType === 5125 ? gl.UNSIGNED_INT : indexAccessor.componentType === 5121 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, center, scale: 1.8 / maxSpan, unlit: Boolean(material.emissiveTexture) };
  }

  readAccessor(gltf, binary, index, indices = false) {
    const accessor = gltf.accessors[index], bufferView = gltf.bufferViews[accessor.bufferView];
    const componentCount = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 })[accessor.type];
    const component = ({ 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] })[accessor.componentType];
    if (!componentCount || !component) throw new Error('Unsupported GLB accessor');
    const itemSize = componentCount * component[0], stride = bufferView.byteStride || itemSize;
    const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0), data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    if (indices) {
      const Ctor = accessor.componentType === 5125 ? Uint32Array : accessor.componentType === 5123 ? Uint16Array : Uint8Array;
      const out = new Ctor(accessor.count);
      for (let i = 0; i < accessor.count; i++) out[i] = data[component[1]](start + i * stride, true);
      return out;
    }
    const out = new Float32Array(accessor.count * componentCount);
    for (let i = 0; i < accessor.count; i++) for (let j = 0; j < componentCount; j++) {
      const at = start + i * stride + j * component[0];
      out[i * componentCount + j] = component[0] === 1 ? data[component[1]](at) : data[component[1]](at, true);
    }
    return out;
  }

  textureImageIndex(gltf, materialIndex) {
    const material = gltf.materials?.[materialIndex] || {};
    const textureIndex = material.emissiveTexture?.index ?? material.pbrMetallicRoughness?.baseColorTexture?.index ?? material.normalTexture?.index ?? 0;
    return gltf.textures?.[textureIndex]?.source ?? 0;
  }

  uploadImage(bytes, mimeType) {
    return new Promise((resolve, reject) => {
      const image = new Image(), objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      image.onload = () => {
        try {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
          // glTF UV coordinates use the image's top-left origin. Keep the
          // uploaded PNG orientation intact so atlas regions land on the
          // matching model surfaces.
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          URL.revokeObjectURL(objectUrl); resolve();
        } catch (error) { URL.revokeObjectURL(objectUrl); reject(error); }
      };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('GLB texture could not be decoded')); };
      image.src = objectUrl;
    });
  }

  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  }

  lookAt(eye, target) {
    const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(eye.map((v, i) => v - target[i])), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }

  perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  draw() {
    if (!this.gl || !this.model) return;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1), width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
    const size = `${width}x${height}`;
    if (size !== this.lastSize) { this.canvas.width = width; this.canvas.height = height; this.lastSize = size; }
    const gl = this.gl;
    gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const cp = Math.cos(this.pitch), eye = [this.distance * cp * Math.sin(this.yaw), this.distance * Math.sin(this.pitch), this.distance * cp * Math.cos(this.yaw)];
    const view = this.lookAt(eye, [0, 0, 0]), projection = this.perspective(Math.PI / 4.2, width / height, 0.05, 40);
    const T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -this.model.center[0], -this.model.center[1], -this.model.center[2], 1]);
    const s = this.model.scale, S = new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
    const model = this.multiply(S, T), modelView = this.multiply(view, model), mvp = this.multiply(projection, modelView);
    gl.useProgram(this.program); gl.uniformMatrix4fv(this.attrs.mvp, false, mvp); gl.uniformMatrix4fv(this.attrs.modelView, false, modelView); gl.uniform1f(this.attrs.unlit, this.model.unlit ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer); gl.enableVertexAttribArray(this.attrs.position); gl.vertexAttribPointer(this.attrs.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer); gl.enableVertexAttribArray(this.attrs.normal); gl.vertexAttribPointer(this.attrs.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer); gl.enableVertexAttribArray(this.attrs.uv); gl.vertexAttribPointer(this.attrs.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); gl.uniform1i(this.attrs.texture, 0);
    gl.drawElements(gl.TRIANGLES, this.model.count, this.model.indexType, 0);
  }
}

window.DroneModelPreview = DroneModelPreview;
