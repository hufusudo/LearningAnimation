/* 置换-选择流程主舞台。GSAP只推进时刻，不直接修改教学对象。 */
(function () {
  'use strict';
  const M = window.ReplacementModel, C = window.ReplacementChoreo;
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const attr = (el, key, value) => { const text = String(value); if (el.getAttribute(key) !== text) el.setAttribute(key, text); };
  const text = (el, value) => { const s = String(value); if (el.textContent !== s) el.textContent = s; };
  function svg(tag, attrs, parent) { const el = document.createElementNS(svgNS, tag); Object.entries(attrs || {}).forEach(([k, v]) => attr(el, k, v)); if (parent) parent.appendChild(el); return el; }

  class ReplacementFlow {
    constructor() {
      const params = new URLSearchParams(location.hash.slice(1));
      this.preset = Object.hasOwn(M.PRESETS, params.get('rs-p')) ? params.get('rs-p') : 'textbook';
      this.capacity = [4, 5, 6, 7, 8].includes(Number(params.get('rs-w'))) ? Number(params.get('rs-w')) : 6;
      this.speed = params.has('rs-s') && Number.isFinite(Number(params.get('rs-s'))) ? clamp(Number(params.get('rs-s')), .5, 2.5) : 1;
      this.media = matchMedia('(prefers-reduced-motion: reduce)');
      this.motionOverridden = params.has('rs-m');
      this.reduced = this.motionOverridden ? params.get('rs-m') === '1' : this.media.matches;
      this.clock = { t: 0 }; this.playing = false; this.stopAt = null; this.timeline = null; this.delay = null; this.hashTimer = null;
      this.archiveKey = ''; this.completed = false;
      $('rs-capacity').value = this.capacity; $('rs-speed').value = this.speed; $('rs-reduce-motion').checked = this.reduced;
      text($('rs-speed-value'), this.speed.toFixed(2) + '×');
      this.bind();
      this.rebuild(Number(params.get('rs-t')) || 0);
      if (!window.gsap) { $('rs-play').disabled = true; text($('rs-engine-notice'), '动画引擎未加载，仍可单步与拖动查看全部状态。'); }
    }
    bind() {
      $('rs-play').addEventListener('click', () => this.playing ? this.pause() : this.play());
      $('rs-next').addEventListener('click', () => this.next());
      $('rs-prev').addEventListener('click', () => this.seek(Math.max(0, Math.ceil(this.clock.t - 1e-6) - 1)));
      $('rs-reset').addEventListener('click', () => this.seek(0));
      $('rs-progress').addEventListener('input', e => this.seek(Number(e.target.value), false));
      $('rs-progress').addEventListener('change', () => this.writeHash(true));
      $('rs-capacity').addEventListener('change', e => { this.capacity = Number(e.target.value); this.rebuild(this.clock.t); });
      document.querySelectorAll('[data-rs-preset]').forEach(button => button.addEventListener('click', () => { this.preset = button.dataset.rsPreset; this.rebuild(this.clock.t); }));
      $('rs-speed').addEventListener('input', e => {
        this.speed = Number(e.target.value); text($('rs-speed-value'), this.speed.toFixed(2) + '×');
        if (this.timeline) this.timeline.timeScale(this.speed);
        if (this.delay) this.delay.timeScale(this.speed);
        this.writeHash(false);
      });
      const setMotion = () => {
        const resume = this.playing, stopAt = this.stopAt;
        this.pause(); this.reduced = $('rs-reduce-motion').checked;
        if (this.reduced) this.seek(Math.ceil(this.clock.t));
        this.render(); if (resume && (stopAt === null || this.clock.t < stopAt)) this.play(stopAt); this.writeHash(true);
      };
      $('rs-reduce-motion').addEventListener('change', () => { this.motionOverridden = true; setMotion(); });
      this.media.addEventListener('change', () => { if (!this.motionOverridden) { $('rs-reduce-motion').checked = this.media.matches; setMotion(); } });
      document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,select,textarea,button,a,[contenteditable="true"]')) return;
        if (e.code === 'Space') { e.preventDefault(); this.playing ? this.pause() : this.play(); }
        if (e.code === 'ArrowRight') { e.preventDefault(); this.next(); }
        if (e.code === 'ArrowLeft') { e.preventDefault(); this.seek(Math.max(0, Math.ceil(this.clock.t - 1e-6) - 1)); }
        if (e.code === 'Home') { e.preventDefault(); this.seek(0); }
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
      window.addEventListener('pagehide', () => { this.pause(); this.timeline?.kill(); clearTimeout(this.hashTimer); });
      $('rs-import').addEventListener('click', () => {
        if (!this.completed || !window.treeEngine) return;
        window.treeEngine.setCustomRuns(this.sequence.final.runs.filter(run => run.length).map(run => run.length));
        text($('rs-import'), '已导入实际段长 ↓');
        $('tree-section').scrollIntoView({ behavior: this.reduced ? 'instant' : 'smooth' });
      });
    }
    rebuild(keep = 0) {
      this.pause(); this.timeline?.kill();
      this.sequence = M.buildSequence(M.PRESETS[this.preset], this.capacity);
      this.archiveKey = ''; this.completed = false;
      $('rs-progress').max = this.sequence.duration;
      document.querySelectorAll('[data-rs-preset]').forEach(button => attr(button, 'aria-pressed', button.dataset.rsPreset === this.preset));
      this.makeObjects();
      if (window.gsap) {
        this.clock.t = 0;
        this.timeline = gsap.timeline({ paused: true, onUpdate: () => this.tick(), onComplete: () => this.pause() });
        this.timeline.to(this.clock, { t: this.sequence.duration, duration: this.sequence.duration, ease: 'none' });
        this.timeline.timeScale(this.speed);
      }
      this.seek(clamp(keep, 0, this.sequence.duration));
    }
    makeObjects() {
      const container = $('rs-tokens'); container.replaceChildren();
      this.tokenNodes = this.sequence.tokens.map(token => {
        const group = svg('g', { 'data-token': token.id }, container);
        const rect = svg('rect', { x: -17, y: -17, width: 34, height: 34, rx: 7, 'stroke-width': 1.3 }, group);
        const label = svg('text', { y: 5, class: 'rs-token-text' }, group); label.textContent = token.value;
        const caption = svg('text', { y: 29, class: 'rs-token-caption' }, group);
        return { group, rect, label, caption };
      });
      $('rs-edges').replaceChildren();
      this.edges = Array.from({ length: 7 }, () => svg('line', { stroke: '#bdcdbb', 'stroke-width': 1.4 }, $('rs-edges')));
      $('rs-placeholders').replaceChildren();
      this.sequence.tokens.forEach((_, i) => {
        const p = C.inputPosition(i);
        svg('rect', { x: p.x - 17, y: p.y - 17, width: 34, height: 34, rx: 7, stroke: '#e5e8df', fill: 'none', 'stroke-dasharray': '2 3' }, $('rs-placeholders'));
      });
      for (let i = 0; i < this.capacity; i++) {
        const p = C.heapPosition(i);
        svg('rect', { x: p.x - 18, y: p.y - 18, width: 36, height: 36, rx: 8, stroke: '#dce5d7', fill: 'none', 'stroke-dasharray': '2 3' }, $('rs-placeholders'));
      }
      this.cursor = svg('path', { d: 'M-4 0L4 0L0 -5Z', fill: '#315fb4' }, $('rs-placeholders'));
      $('rs-focus').replaceChildren();
      this.rings = Array.from({ length: 8 }, () => svg('rect', { x: -22, y: -22, width: 44, height: 44, rx: 11, fill: 'none', stroke: '#315fb4', 'stroke-width': 2 }, $('rs-focus')));
      $('rs-flight-path').replaceChildren();
      this.flight = svg('path', { fill: 'none', stroke: '#315fb4', 'stroke-width': 1.4, 'stroke-dasharray': '3 5' }, $('rs-flight-path'));
    }
    tick() {
      if (this.stopAt !== null && this.clock.t >= this.stopAt) { const end = this.stopAt; this.seek(end); return; }
      this.render(); this.writeHash(false);
    }
    seek(value, immediateHash = true) {
      this.pause(false);
      const t = clamp(Number(value) || 0, 0, this.sequence.duration);
      const target = this.reduced ? Math.round(t) : t;
      this.timeline?.time(target, true); this.clock.t = target;
      this.render(); this.writeHash(immediateHash);
    }
    next() {
      if (this.clock.t >= this.sequence.duration) return;
      const target = Math.min(this.sequence.duration, Math.floor(this.clock.t + 1e-6) + 1);
      if (!window.gsap || this.reduced) this.seek(target);
      else { this.pause(); this.play(target); }
    }
    play(stopAt = null) {
      if (!window.gsap) return;
      if (this.clock.t >= this.sequence.duration) this.seek(0);
      this.stopAt = stopAt; this.playing = true; this.updatePlayback();
      if (this.reduced) this.scheduleReduced();
      else this.timeline.play();
    }
    scheduleReduced() {
      this.delay = gsap.delayedCall(.9, () => {
        this.delay = null;
        if (!this.playing) return;
        const next = Math.min(this.sequence.duration, Math.floor(this.clock.t + 1e-6) + 1);
        this.clock.t = next; this.timeline.time(next, true); this.render(); this.writeHash(false);
        if (next >= this.sequence.duration || this.stopAt !== null && next >= this.stopAt) this.pause();
        else this.scheduleReduced();
      });
      this.delay.timeScale(this.speed);
    }
    pause(write = true) {
      this.timeline?.pause(); this.delay?.kill(); this.delay = null;
      this.playing = false; this.stopAt = null; this.updatePlayback();
      if (write && this.sequence) this.writeHash(true);
    }
    updatePlayback() {
      text($('rs-play-label'), this.playing ? '暂停' : '播放'); text($('rs-play-icon'), this.playing ? 'Ⅱ' : '▶');
      attr($('rs-stage'), 'data-playing', this.playing);
    }
    render() {
      const seq = this.sequence, t = this.clock.t, frame = C.sample(seq, t);
      attr($('rs-section'), 'data-reduced', this.reduced);
      frame.tokens.forEach((token, i) => {
        const el = this.tokenNodes[i];
        attr(el.group, 'transform', `translate(${token.x.toFixed(3)} ${token.y.toFixed(3)})`);
        attr(el.group, 'opacity', token.opacity.toFixed(3)); attr(el.group, 'visibility', token.opacity <= 0 ? 'hidden' : 'visible');
        attr(el.rect, 'fill', token.fill); attr(el.rect, 'stroke', token.stroke);
        attr(el.rect, 'stroke-dasharray', token.zone === 'frozen' ? '3 2' : 'none');
        text(el.caption, token.caption); attr(el.caption, 'fill', '#6b7066');
      });
      frame.edges.forEach((edge, i) => { const el = this.edges[i]; attr(el, 'x1', edge.from.x); attr(el, 'y1', edge.from.y); attr(el, 'x2', edge.to.x); attr(el, 'y2', edge.to.y); attr(el, 'opacity', edge.opacity.toFixed(3)); });
      this.rings.forEach((el, i) => { const focus = frame.focus[i]; attr(el, 'visibility', focus && focus.opacity > 0 ? 'visible' : 'hidden'); if (focus) { attr(el, 'transform', `translate(${focus.x} ${focus.y})`); attr(el, 'opacity', focus.opacity.toFixed(3)); } });
      const path = frame.path;
      attr(this.flight, 'visibility', path ? 'visible' : 'hidden');
      if (path) { attr(this.flight, 'd', path.points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')); attr(this.flight, 'opacity', path.opacity.toFixed(3)); }
      const read = frame.counts.read;
      attr(this.cursor, 'transform', `translate(${C.inputPosition(Math.min(read, seq.tokens.length - 1)).x} 108)`);
      attr(this.cursor, 'visibility', read >= seq.tokens.length ? 'hidden' : 'visible');
      for (const [id, key] of [['rs-phase', 'phase'], ['rs-narration', 'message'], ['rs-last-key', 'lastKey'], ['rs-decision', 'decision'], ['rs-op', 'operator']]) {
        text($(id), frame[key].text); $(id).style.opacity = frame[key].opacity;
      }
      text($('rs-time'), t.toFixed(2));
      text($('rs-event-label'), t >= seq.duration ? '全部记录已生成归并段' : seq.steps[Math.floor(t)]?.label || '准备开始');
      text($('rs-input-count'), `已读 ${read} / ${seq.tokens.length} · 从左向右读取`);
      text($('rs-occupancy'), `占用 ${frame.counts.occupied} / ${this.capacity}`);
      text($('rs-active-count'), `${frame.counts.active} 个`); text($('rs-frozen-count'), `${frame.counts.frozen} 个`);
      text($('rs-run-title'), `R${frame.runIndex + 1} · ${t >= seq.duration ? '已完成' : '当前段'}`);
      text($('rs-run-count'), `长度 ${frame.counts.runLength}`);
      $('rs-run-title').style.opacity = frame.archiveOpacity;
      text($('rs-total-output'), `已输出 ${frame.counts.output} / ${seq.tokens.length}`);
      for (const [id, key] of [['rs-input-count', 'read'], ['rs-occupancy', 'occupied'], ['rs-active-count', 'active'], ['rs-frozen-count', 'frozen'], ['rs-run-count', 'runLength'], ['rs-total-output', 'output']]) $(id).style.opacity = frame.countOpacity[key];
      text($('rs-event-tag').querySelector('text'), frame.tag.text); attr($('rs-event-tag'), 'opacity', frame.tag.opacity.toFixed(3));
      $('rs-progress').value = t; attr($('rs-progress'), 'aria-valuetext', `事件 ${Math.floor(t)}，共 ${seq.duration} 步`);
      text($('rs-step-count'), `${Math.floor(t)} / ${seq.duration}`);
      $('rs-prev').disabled = t <= 0; $('rs-next').disabled = t >= seq.duration;
      this.completed = t >= seq.duration;
      $('rs-import').disabled = !this.completed;
      text($('rs-import'), this.completed ? '将实际段长导入最佳归并树 ↓' : '生成完成后导入最佳归并树 ↓');
      this.renderArchive(frame);
    }
    renderArchive(frame) {
      const key = JSON.stringify([frame.runIndex, frame.runs]);
      if (key !== this.archiveKey) {
        this.archiveKey = key;
        $('rs-run-tracks').replaceChildren();
        frame.runs.forEach((run, r) => {
          const row = document.createElement('div'); row.className = 'rs-run-row'; row.dataset.current = r === frame.runIndex;
          const jump = document.createElement('button'); jump.type = 'button'; jump.textContent = `R${r + 1} · ${run.length} 数`;
          jump.title = `定位到 R${r + 1} 的开始`;
          jump.addEventListener('click', () => {
            const index = this.sequence.steps.findIndex(step => step.type === (r === 0 ? 'ready' : 'new-run') && step.after.runIndex === r);
            this.seek(index >= 0 ? index + 1 : 0);
          });
          row.append(jump);
          const values = document.createElement('div'); values.className = 'rs-run-values';
          if (!run.length) { const empty = document.createElement('small'); empty.className = 'rs-run-empty'; empty.textContent = '等待输出'; values.append(empty); }
          run.forEach(token => { const pill = document.createElement('span'); pill.textContent = token.value; pill.dataset.record = token.id; values.append(pill); });
          row.append(values); $('rs-run-tracks').append(row);
        });
      }
      $('rs-run-tracks').style.opacity = frame.archiveOpacity;
      $('rs-run-tracks').querySelectorAll('[data-record]').forEach(pill => { pill.style.opacity = frame.archiveAlpha[pill.dataset.record] ?? 1; });
    }
    writeHash(immediate) {
      if (!this.sequence) return;
      const write = () => {
        this.hashTimer = null;
        const params = new URLSearchParams({ 'rs-t': this.clock.t.toFixed(2), 'rs-p': this.preset, 'rs-w': this.capacity, 'rs-s': this.speed });
        if (this.motionOverridden) params.set('rs-m', this.reduced ? '1' : '0');
        try { history.replaceState(null, '', '#' + params); } catch { /* file://禁止修改地址栏时不影响演示。 */ }
      };
      if (immediate) { clearTimeout(this.hashTimer); write(); }
      else if (!this.hashTimer) this.hashTimer = setTimeout(write, 300);
    }
  }
  document.addEventListener('DOMContentLoaded', () => { window.rsEngine = new ReplacementFlow(); });
})();
