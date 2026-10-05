(function (global) {
  'use strict';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  const rotationStages = new Set(['anticipate', 'rotation-detach', 'rotate', 'rotation-attach']);
  const rgb = (a, b, t) => `rgb(${a.map((v, i) => Math.round(mix(v, b[i], t))).join(',')})`;

  function layout(tree) {
    const nodes = new Map(tree.nodes.map(n => [n.id, n]));
    const points = new Map();
    let leaf = 0, depth = 0;
    const walk = (id, level, parent, side) => {
      depth = Math.max(depth, level);
      if (!id) {
        const key = parent ? `nil-${parent}-${side}` : 'nil-root';
        const p = { id: key, x: leaf++ * 68, y: level * 98, nil: true, parent, side, value: 'NIL', color: 'black' };
        points.set(key, p); return p.x;
      }
      const n = nodes.get(id);
      const lx = walk(n.left, level + 1, id, 'left'), rx = walk(n.right, level + 1, id, 'right');
      const x = (lx + rx) / 2;
      points.set(id, { ...n, x, y: level * 98, level });
      return x;
    };
    const rootX = walk(tree.root, 0, null, null);
    points.forEach(p => { p.x -= rootX; });
    const xs = [...points.values()].map(p => p.x);
    return { points, depth, minX: Math.min(...xs), maxX: Math.max(...xs) };
  }

  class TreeRenderer {
    constructor(canvas, note) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.note = note;
      this.w = 1; this.h = 1;
      this.camera = { x: 0, y: 0, scale: 1, vx: 0, vy: 0, vs: 0 };
      this.display = new Map(); this.starts = new Map();
      this.screen = new Map(); this.brightness = new Map();
      this.frame = null; this.oldFrame = null;
      this.progress = 0; this.clock = 0; this.load = false;
      this.hover = null; this.selected = null; this.message = null;
      this.bubbles = [];
      this.sprites = new Map();
      this.settling = true;
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.motionQuery.addEventListener('change', e => { this.reduced = e.matches; this.onInvalidate?.(); });
      for (const red of [0, 1]) for (const soft of [false, true]) this.sprite(red, soft);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.w = rect.width; this.h = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2500000 / Math.max(1, this.w * this.h)));
      this.canvas.width = Math.floor(this.w * dpr); this.canvas.height = Math.floor(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.background = this.ctx.createRadialGradient(this.w / 2, this.h * .53, 20, this.w / 2, this.h * .53, this.w * .48);
      this.background.addColorStop(0, '#11161d'); this.background.addColorStop(1, '#0e1117');
      if (this.lockCamera && this.rotationBefore) {
        const meta = this.frame.rotation, a = this.rotationBefore.points.get(meta.pivot), b = this.rotationBefore.points.get(meta.up);
        this.camera.scale = Math.min(1.02, Math.max(this.baseScale() * 1.3, this.w < 621 ? .75 : .92));
        this.camera.x = -(a.x + b.x) / 2 * this.camera.scale;
        this.camera.y = this.h * .15 - (a.y + b.y) / 2 * this.camera.scale;
        this.camera.vx = this.camera.vy = this.camera.vs = 0;
      }
      this.settling = true;
      this.onInvalidate?.();
    }

    setFrame(frame, instant = false) {
      this.oldFrame = this.frame;
      this.frame = frame;
      this.target = layout(frame.tree);
      this.starts = new Map([...this.display].map(([id, p]) => [id, { ...p }]));
      if (!this.display.size || instant) {
        this.starts = new Map([...this.target.points].map(([id, p]) => [id, { ...p, red: p.color === 'red' ? 1 : 0 }]));
        this.display = new Map(this.starts);
      }
      this.rotationStage = !!frame.rotation && rotationStages.has(frame.type);
      this.edgesBefore = this.edgeList(this.rotationStage ? frame.rotation.beforeTree : this.oldFrame?.tree || frame.tree);
      this.edgesAfter = this.edgeList(this.rotationStage ? frame.rotation.afterTree : frame.tree);
      if (this.rotationStage) {
        this.rotationBefore = layout(frame.rotation.beforeTree);
        this.rotationAfter = layout(frame.rotation.afterTree);
        const beforeNodes = new Map(frame.rotation.beforeTree.nodes.map(n => [n.id, n]));
        this.rotationSubtree = [];
        const collect = id => { if (!id) return; const n = beforeNodes.get(id); this.rotationSubtree.push(id); collect(n.left); collect(n.right); };
        collect(frame.rotation.pivot);
      }
      const newKeys = new Set(this.edgesAfter.map(e => e.key)), oldKeys = new Set(this.edgesBefore.map(e => e.key));
      this.detachedEdges = this.edgesBefore.filter(e => !newKeys.has(e.key));
      this.attachedKeys = new Set(this.edgesAfter.filter(e => !oldKeys.has(e.key)).map(e => e.key));
      this.detachedKeys = new Set(this.detachedEdges.map(e => e.key));
      this.lockCamera = this.rotationStage && frame.type !== 'anticipate';
      if (this.lockCamera) this.camera.vx = this.camera.vy = this.camera.vs = 0;
      this.focus = new Set(frame.focus);
      this.nodesById = new Map(frame.tree.nodes.map(n => [n.id, n]));
      this.paths = [];
      const walk = (id, path) => {
        const n = this.nodesById.get(id), next = [...path, id];
        for (const side of ['left', 'right']) {
          if (n[side]) walk(n[side], next);
          else { const ids = [...next, `nil-${id}-${side}`]; this.paths.push({ ids, blacks: next.filter(key => this.nodesById.get(key).color === 'black').length + 1 }); }
        }
      };
      if (frame.tree.root) walk(frame.tree.root, []);
      this.ghostStart = this.ghostPosition ? { ...this.ghostPosition } : null;
      const ghost = frame.ghost;
      if (ghost?.spawn) this.ghostStart = { x: 0, y: -this.h * .20 / this.baseScale() - 30 };
      this.message = null;
      this.progress = 0;
      this.frameAge = 0;
      if (!['compare', 'spawn', 'attach'].includes(frame.type)) this.bubbles = [];
      if (frame.comparison && frame.ghost) this.bubbles.push({ ...frame.comparison, side: frame.ghost.side, born: this.clock });
      if (frame.type === 'ready' && !this.oldFrame) {
        this.camera.scale = this.baseScale();
        this.camera.x = this.camera.y = 0;
      }
      this.settling = true;
      this.onInvalidate?.();
    }

    edgeList(tree) {
      const list = [];
      tree.nodes.forEach(n => {
        for (const side of ['left', 'right']) list.push({ a: n.id, b: n[side] || `nil-${n.id}-${side}`, nil: !n[side], key: `${n.id}:${n[side] || side}` });
      });
      return list;
    }

    baseScale() {
      if (!this.target) return 1;
      const stageBottom = this.w <= 620 ? this.h - 225 : this.h - 180;
      const room = Math.max(100, stageBottom - this.h * .20);
      return Math.min(1.48, this.w * .70 / (this.target.maxX - this.target.minX + 70), room / (this.target.depth * 98 + 60));
    }

    toScreen(p) {
      return { x: this.w / 2 + this.camera.x + p.x * this.camera.scale,
        y: this.h * .20 + this.camera.y + p.y * this.camera.scale };
    }

    hit(x, y) {
      for (const [id, p] of this.screen) if (!p.nil && Math.hypot(p.x - x, p.y - y) < Math.max(24, 26 * this.camera.scale)) return id;
      return null;
    }

    say(title, text, anchor = null) {
      this.message = { title, text, anchor, until: this.clock + 3.5 };
      this.onInvalidate?.();
    }

    needsAnimation() {
      return this.settling || !!this.message || (['settle', 'reject'].includes(this.frame?.type) && this.frameAge <= 3.5);
    }

    update(dt, progress, animateClock = true) {
      if (!this.frame) return;
      this.progress = progress;
      this.frameAge += dt;
      if (animateClock) this.clock += dt;
      if (this.message && this.clock >= this.message.until) this.message = null;
      const positionProgress = ['rotation-detach', 'rotation-attach'].includes(this.frame.type) ? 1 : progress;
      const t = ease(clamp(positionProgress * (['compare', 'spawn'].includes(this.frame.type) ? 1.45 : 1.1)));
      const f = this.frame;
      const focus = this.focus;
      const active = !['ready', 'settle', 'reject'].includes(f.type);
      const blend = 1 - Math.exp(-dt * 8);
      this.settling = false;
      const next = new Map();
      for (const [id, target] of this.target.points) {
        let start = this.starts.get(id);
        if (!start) {
          if (id === f.inserted && this.ghostPosition) start = { ...this.ghostPosition, red: 1 };
          else start = this.starts.get(target.parent) || target;
        }
        let x = mix(start.x, target.x, t), y = mix(start.y, target.y, t);
        if (f.type === 'rotate' && !this.reduced && [f.rotation.pivot, f.rotation.up].includes(id)) {
          const dir = f.rotation.direction === 'left' ? 1 : -1;
          x += Math.sin(t * Math.PI) * 30 * (id === f.rotation.up ? -dir : dir);
          y -= Math.sin(t * Math.PI) * 22;
        }
        if (f.type === 'attach' && id === f.inserted && !this.reduced) y += Math.sin(progress * Math.PI * 3) * (1 - progress) * 5;
        const colorT = f.type === 'replace' ? 0 : t;
        const red = mix(start.red ?? (start.color === 'red' ? 1 : 0), target.color === 'red' ? 1 : 0, colorT);
        next.set(id, { ...target, x, y, red });
        const desired = active && !focus.has(id) && id !== this.hover && id !== this.selected ? .3 : 1;
        const brightness = mix(this.brightness.get(id) ?? 1, desired, blend);
        if (Math.abs(brightness - desired) > .004) this.settling = true;
        this.brightness.set(id, Math.abs(brightness - desired) < .001 ? desired : brightness);
      }
      // Preserve disappearing nodes until the particle/edge outro has completed.
      for (const [id, p] of this.starts) if (!next.has(id) && !p.nil) next.set(id, { ...p, dying: true, alpha: 1 - t });
      this.display = next;
      if (f.ghost) {
        const near = this.display.get(f.ghost.near);
        const destination = near ? { x: near.x + (f.ghost.side === 'left' ? -53 : 53), y: near.y - 38 } : { x: 0, y: -65 };
        const start = this.ghostStart || { x: 0, y: -110 };
        this.ghostPosition = { x: mix(start.x, destination.x, t), y: mix(start.y, destination.y, t) };
      } else if (f.type !== 'attach') this.ghostPosition = null;

      const base = this.baseScale();
      let anchor = this.display.get(f.anchor);
      if (this.rotationStage) {
        const a = this.rotationBefore.points.get(f.rotation.pivot), b = this.rotationBefore.points.get(f.rotation.up);
        anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      const tracked = active && (this.target.depth > 4 || base < .35) && anchor;
      const targetScale = tracked ? Math.min(1.02, Math.max(base * 1.3, this.w < 621 ? .75 : .92)) : base;
      const targetX = tracked ? -anchor.x * targetScale : 0;
      const targetY = tracked ? this.h * .35 - (this.h * .20 + anchor.y * targetScale) : 0;
      const c = this.camera;
      // Critically damped camera, integrated in small steps to stay stable after tab suspension.
      const steps = Math.max(1, Math.ceil(dt / .016)), h = dt / steps;
      for (let i = 0; !this.lockCamera && i < steps; i++) {
        for (const [key, velocity, goal] of [['x', 'vx', targetX], ['y', 'vy', targetY], ['scale', 'vs', targetScale]]) {
          c[velocity] += ((goal - c[key]) * 65 - c[velocity] * 16) * h;
          c[key] += c[velocity] * h;
        }
      }
      if (!this.lockCamera && (Math.abs(c.x - targetX) > .04 || Math.abs(c.y - targetY) > .04 || Math.abs(c.scale - targetScale) > .0002)) this.settling = true;
      this.screen.clear();
      this.display.forEach((p, id) => this.screen.set(id, { ...p, ...this.toScreen(p) }));
      this.draw();
      this.updateNote(active);
    }

    draw() {
      const ctx = this.ctx, f = this.frame, p = this.progress;
      ctx.fillStyle = this.background; ctx.fillRect(0, 0, this.w, this.h);
      const focus = this.screen.get(this.hover || this.selected || f.anchor);
      if (focus && !['ready', 'settle'].includes(f.type)) {
        const size = Math.max(62, 78 * this.camera.scale), light = ctx.createRadialGradient(focus.x, focus.y, 0, focus.x, focus.y, size);
        light.addColorStop(0, f.type === 'conflict' ? '#ff3b3015' : '#9dbbdd0c'); light.addColorStop(1, '#0e111700');
        ctx.fillStyle = light; ctx.fillRect(focus.x - size, focus.y - size, size * 2, size * 2);
      }
      this.drawEdges();
      this.effectsBehind();
      const selected = this.hover || this.selected;
      for (const [id, point] of this.screen) {
        if (point.nil) {
          const debt = f.debt?.id === id;
          const nearFocus = f.focus.includes(point.parent) || point.parent === selected;
          if (debt || this.load || nearFocus) this.nil(point, debt ? .8 : this.load ? .35 : .14);
          continue;
        }
        if (point.dying) {
          if (f.type === 'remove') this.dissolve(point);
          else { ctx.save(); ctx.globalAlpha = point.alpha; this.sphere(point, 25 * this.camera.scale, point.red); ctx.restore(); }
          continue;
        }
        const brightness = this.brightness.get(id) ?? 1;
        ctx.save(); ctx.globalAlpha = brightness;
        const soft = brightness < .5 && !this.reduced && !['ready', 'settle'].includes(f.type);
        const shake = f.type === 'conflict' && f.conflict.includes(id) && !this.reduced ? Math.sin(this.clock * 100 + point.x) * 1.1 : 0;
        this.sphere({ ...point, x: point.x + shake }, 25 * this.camera.scale, point.red, id === selected, soft);
        ctx.restore();
      }
      if (f.ghost && this.ghostPosition) {
        const ghost = this.toScreen(this.ghostPosition);
        ctx.save(); ctx.globalAlpha = .96;
        this.sphere({ ...ghost, value: f.ghost.value }, 25 * this.camera.scale, 1, true);
        ctx.restore();
      }
      this.effectsFront();
      if (this.load || f.type === 'settle') this.blackPulses();
      if (f.debt) this.debtRing(f.debt.id, f.type === 'rotate' && f.rotation.resolvesDebt ? 1 - p : 1);
      if (f.type === 'push-black' && f.fromDebt) this.debtTransfer();
      if (f.type === 'absorb' && this.oldFrame?.debt) this.debtRing(this.oldFrame.debt.id, 1 - p);
    }

    sprite(red, soft) {
      const key = `sphere-${red}-${soft}`;
      if (this.sprites.has(key)) return this.sprites.get(key);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 288;
      const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
      if (soft) {
        ctx.filter = 'blur(2px)'; ctx.drawImage(this.sprite(red, false), 0, 0, 144, 144);
      } else this.paintMaterial(ctx, 72, 72, 32, red);
      this.sprites.set(key, canvas);
      return canvas;
    }

    drawEdges() {
      const type = this.frame.type, p = ease(this.progress);
      if (this.rotationStage) {
        if (type === 'anticipate' || type === 'rotation-detach') {
          this.edgesBefore.forEach(e => {
            const changed = this.detachedKeys.has(e.key);
            this.edge(e, type === 'rotation-detach' && changed ? 1 - p : 1,
              changed ? type === 'rotation-detach' ? 'detach' : 'cut-preview' : null);
          });
        } else {
          this.edgesAfter.forEach(e => {
            const changed = this.attachedKeys.has(e.key);
            if (type === 'rotate' && changed) return;
            this.edge(e, type === 'rotation-attach' && changed ? p : 1, changed ? 'attach' : null);
          });
        }
        return;
      }
      this.detachedEdges.forEach(e => this.edge(e, 1 - clamp(this.progress / .25), 'detach'));
      this.edgesAfter.forEach(e => {
        const attached = this.attachedKeys.has(e.key);
        this.edge(e, attached ? clamp((this.progress - .12) / .25) : 1, attached ? 'attach' : null);
      });
    }

    paintMaterial(ctx, x, y, r, red) {
      if (red > .02) {
        const glow = ctx.createRadialGradient(x, y, r * .75, x, y, r * 2.1);
        glow.addColorStop(0, `rgba(255,59,48,${.13 * red})`); glow.addColorStop(1, 'rgba(255,59,48,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save();
      ctx.shadowColor = '#0000006b'; ctx.shadowBlur = r * .6; ctx.shadowOffsetY = r * .2;
      const fill = ctx.createRadialGradient(x - r * .3, y - r * .45, 0, x + r * .3, y + r * .5, r * 1.8);
      fill.addColorStop(0, rgb([42, 49, 62], [255, 110, 92], red));
      fill.addColorStop(.36, rgb([24, 29, 38], [255, 59, 48], red));
      fill.addColorStop(.78, rgb([11, 15, 21], [180, 22, 21], red));
      fill.addColorStop(1, rgb([8, 11, 17], [112, 13, 17], red));
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const outline = ctx.createLinearGradient(x, y - r, x, y + r);
      outline.addColorStop(0, rgb([137, 154, 177], [255, 149, 131], red));
      outline.addColorStop(.45, rgb([61, 75, 94], [247, 72, 57], red));
      outline.addColorStop(1, rgb([26, 34, 47], [132, 30, 29], red));
      ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y + .3, r - 2, Math.PI * 1.14, Math.PI * 1.85);
      ctx.strokeStyle = `rgba(226,236,255,${.06 + .07 * red})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }

    sphere(point, r, red, selected = false, soft = false) {
      const ctx = this.ctx, { x, y, value } = point, size = r * 4.5;
      red = clamp(red || 0);
      ctx.save();
      const opacity = ctx.globalAlpha;
      if (red < .999) ctx.drawImage(this.sprite(0, soft), x - size / 2, y - size / 2, size, size);
      if (red > .001) {
        ctx.globalAlpha = opacity * red;
        ctx.drawImage(this.sprite(1, soft), x - size / 2, y - size / 2, size, size);
        ctx.globalAlpha = opacity;
      }
      if (selected) {
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#bacfe45c'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.fillStyle = red > .5 ? '#fff9f7' : '#d4dce8';
      ctx.font = `500 ${Math.max(10, Math.min(18, r * .64))}px 'DejaVu Sans Mono', 'SFMono-Regular', monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(value), x, y + .7);
      ctx.restore();
    }

    glowDot(x, y, size, warm = false) {
      const key = warm ? 'dot-warm' : 'dot-cool';
      let canvas = this.sprites.get(key);
      if (!canvas) {
        canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
        gradient.addColorStop(0, warm ? '#ffe0bf' : '#e0edff');
        gradient.addColorStop(.16, warm ? '#ff6e53' : '#b8dbff');
        gradient.addColorStop(.32, warm ? '#ff6e535e' : '#b8dbff42');
        gradient.addColorStop(1, warm ? '#ff6e5300' : '#b8dbff00');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 48, 48);
        this.sprites.set(key, canvas);
      }
      const span = size * 6;
      this.ctx.drawImage(canvas, x - span / 2, y - span / 2, span, span);
    }

    nil(point, alpha) {
      const ctx = this.ctx, r = Math.max(4, 7 * this.camera.scale);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#708099'; ctx.lineWidth = .6;
      ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.stroke();
      if (this.frame.debt?.id === point.id) {
        ctx.fillStyle = '#b0bdcf'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillText('NIL', point.x, point.y + 22);
      }
      ctx.restore();
    }

    edge(e, alpha, mode) {
      if (alpha <= 0) return;
      const ctx = this.ctx, a = this.screen.get(e.a) || this.starts.get(e.a), b = this.screen.get(e.b) || (this.starts.has(e.b) ? this.toScreen(this.starts.get(e.b)) : null);
      if (!a || !b) return;
      const f = this.frame, conflict = f.type === 'conflict' && f.conflict.includes(e.a) && f.conflict.includes(e.b);
      const route = f.route && f.route[0] === e.a && f.route[1] === e.b;
      const focused = mode || f.focus.includes(e.a) && (f.focus.includes(e.b) || route);
      const quiet = ['ready', 'settle', 'reject'].includes(f.type);
      ctx.save();
      ctx.globalAlpha = alpha * (e.nil ? (this.load || f.debt?.id === e.b ? .32 : .025) : quiet || focused ? .8 : .25);
      if (conflict) {
        ctx.strokeStyle = '#ff3b3033'; ctx.lineWidth = 6;
        ctx.beginPath();
        const r = 26 * this.camera.scale, d = Math.hypot(b.x - a.x, b.y - a.y);
        for (let i = 0; i <= 14; i++) {
          const t = mix(r / d, 1 - r / d, i / 14), strength = this.reduced ? 0 : Math.sin(i * 11 + this.clock * 75) * 4;
          const x = mix(a.x, b.x, t) + strength, y = mix(a.y, b.y, t);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.strokeStyle = '#ff6c56'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore(); return;
      }
      const r = 25 * this.camera.scale, d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
      const endR = e.nil ? 7 * this.camera.scale : r;
      const start = { x: a.x + ux * r, y: a.y + uy * r }, end = { x: b.x - ux * endR, y: b.y - uy * endR };
      const sign = end.x < start.x ? -1 : 1;
      const tension = mode ? Math.sin(this.progress * Math.PI) * 8 : 0;
      let endT = mode === 'detach' ? alpha : mode === 'attach' ? alpha : 1;
      const ex = mix(start.x, end.x, endT), ey = mix(start.y, end.y, endT);
      const grad = ctx.createLinearGradient(start.x, start.y, ex, ey);
      grad.addColorStop(0, '#8296b08a'); grad.addColorStop(.55, '#7389a17d'); grad.addColorStop(1, b.red > .5 ? '#ff3b3085' : '#586b838a');
      ctx.strokeStyle = mode === 'detach' || mode === 'cut-preview' ? '#efb478' : mode === 'attach' ? '#b5d9fb' : route ? '#c1d6f1' : grad;
      ctx.lineWidth = mode || route ? 1.6 : 1.1;
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.quadraticCurveTo((start.x + ex) / 2 + sign * tension, (start.y + ey) / 2 + 6 + tension, ex, ey); ctx.stroke();
      if (!e.nil && (!this.reduced || route)) {
        const t = route ? clamp(this.progress * 1.4) : (this.clock * .18 + (a.x % 9) / 9 + 1) % 1;
        const pulse = { x: mix(start.x, end.x, t), y: mix(start.y, end.y, t) + Math.sin(t * Math.PI) * 3 };
        this.glowDot(pulse.x, pulse.y, route ? 2.3 : 1.1);
      }
      ctx.restore();
    }

    rotationGuides() {
      const ctx = this.ctx, meta = this.frame.rotation, radius = 25 * this.camera.scale;
      for (const [id, rising] of [[meta.up, true], [meta.pivot, false]]) {
        const a = this.frame.type === 'rotate' ? this.screen.get(id) : this.toScreen(this.rotationBefore.points.get(id));
        const b = this.toScreen(this.rotationAfter.points.get(id));
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < (radius + 8) * 2 + 8) continue;
        const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
        const start = { x: a.x + ux * (radius + 8), y: a.y + uy * (radius + 8) };
        const end = { x: b.x - ux * (radius + 8), y: b.y - uy * (radius + 8) };
        const bend = (rising ? -1 : 1) * (meta.direction === 'left' ? 1 : -1);
        const control = { x: (start.x + end.x) / 2 + bend * 34 * this.camera.scale, y: (start.y + end.y) / 2 - 15 * this.camera.scale };
        ctx.save(); ctx.globalAlpha = this.frame.type === 'rotate' ? .65 * (1 - this.progress) : .85;
        ctx.strokeStyle = rising ? '#b9d7f4' : '#92a3ba'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.15;
        ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(start.x, start.y);
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
        const angle = Math.atan2(end.y - control.y, end.x - control.x), size = 7;
        ctx.beginPath(); ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - Math.cos(angle - .48) * size, end.y - Math.sin(angle - .48) * size);
        ctx.lineTo(end.x - Math.cos(angle + .48) * size, end.y - Math.sin(angle + .48) * size);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }

    rotationLabels() {
      const ctx = this.ctx, f = this.frame, meta = f.rotation, r = 25 * this.camera.scale;
      ctx.save(); ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
      if (f.type !== 'rotation-attach') {
        for (const [id, rising] of [[meta.up, true], [meta.pivot, false]]) {
          const point = this.screen.get(id);
          if (!point) continue;
          ctx.fillStyle = rising ? '#bed7f0' : '#92a1b7'; ctx.textAlign = rising ? 'right' : 'left';
          const action = f.type === 'rotate' && this.progress >= 1 ? '已到位' : rising ? '上升' : '下沉';
          ctx.fillText(`${point.value} ${action}`, point.x + (rising ? -1 : 1) * (r + 11), point.y);
        }
      } else if (meta.transfer) {
        const point = this.screen.get(meta.transfer), parent = this.nodesById.get(meta.pivot);
        if (point && parent) {
          ctx.fillStyle = '#bed7f0'; ctx.textAlign = 'center';
          ctx.fillText(`子树 ${point.value} → ${parent.value}`, point.x, point.y + r + 18);
        }
      }
      const ports = f.type === 'rotation-attach' ? this.edgesAfter.filter(e => this.attachedKeys.has(e.key)) : this.detachedEdges;
      if (f.type !== 'anticipate') for (const edge of ports) {
        if (edge.nil) continue;
        const a = this.screen.get(edge.a), b = this.screen.get(edge.b);
        if (!a || !b) continue;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
        ctx.globalAlpha = f.type === 'rotation-attach' ? 1 - this.progress : .8;
        ctx.strokeStyle = f.type === 'rotation-attach' ? '#b5d9fb' : '#efb478'; ctx.fillStyle = '#10141c'; ctx.lineWidth = 1;
        for (const [point, direction] of [[a, 1], [b, -1]]) {
          ctx.beginPath(); ctx.arc(point.x + ux * r * direction, point.y + uy * r * direction, 2.5, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }

    effectsBehind() {
      const ctx = this.ctx, f = this.frame, p = this.progress;
      if (this.rotationStage && f.type !== 'rotation-attach') this.rotationGuides();
      if (f.flow) for (const flow of f.flow) this.flow(flow, f.type === 'push-black' ? 'black' : 'red');
    }

    effectsFront() {
      const ctx = this.ctx, f = this.frame, p = this.progress;
      if (this.rotationStage) this.rotationLabels();
      if (f.type === 'replace' && f.successor) this.successor();
      if (['recolor', 'recolor-up', 'root-cool', 'absorb'].includes(f.type)) {
        f.focus.forEach(id => {
          const point = this.screen.get(id), start = this.starts.get(id);
          if (!point || (start?.color === point.color && f.type !== 'root-cool')) return;
          ctx.save(); ctx.globalAlpha = Math.sin(p * Math.PI) * .55;
          const r = (26 + p * 25) * this.camera.scale;
          ctx.strokeStyle = point.color === 'black' ? '#ccdffb' : '#ff6a59'; ctx.lineWidth = 1.4 * (1 - p) + .3;
          ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        });
      }
      if (f.type === 'settle' || f.type === 'root-cool') {
        const root = this.screen.get(f.tree.root);
        if (root && !this.reduced) {
          ctx.save(); ctx.globalAlpha = (1 - p) * .16; ctx.strokeStyle = '#a8bdda'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(root.x, root.y, 35 + p * this.w * .55, 35 + p * this.h * .6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
      }
      this.bubbles = this.bubbles.filter(b => this.clock - b.born < 1.2);
      this.bubbles.forEach(b => {
        const a = this.screen.get(b.node), age = this.clock - b.born;
        if (!a) return;
        const appearance = clamp(age / .12), fade = clamp((1.2 - age) / .45);
        const x = a.x + (b.side === 'left' ? -27 : 27) * this.camera.scale, y = a.y - 69 * this.camera.scale - Math.max(0, age - .65) * 9;
        ctx.save(); ctx.globalAlpha = appearance * fade * (b.node === f.comparison?.node ? 1 : .45);
        this.bubble(x, y, `${b.value} ${b.relation} ${a.value}`, 1 + (this.reduced ? 0 : Math.sin(appearance * Math.PI) * .06));
        ctx.restore();
      });
    }

    bubble(x, y, text, scale = 1) {
      const ctx = this.ctx;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      ctx.font = '11px "DejaVu Sans Mono", monospace';
      const width = ctx.measureText(text).width + 22;
      const grad = ctx.createLinearGradient(0, -15, 0, 15); grad.addColorStop(0, '#a8c4ef13'); grad.addColorStop(1, '#151c26d9');
      ctx.fillStyle = grad; ctx.strokeStyle = '#cbdcff30'; ctx.lineWidth = .65;
      ctx.beginPath(); ctx.roundRect(-width / 2, -14, width, 28, 14); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#d6e1f0'; ctx.fillText(text, 0, 0); ctx.restore();
    }

    flow(ids, color) {
      const pts = ids.map(id => this.screen.get(id)).filter(Boolean);
      if (pts.length < 2) return;
      const ctx = this.ctx, progress = ease(this.progress);
      const segments = pts.length - 1, which = Math.min(segments - 1, Math.floor(progress * segments)), t = clamp(progress * segments - which);
      const a = pts[which], b = pts[which + 1];
      ctx.save();
      for (let i = 0; i < 12; i++) {
        const behind = clamp(t - i * .014), x = mix(a.x, b.x, behind), y = mix(a.y, b.y, behind);
        ctx.globalAlpha = (1 - i / 12) * Math.sin(this.progress * Math.PI);
        this.glowDot(x, y, i === 0 ? 3 : 2, color === 'red');
      }
      ctx.restore();
    }

    successor() {
      const f = this.frame, pts = f.successor.path.map(id => this.screen.get(id)).filter(Boolean);
      if (pts.length < 2) return;
      const p = ease(this.progress), segments = pts.length - 1, which = Math.min(segments - 1, Math.floor(p * segments)), t = clamp(p * segments - which);
      const a = pts[which], b = pts[which + 1], point = { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), value: f.successor.value };
      const ctx = this.ctx;
      const target = this.screen.get(f.successor.target);
      // Cover the changed value until the clone has physically arrived.
      if (target && p < .9) {
        this.sphere({ ...target, value: f.successor.oldValue }, 25 * this.camera.scale, target.red);
      }
      ctx.save(); ctx.globalAlpha = .45 + .35 * p;
      this.sphere(point, 25 * this.camera.scale, pts[0].red, true); ctx.restore();
      if (target && p > .65) this.dust(target.x, target.y, (p - .65) / .35, '#b8c1cf');
    }

    dissolve(point) {
      const p = this.progress, ctx = this.ctx;
      ctx.save(); ctx.globalAlpha = (1 - p) ** 2;
      this.sphere(point, 25 * this.camera.scale * (1 - p * .3), point.red); ctx.restore();
      if (!this.reduced) this.dust(point.x, point.y, p, point.red > .5 ? '#ff604f' : '#a1adbf');
    }

    dust(x, y, progress, color) {
      const ctx = this.ctx;
      ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = (1 - progress) * .7;
      for (let i = 0; i < 26; i++) {
        const angle = i * 2.399963, distance = 15 + progress * (35 + (i % 7) * 9);
        const px = x + Math.cos(angle) * distance + progress * 25, py = y + Math.sin(angle) * distance + progress * 13;
        ctx.fillRect(px, py, i % 3 === 0 ? 2 : 1, 1.4);
      }
      ctx.restore();
    }

    debtRing(id, alpha = 1) {
      const point = this.screen.get(id) || (this.starts.has(id) ? this.toScreen(this.starts.get(id)) : null);
      if (!point) return;
      const ctx = this.ctx, nil = point.nil || id.startsWith('nil-'), scale = this.camera.scale;
      const r = (nil ? 22 : 36) * scale + (1 - this.progress) * 6 + (this.reduced ? 0 : Math.sin(this.clock * 2.5) * 2);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#06090eee'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#acbedb76'; ctx.lineWidth = .75;
      ctx.beginPath(); ctx.arc(point.x, point.y, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.translate(point.x, point.y); ctx.rotate(this.reduced ? 0 : this.clock * .45);
      ctx.strokeStyle = '#d4dfed8a'; ctx.lineWidth = 1.3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(0, 0, r + 1, i * Math.PI * 2 / 3, i * Math.PI * 2 / 3 + .55); ctx.stroke();
      }
      ctx.restore();
    }

    debtTransfer() {
      const from = this.starts.get(this.frame.fromDebt.id), to = this.screen.get(this.frame.debt?.id);
      if (!from || !to) return;
      const a = this.toScreen(from), p = ease(this.progress), ctx = this.ctx;
      const x = mix(a.x, to.x, p), y = mix(a.y, to.y, p);
      ctx.save(); ctx.globalAlpha = Math.sin(p * Math.PI) * .65; ctx.strokeStyle = '#b5c8e4'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 23 + p * 11, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }

    blackPulses() {
      const f = this.frame, ctx = this.ctx;
      if (!f.tree.root) return;
      const phase = f.type === 'settle' && !this.load ? this.progress : (this.clock / 4) % 1;
      this.paths.forEach(({ ids, blacks }, index) => {
        const pts = ids.map(id => this.screen.get(id)).filter(Boolean);
        if (pts.length < 2) return;
        const t = clamp(phase * (pts.length - 1)), segment = Math.min(pts.length - 2, Math.floor(t)), local = t - segment;
        const a = pts[segment], b = pts[segment + 1], x = mix(a.x, b.x, local), y = mix(a.y, b.y, local);
        ctx.save(); ctx.globalAlpha = this.load ? .42 : Math.sin(phase * Math.PI) * .23;
        ctx.strokeStyle = '#b6c9e7'; ctx.lineWidth = .7; ctx.fillStyle = '#05090f';
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (this.load && phase > .78) {
          const end = pts.at(-1);
          ctx.fillStyle = '#a8b5c9'; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${blacks} 份`, end.x, end.y + 18 + index % 2 * 4);
        }
        ctx.restore();
      });
    }

    updateNote(active) {
      const f = this.frame, message = this.message && this.clock < this.message.until ? this.message : null;
      const chosen = this.hover || this.selected;
      const point = this.screen.get(message?.anchor || (!active && chosen) || f.anchor || f.tree.root) || (message ? this.screen.get('nil-root') : null);
      let title = message?.title || f.title, text = message?.text || f.text;
      if (!message && f.type === 'rotate' && this.progress >= 1) {
        title = '旋转到位 · 等待接线';
        text = '节点已到新位置，改挂连线保持断开；下一步再接回';
      }
      if (!message && !chosen && ['settle', 'reject'].includes(f.type) && this.frameAge > 3.5) { this.note.classList.remove('visible'); return; }
      if (!message && chosen && !active) {
        const n = this.nodesById.get(chosen);
        if (n) { title = `${n.value} · ${n.color === 'red' ? '红色能量' : '黑色承重'}`; text = '点选后可直接删除；空叶也计一份黑色承重'; }
      }
      if (!point || (f.type === 'ready' && !message && !chosen && !f.showNote)) { this.note.classList.remove('visible'); return; }
      const large = this.camera.scale * 25;
      // Prefer empty space beside the focus; a leaf's note can sit directly below it.
      const hasChildren = point.left || point.right;
      let noteX = hasChildren ? point.x + (point.x < this.w / 2 ? -1 : 1) * (this.w < 621 ? 76 : 130) : point.x;
      let noteY = hasChildren ? point.y - large - 65 : point.y + large + 22;
      if (this.rotationStage && !message) {
        const points = [this.rotationBefore, this.rotationAfter].flatMap(view =>
          [f.rotation.pivot, f.rotation.up].map(id => this.toScreen(view.points.get(id))));
        const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
        const offset = this.w < 621 ? 125 : 195;
        noteX = (minX + maxX) / 2 < this.w / 2 ? maxX + offset : minX - offset;
        if (this.w < 621) {
          const bottom = Math.max(...[this.rotationBefore, this.rotationAfter].flatMap(view =>
            this.rotationSubtree.map(id => this.toScreen(view.points.get(id)).y)));
          noteY = bottom + large + 24;
        } else noteY = (minY + maxY) / 2 - 13;
      }
      noteY = clamp(noteY, 115, Math.max(130, this.h - (this.w < 621 ? 245 : 190)));
      const x = Math.round(clamp(noteX, this.w < 621 ? 120 : 165, this.w - (this.w < 621 ? 120 : 165))), y = Math.round(noteY);
      if (this.noteX !== x || this.noteY !== y) {
        this.note.style.transform = `translate3d(${x}px, ${y}px, 0) translateX(-50%)`;
        this.noteX = x; this.noteY = y;
      }
      if (this.note.dataset.title !== title || this.note.dataset.text !== text) {
        this.note.replaceChildren();
        const a = document.createElement('span'); a.className = `note-title${f.type === 'conflict' ? ' is-danger' : f.type === 'settle' ? ' is-balanced' : ''}`; a.textContent = title;
        const b = document.createElement('span'); b.className = 'note-text'; b.textContent = text;
        this.note.append(a, b); this.note.dataset.title = title; this.note.dataset.text = text;
      }
      this.note.classList.add('visible');
    }
  }

  global.RedBlackVisual = { TreeRenderer, layout };
})(window);
