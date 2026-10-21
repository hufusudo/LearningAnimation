(function (global) {
  'use strict';
  const RED = 'red', BLACK = 'black';

  class RBTree {
    constructor() {
      this.nil = { id: null, color: BLACK };
      this.nil.left = this.nil.right = this.nil.parent = this.nil;
      this.root = this.nil;
      this.nextId = 1;
      this.frames = [];
      this.debt = null;
    }

    static from(values) {
      const tree = new RBTree();
      values.forEach(value => tree.insert(value));
      tree.frames = [];
      return tree;
    }

    static fromSnapshot(snapshot) {
      const tree = new RBTree(), nodes = new Map();
      snapshot.nodes.forEach(n => nodes.set(n.id, { id: n.id, value: n.value, color: n.color }));
      snapshot.nodes.forEach(n => {
        const node = nodes.get(n.id);
        node.left = nodes.get(n.left) || tree.nil; node.right = nodes.get(n.right) || tree.nil;
        node.parent = nodes.get(n.parent) || tree.nil;
      });
      tree.root = nodes.get(snapshot.root) || tree.nil;
      tree.nextId = Math.max(0, ...snapshot.nodes.map(n => Number(n.id.slice(1)))) + 1;
      const report = tree.validate();
      if (!report.valid) throw new Error('只能从已平衡的快照继续操作');
      return tree;
    }

    snapshot() {
      const nodes = [];
      const walk = n => {
        if (n === this.nil) return;
        nodes.push({ id: n.id, value: n.value, color: n.color, left: n.left.id, right: n.right.id, parent: n.parent.id });
        walk(n.left); walk(n.right);
      };
      walk(this.root);
      return { root: this.root.id, nodes };
    }

    values() {
      const values = [];
      const walk = n => { if (n !== this.nil) { walk(n.left); values.push(n.value); walk(n.right); } };
      walk(this.root);
      return values;
    }

    validate() {
      const errors = [], seen = new Set();
      if (this.root.color !== BLACK) errors.push('根必须为黑');
      if (this.root !== this.nil && this.root.parent !== this.nil) errors.push('根的父指针错误');
      const walk = (n, low, high) => {
        if (n === this.nil) return 1;
        if (seen.has(n.id)) { errors.push('节点重复或成环'); return 0; }
        seen.add(n.id);
        if (!(n.value > low && n.value < high)) errors.push(`BST 顺序错误：${n.value}`);
        if (n.color === RED && (n.left.color === RED || n.right.color === RED)) errors.push(`连续红：${n.value}`);
        for (const child of [n.left, n.right]) if (child !== this.nil && child.parent !== n) errors.push('父子指针错误');
        const l = walk(n.left, low, n.value), r = walk(n.right, n.value, high);
        if (l !== r) errors.push(`黑高不等：${n.value}`);
        return l + (n.color === BLACK ? 1 : 0);
      };
      const blackHeight = walk(this.root, -Infinity, Infinity);
      return { valid: !errors.length, errors, blackHeight, count: seen.size };
    }

    emit(type, title, text, options = {}) {
      const durations = { ready: 700, spawn: 750, compare: 400, attach: 650, conflict: 900,
        anticipate: 700, 'rotation-detach': 600, rotate: 1200, 'rotation-attach': 650,
        recolor: 900, 'recolor-up': 1100, 'root-cool': 500,
        successor: 600, replace: 1400, remove: 950, debt: 900, 'push-black': 1200,
        borrow: 1200, absorb: 750, settle: 1600, reject: 1200 };
      this.frames.push({ type, title, text, duration: durations[type] || 800, tree: this.snapshot(),
        focus: [], anchor: this.root.id, debt: this.debt ? { ...this.debt } : null, ...options });
    }

    begin(value, verb) {
      if (!Number.isInteger(value) || value < -999 || value > 999) throw new TypeError('请输入 -999～999 的整数');
      this.frames = [];
      this.debt = null;
      this.emit('ready', `${verb} ${value}`, verb === '插入' ? '红色新球沿大小关系寻找空位' : '沿树枝寻找待删除的节点');
    }

    locate(value, inserting = false, incomingId = null) {
      let x = this.root, parent = this.nil;
      while (x !== this.nil) {
        const equal = value === x.value, left = value < x.value;
        const next = equal ? this.nil : left ? x.left : x.right;
        this.emit('compare', `${value} ${equal ? '=' : left ? '<' : '>'} ${x.value}`,
          equal ? '找到相同数值' : left ? '较小，沿左支路' : '较大，沿右支路',
          { focus: [x.id], anchor: x.id, route: [x.id, next.id], comparison: { value, node: x.id, relation: equal ? '=' : left ? '<' : '>' },
            ghost: inserting ? { id: incomingId, value, near: x.id, side: left ? 'left' : 'right' } : null });
        if (equal) return { node: x, parent };
        parent = x; x = next;
      }
      return { node: this.nil, parent };
    }

    insert(value) {
      this.begin(value, '插入');
      // Reject duplicates before allocating the incoming node's identifier.
      let existing = this.root;
      while (existing !== this.nil && existing.value !== value) existing = value < existing.value ? existing.left : existing.right;
      if (existing !== this.nil) {
        this.emit('reject', `${value} 已在树中`, '红黑树保留唯一键，请换一个数值', { focus: [existing.id], anchor: existing.id });
        return this.frames;
      }
      const z0 = { id: `n${this.nextId++}`, value, color: RED, left: this.nil, right: this.nil, parent: this.nil };
      this.emit('spawn', `插入 ${value}`, '新节点携带红色能量，开始下落', { ghost: { id: z0.id, value, spawn: true } });
      const { parent } = this.locate(value, true, z0.id);
      z0.parent = parent;
      if (parent === this.nil) this.root = z0;
      else if (value < parent.value) parent.left = z0;
      else parent.right = z0;
      this.emit('attach', '接入空位', '新光纤伸出，红球吸附到树中', { focus: [z0.id, parent.id].filter(Boolean), anchor: z0.id, inserted: z0.id });
      let z = z0;
      while (z.parent.color === RED) {
        let p = z.parent, g = p.parent;
        const left = p === g.left, u = left ? g.right : g.left;
        this.emit('conflict', '双红 · 能量过载', u.color === RED ? '叔节点也为红：颜色向祖父汇流' : '叔节点为黑：准备旋转释放应力',
          { focus: [z.id, p.id, g.id, u.id].filter(Boolean), anchor: p.id, conflict: [p.id, z.id], uncle: u.id });
        if (u.color === RED) {
          p.color = BLACK; u.color = BLACK; g.color = RED;
          this.emit('recolor-up', '红色向上汇流', '父与叔冷却为黑，祖父承接红色能量',
            { focus: [p.id, u.id, g.id], anchor: g.id, flow: [[p.id, g.id], [u.id, g.id]] });
          z = g;
        } else {
          if (z === (left ? p.right : p.left)) {
            const oldP = p;
            this.rotation(p, left ? 'left' : 'right', [z.id, p.id, g.id], '先把折线展开');
            z = oldP; p = z.parent; g = p.parent;
          }
          this.rotation(g, left ? 'right' : 'left', [z.id, p.id, g.id], '中间节点顶升，祖父下沉');
          p.color = BLACK; g.color = RED;
          this.emit('recolor', '冷却 · 应力解除', '上升节点转黑，旧祖父染红，电弧消散', { focus: [p.id, g.id, z.id], anchor: p.id });
        }
      }
      if (this.root.color === RED) {
        this.root.color = BLACK;
        this.emit('root-cool', '根节点冷却', '根吸收红色能量，恢复稳定承重', { focus: [this.root.id], anchor: this.root.id });
      }
      this.finish();
      return this.frames;
    }

    rotation(pivot, direction, focus, text, resolvesDebt = false) {
      const up = direction === 'left' ? pivot.right : pivot.left;
      const transfer = direction === 'left' ? up.left : up.right;
      const parent = pivot.parent.id, beforeTree = this.snapshot();
      if (direction === 'left') this.rotateLeft(pivot); else this.rotateRight(pivot);
      const afterTree = this.snapshot();
      const meta = { pivot: pivot.id, up: up.id, direction, transfer: transfer.id, parent, resolvesDebt, beforeTree, afterTree };
      const links = tree => tree.nodes.flatMap(n => [n.left, n.right].filter(Boolean).map(id => ({ key: `${n.id}:${id}`, a: n.value, b: tree.nodes.find(child => child.id === id).value })));
      const beforeLinks = links(beforeTree), afterLinks = links(afterTree);
      const oldKeys = new Set(beforeLinks.map(e => e.key)), newKeys = new Set(afterLinks.map(e => e.key));
      const cut = beforeLinks.filter(e => !newKeys.has(e.key)).map(e => `${e.a}—${e.b}`).join('、');
      const joined = afterLinks.filter(e => !oldKeys.has(e.key)).map(e => `${e.a}—${e.b}`).join('、');
      const involved = [...new Set([...focus, parent, transfer.id].filter(Boolean))];
      const name = direction === 'left' ? '左旋' : '右旋';
      const options = { focus: involved, anchor: up.id, rotation: meta };
      this.emit('anticipate', `需要${name} ${pivot.value}`, `${up.value} 上升，${pivot.value} 下沉 · ${text}`, { ...options, tree: beforeTree });
      this.emit('rotation-detach', `${name} · 先断开连线`, `${cut} 暂时断开，其余支路保持连接`, { ...options, tree: beforeTree });
      this.emit('rotate', `${name} · 移动节点`, `${up.value} 沿箭头上升；${pivot.value} 下沉`, options);
      this.emit('rotation-attach', `${name} · 接回连线`, `${joined} 接入新位置${transfer !== this.nil ? `；子树 ${transfer.value} 改挂到 ${pivot.value}` : ''}`, options);
    }

    rotateLeft(x) {
      const y = x.right;
      x.right = y.left;
      if (y.left !== this.nil) y.left.parent = x;
      y.parent = x.parent;
      if (x.parent === this.nil) this.root = y;
      else if (x === x.parent.left) x.parent.left = y; else x.parent.right = y;
      y.left = x; x.parent = y;
    }

    rotateRight(x) {
      const y = x.left;
      x.left = y.right;
      if (y.right !== this.nil) y.right.parent = x;
      y.parent = x.parent;
      if (x.parent === this.nil) this.root = y;
      else if (x === x.parent.right) x.parent.right = y; else x.parent.left = y;
      y.right = x; x.parent = y;
    }

    debtAt(x) {
      if (x !== this.nil) return { id: x.id, parent: x.parent.id, side: null };
      const p = x.parent;
      if (p === this.nil) return { id: 'nil-root', parent: null, side: null };
      const side = p.left === x ? 'left' : 'right';
      return { id: `nil-${p.id}-${side}`, parent: p.id, side };
    }

    delete(value) {
      this.begin(value, '删除');
      const { node: z } = this.locate(value);
      if (z === this.nil) {
        this.emit('reject', `树中没有 ${value}`, '请点选一个已有节点，或输入其他数值');
        return this.frames;
      }
      let y = z;
      if (z.left !== this.nil && z.right !== this.nil) {
        y = z.right;
        const path = [z.id, y.id];
        this.emit('successor', '寻找后继', '右子树中最小的节点将接管这个位置', { focus: [z.id, y.id], anchor: y.id, route: [z.id, y.id] });
        while (y.left !== this.nil) {
          const previous = y; y = y.left; path.push(y.id);
          this.emit('successor', '沿左支路，寻找最小值', `${y.value} 更小，继续向左`, { focus: [y.id], anchor: y.id, route: [previous.id, y.id] });
        }
        const oldValue = z.value;
        z.value = y.value;
        this.emit('replace', `${y.value} 接管 ${oldValue} 的位置`, '后继虚影逆流而上；随后删除原后继节点',
          { focus: [y.id, z.id], anchor: z.id, successor: { source: y.id, target: z.id, path: path.reverse(), oldValue, value: y.value } });
      }
      const removed = { id: y.id, value: y.value, color: y.color, parent: y.parent.id };
      const x = y.left !== this.nil ? y.left : y.right;
      x.parent = y.parent;
      if (y.parent === this.nil) this.root = x;
      else if (y === y.parent.left) y.parent.left = x; else y.parent.right = x;
      if (removed.color === BLACK) this.debt = this.debtAt(x);
      this.emit('remove', removed.color === RED ? '红节点消散' : '黑节点抽离 · 留下一份负重',
        removed.color === RED ? '不损失黑色承重，树保持平衡' : '原路径少了一份黑色，需要修复',
        { focus: [x.id, removed.parent].filter(Boolean), anchor: x.id || removed.parent, removed });
      if (removed.color === BLACK) this.deleteFix(x);
      this.finish();
      return this.frames;
    }

    deleteFix(x) {
      while (x !== this.root && x.color === BLACK) {
        const p = x.parent, isLeft = x === p.left, side = isLeft ? 'left' : 'right';
        let w = isLeft ? p.right : p.left;
        this.debt = this.debtAt(x);
        this.emit('debt', '双黑 · 黑色承重缺口', '兄弟分支正在寻找可支援的红色能量',
          { focus: [x.id, p.id, w.id].filter(Boolean), anchor: this.debt.id, sibling: w.id });
        if (w.color === RED) {
          w.color = BLACK; p.color = RED;
          this.emit('recolor', '红兄弟先冷却', '旋转后，黑色兄弟进入支援位置',
            { focus: [p.id, w.id], anchor: p.id, case: 'sibling-red', side });
          this.rotation(p, isLeft ? 'left' : 'right', [p.id, w.id], '红兄弟顶升，切换支援分支');
          // NIL is shared: its parent stays the logical debt parent through rotations.
          w = isLeft ? p.right : p.left;
        }
        const near = () => isLeft ? w.left : w.right;
        const far = () => isLeft ? w.right : w.left;
        if (near().color === BLACK && far().color === BLACK) {
          const oldDebt = { ...this.debt };
          if (w !== this.nil) w.color = RED;
          x = p; this.debt = this.debtAt(x);
          this.emit('push-black', '无红可借 · 负重上移', '兄弟染红，父节点接过缺少的一份黑色',
            { focus: [p.id, w.id].filter(Boolean), anchor: p.id, fromDebt: oldDebt,
              flow: [[p.id, oldDebt.id], [p.id, w.id]], case: 'push-black', side });
        } else {
          if (far().color === BLACK) {
            const n = near(); n.color = BLACK; w.color = RED;
            this.emit('recolor', '近侧红能量转向', '先旋转兄弟，让红节点到达外侧',
              { focus: [p.id, w.id, n.id], anchor: w.id, case: 'near-red', side });
            this.rotation(w, isLeft ? 'right' : 'left', [w.id, n.id, p.id], '近侧红节点顶升，准备向外借位');
            w = isLeft ? p.right : p.left;
          }
          const donor = far();
          this.emit('borrow', '外侧红 · 向缺口支援', '流光穿过父节点，旋转与变色共同补足承重',
            { focus: [p.id, w.id, donor.id].filter(Boolean), anchor: this.debt.id,
              flow: [[donor.id, w.id, p.id, this.debt.id]], case: 'far-red', side });
          w.color = p.color; p.color = BLACK; donor.color = BLACK;
          this.emit('recolor', '重新分配黑色承重', '父与外侧节点转黑，兄弟接替父节点的颜色',
            { focus: [p.id, w.id, donor.id], anchor: w.id });
          this.rotation(p, isLeft ? 'left' : 'right', [p.id, w.id, donor.id], '兄弟接管父位置，缺口恢复承重', true);
          this.debt = null;
          x = this.root;
        }
      }
      const hadDebt = this.debt !== null;
      const wasRed = x.color === RED;
      x.color = BLACK;
      this.debt = null;
      if (hadDebt) this.emit('absorb', wasRed ? '红节点吸收额外负重' : '根节点释放额外负重',
        wasRed ? '红色冷却为黑，缺少的一份承重得到补足' : '负重到达根，禁锢环瓦解',
        { focus: [x.id].filter(Boolean), anchor: x.id, absorbed: x.id || 'nil-root' });
    }

    finish() {
      this.nil.color = BLACK;
      this.nil.parent = this.nil;
      this.debt = null;
      const report = this.validate();
      if (!report.valid) throw new Error(report.errors.join('；'));
      this.emit('settle', '平衡复原', this.root === this.nil ? '舞台已清空，可以插入新的节点' : '每条根至空叶的路径，承载相同份数的黑色脉冲', { report });
    }
  }

  // 性质检查：只读快照，逐步给出证据，结论由快照现算，不修改树。黑数含根与 NIL；长度为根到 NIL 的边数。
  function propertyFrames(snapshot, key) {
    const byId = new Map(snapshot.nodes.map(n => [n.id, n]));
    const root = byId.get(snapshot.root);
    const frame = (title, text, extra = {}) => ({ type: 'check', title, text, tree: snapshot, focus: [],
      anchor: root ? root.id : null, debt: null, duration: 900, ...extra });
    if (!root) return [frame('空树', '没有节点，各项性质平凡成立', { verdict: true, duration: 1200 })];
    const paths = [], inorder = [];
    const walk = (n, trail) => {
      const here = [...trail, n.id];
      for (const side of ['left', 'right']) {
        const child = byId.get(n[side]);
        if (child) walk(child, here); else paths.push([...here, `nil-${n.id}-${side}`]);
      }
    };
    const visit = n => { if (!n) return; visit(byId.get(n.left)); inorder.push(n); visit(byId.get(n.right)); };
    walk(root, []); visit(root);
    const realIds = inorder.map(n => n.id);
    const label = path => path.map(id => (byId.has(id) ? byId.get(id).value : 'NIL')).join(' → ');
    const blacks = path => path.filter(id => byId.has(id) && byId.get(id).color === 'black').length + 1;
    const verdict = ok => (ok ? '通过' : '不满足');
    const lastReal = path => path[path.length - 2];
    if (key === 'root') {
      const ok = root.color === 'black';
      return [frame('根为黑', `根节点 ${root.value} 为${ok ? '黑色' : '红色'}，${verdict(ok)}`, { focus: [root.id], verdict: ok, ripple: true, duration: 1400 })];
    }
    if (key === 'redred') {
      const reds = inorder.filter(n => n.color === 'red');
      if (!reds.length) return [frame('不红红', '树中没有红节点，性质自然成立', { focus: realIds, verdict: true, duration: 1200 })];
      const steps = reds.map(r => {
        const kids = ['left', 'right'].map(side => ({ id: byId.has(r[side]) ? r[side] : `nil-${r.id}-${side}`, node: byId.get(r[side]) }));
        const bad = kids.find(k => k.node && k.node.color === 'red');
        const names = kids.map(k => (k.node ? k.node.value : 'NIL')).join('、');
        return frame(`不红红 · 红节点 ${r.value}`, bad ? `孩子 ${bad.node.value} 也是红色，不满足` : `孩子 ${names} 都是黑色`,
          { focus: [r.id, ...kids.map(k => k.id)], anchor: r.id });
      });
      const ok = reds.every(r => ![r.left, r.right].some(id => byId.get(id)?.color === 'red'));
      return [...steps, frame('不红红', `${reds.length} 个红节点的孩子都是黑色，${verdict(ok)}`, { focus: realIds, verdict: ok, duration: 1200 })];
    }
    if (key === 'blackpath') {
      const counts = paths.map(blacks), ok = counts.every(c => c === counts[0]);
      const steps = paths.map((p, i) => frame(`黑路同 · 路径 ${i + 1}`, `${label(p)}：黑 ${counts[i]} 份`,
        { flow: [p], focus: p.slice(0, -1), anchor: lastReal(p), duration: 950 }));
      return [...steps, frame('黑路同', ok ? `每条路径都是 ${counts[0]} 份黑，${verdict(ok)}` : `黑数不一致，${verdict(ok)}`,
        { focus: realIds, flow: paths, verdict: ok, duration: 1300 })];
    }
    if (key === 'nil') {
      return [frame('NIL 为黑', `共 ${paths.length} 个空叶子，都计为黑色，通过`, { focus: realIds, showNil: true, verdict: true, duration: 1300 })];
    }
    if (key === 'height') {
      const len = p => p.length - 1;
      const short = Math.min(...paths.map(len)), long = Math.max(...paths.map(len));
      const shortPath = paths.find(p => len(p) === short), longPath = paths.find(p => len(p) === long);
      const ok = long <= 2 * short;
      return [
        frame(`最短路径 · 长 ${short}`, label(shortPath), { flow: [shortPath], focus: shortPath.slice(0, -1), anchor: lastReal(shortPath) }),
        frame(`最长路径 · 长 ${long}`, label(longPath), { flow: [longPath], focus: longPath.slice(0, -1), anchor: lastReal(longPath) }),
        frame('最长不超两倍最短', `${long} ≤ 2 × ${short}，${verdict(ok)}`, { focus: realIds, verdict: ok, duration: 1300 }),
      ];
    }
    if (key === 'order') {
      const steps = inorder.map((n, i) => frame(`中序 · 第 ${i + 1} 个`,
        i ? `前一个 ${inorder[i - 1].value}，${n.value > inorder[i - 1].value ? '递增' : '不满足'}` : `最小值 ${n.value}`,
        { focus: [n.id], anchor: n.id, duration: 700 }));
      const ok = inorder.every((n, i) => !i || inorder[i - 1].value < n.value);
      return [...steps, frame('中序有序', `${inorder.length} 个节点依次递增，${verdict(ok)}`, { focus: realIds, verdict: ok, duration: 1200 })];
    }
    throw new Error(`未知性质：${key}`);
  }

  const api = { RBTree, propertyFrames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RedBlack = api;
})(typeof window !== 'undefined' ? window : globalThis);
