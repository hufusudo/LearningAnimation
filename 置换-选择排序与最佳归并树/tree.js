// 最佳归并树：保留原有演示与交互。
const TREE_PRESETS = {
  textbook_8: [2, 3, 6, 9, 12, 17, 18, 24],       // 8 runs, k=3, 需补1虚段
  textbook_9: [9, 30, 12, 18, 3, 17, 2, 6, 24], // 9 runs, k=3, 需补0虚段
  five_runs: [16, 25, 34, 45, 60],               // 5 runs, k=3, 需补0虚段
};

class OptimalMergeTreeEngine {
  constructor() {
    this.runs = [...TREE_PRESETS.textbook_8];
    this.k = 3;
    this.mode = 'with_dummy'; // 'with_dummy' | 'without_dummy'
    this.snapshots = [];
    this.currentStep = 0;
    this.isPlaying = false;
    this.playTimer = null;
    this.speed = 1.0;

    this.initDOM();
    this.bindEvents();
    this.resetSimulation();
  }

  initDOM() {
    this.dom = {
      tabWith: document.getElementById('tree-tab-with'),
      tabWithout: document.getElementById('tree-tab-without'),

      btnReset: document.getElementById('tree-btn-reset'),
      btnPrev: document.getElementById('tree-btn-prev'),
      btnPlay: document.getElementById('tree-btn-play'),
      btnNext: document.getElementById('tree-btn-next'),
      playIcon: document.getElementById('tree-play-icon'),
      playLabel: document.getElementById('tree-play-label'),
      speedSlider: document.getElementById('tree-speed'),
      speedVal: document.getElementById('tree-speed-val'),
      kSelect: document.getElementById('tree-k-val'),
      presetBtns: document.querySelectorAll('.tree-preset-btn'),

      forestQueue: document.getElementById('tree-forest-queue'),
      kBadge: document.getElementById('tree-k-badge'),
      canvasArea: document.getElementById('tree-canvas-area'),
      canvasSvg: document.getElementById('tree-canvas-svg'),
      canvasNodes: document.getElementById('tree-canvas-nodes'),

      metricDummy: document.getElementById('tree-metric-dummy'),
      metricWpl: document.getElementById('tree-metric-wpl'),
      metricIo: document.getElementById('tree-metric-io'),

      stepTitle: document.getElementById('tree-step-title'),
      stepBadge: document.getElementById('tree-step-badge'),
      stepDetail: document.getElementById('tree-step-detail'),

      varMode: document.getElementById('tree-var-mode'),
      varV: document.getElementById('tree-var-v'),
      varSize: document.getElementById('tree-var-size'),
      varWpl: document.getElementById('tree-var-wpl'),
    };
  }

  bindEvents() {
    this.dom.tabWith.addEventListener('click', () => {
      if (this.mode !== 'with_dummy') {
        this.mode = 'with_dummy';
        this.updateTabUI();
        this.resetSimulation();
      }
    });

    this.dom.tabWithout.addEventListener('click', () => {
      if (this.mode !== 'without_dummy') {
        this.mode = 'without_dummy';
        this.updateTabUI();
        this.resetSimulation();
      }
    });

    this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
    this.dom.btnNext.addEventListener('click', () => this.stepForward(true));
    this.dom.btnPrev.addEventListener('click', () => this.stepBackward());
    this.dom.btnReset.addEventListener('click', () => this.resetSimulation());

    this.dom.speedSlider.addEventListener('input', (e) => {
      this.speed = parseFloat(e.target.value);
      this.dom.speedVal.textContent = `${this.speed.toFixed(1)}x`;
      if (this.isPlaying) this.restartPlayTimer();
    });

    this.dom.kSelect.addEventListener('change', (e) => {
      this.k = parseInt(e.target.value, 10);
      this.resetSimulation();
    });

    this.dom.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-treepreset');
        if (TREE_PRESETS[key]) {
          this.runs = [...TREE_PRESETS[key]];
          this.resetSimulation();
        }
      });
    });

    window.addEventListener('resize', () => {
      this.renderCurrentStep(false);
    });
  }

  updateTabUI() {
    if (this.mode === 'with_dummy') {
      this.dom.tabWith.className = 'px-3 py-1 rounded-md transition-all bg-white text-stone-900 font-bold shadow-2xs';
      this.dom.tabWithout.className = 'px-3 py-1 rounded-md transition-all text-stone-500 hover:text-stone-900 font-medium';
    } else {
      this.dom.tabWith.className = 'px-3 py-1 rounded-md transition-all text-stone-500 hover:text-stone-900 font-medium';
      this.dom.tabWithout.className = 'px-3 py-1 rounded-md transition-all bg-white text-stone-900 font-bold shadow-2xs';
    }
  }

  setCustomRuns(weights) {
    this.runs = [...weights];
    this.resetSimulation();
  }

  cloneNode(node) {
    if (!node) return null;
    return {
      id: node.id,
      name: node.name,
      weight: node.weight,
      isDummy: node.isDummy,
      isLeaf: node.isLeaf,
      depth: node.depth || 0,
      x: node.x || 0,
      y: node.y || 0,
      children: node.children ? node.children.map(c => this.cloneNode(c)) : []
    };
  }

  generateSnapshots() {
    this.snapshots = [];
    const k = this.k;
    const n = this.runs.length;
    const withDummy = (this.mode === 'with_dummy');

    const u = (n - 1) % (k - 1);
    const dummyNeeded = (u === 0) ? 0 : (k - 1 - u);
    const dummyToAdd = withDummy ? dummyNeeded : 0;

    let idCounter = 1;
    let forest = [];

    this.runs.forEach((w, idx) => {
      forest.push({
        id: `run_leaf_${idCounter++}`,
        name: `R${idx + 1}`,
        weight: w,
        isDummy: false,
        isLeaf: true,
        children: []
      });
    });

    if (withDummy && dummyToAdd > 0) {
      for (let j = 0; j < dummyToAdd; j++) {
        forest.push({
          id: `dummy_leaf_${idCounter++}`,
          name: `虚段${j + 1}`,
          weight: 0,
          isDummy: true,
          isLeaf: true,
          children: []
        });
      }
    }

    const cloneState = (overrides = {}) => {
      return {
        stepIndex: this.snapshots.length,
        k,
        mode: this.mode,
        n,
        u,
        dummyNeeded,
        dummyToAdd,
        forest: forest.map(node => this.cloneNode(node)),
        selectedIds: [],
        newParentId: null,
        title: '',
        desc: '',
        codeLine: 1,
        ...overrides
      };
    };

    // 快照 0: 初始化
    this.snapshots.push(cloneState({
      title: withDummy ? '最佳归并树初始化 (虚段判定)' : '归并树初始化 (盲目归并)',
      desc: withDummy
        ? `n = ${n}, k = ${k}。判定公式 (${n}-1)%${k-1} = ${u}。${dummyNeeded > 0 ? `需增加 ${dummyNeeded} 个权值为 0 的虚段以保证严格 k 叉哈夫曼最优！` : '整除无需补虚段。'}`
        : `未增加虚段模式：直接对 ${n} 个初始段进行贪心 ${k} 路归并。`,
      codeLine: withDummy ? 2 : 6
    }));

    let mergeRound = 1;

    while (forest.length > 1) {
      forest.sort((a, b) => {
        if (a.weight !== b.weight) return a.weight - b.weight;
        if (a.isDummy !== b.isDummy) return a.isDummy ? -1 : 1;
        return 0;
      });

      const takeCount = Math.min(k, forest.length);
      const chosen = forest.slice(0, takeCount);
      const chosenIds = chosen.map(c => c.id);

      this.snapshots.push(cloneState({
        title: `第 ${mergeRound} 轮：选取 ${takeCount} 个极小节点`,
        desc: `从候选队列取出权值最小的 ${takeCount} 个节点 [${chosen.map(c => `${c.name}(${c.weight})`).join(', ')}]。`,
        selectedIds: chosenIds,
        codeLine: 8
      }));

      forest.splice(0, takeCount);

      const sumWeight = chosen.reduce((acc, c) => acc + c.weight, 0);
      const parentNode = {
        id: `merge_node_${idCounter++}`,
        name: `M${mergeRound}`,
        weight: sumWeight,
        isDummy: false,
        isLeaf: false,
        children: chosen
      };

      forest.push(parentNode);

      this.snapshots.push(cloneState({
        title: `第 ${mergeRound} 轮：生成归并节点 M${mergeRound} (权值 ${sumWeight})`,
        desc: `合并生成父节点 M${mergeRound}，权值 = ${chosen.map(c => c.weight).join(' + ')} = ${sumWeight}。将新子树插回队列。`,
        newParentId: parentNode.id,
        codeLine: 11
      }));

      mergeRound += 1;
    }

    const root = forest[0];
    const calcDepths = (node, depth) => {
      node.depth = depth;
      if (node.children) node.children.forEach(c => calcDepths(c, depth + 1));
    };
    calcDepths(root, 0);

    let finalWPL = 0;
    const calcWPL = (node) => {
      if (node.isLeaf) {
        if (!node.isDummy) finalWPL += node.weight * node.depth;
      } else if (node.children) {
        node.children.forEach(calcWPL);
      }
    };
    calcWPL(root);

    this.snapshots.push(cloneState({
      title: withDummy ? '最佳归并树构建完成' : '归并树构建完成 (对比模式)',
      desc: `构建完毕！WPL = ${finalWPL}，总 I/O 读写次数 = 2 × WPL = ${2 * finalWPL} 次。`,
      wpl: finalWPL,
      codeLine: 14
    }));
  }

  computeStats() {
    const k = this.k;
    const runs = this.runs;

    const simulate = (withDummy) => {
      const n = runs.length;
      const u = (n - 1) % (k - 1);
      const v = (u === 0) ? 0 : (k - 1 - u);
      let f = runs.map((w, i) => ({ weight: w, isDummy: false, isLeaf: true, children: [] }));
      if (withDummy && v > 0) {
        for (let j = 0; j < v; j++) f.push({ weight: 0, isDummy: true, isLeaf: true, children: [] });
      }
      while (f.length > 1) {
        f.sort((a, b) => (a.weight !== b.weight ? a.weight - b.weight : (a.isDummy ? -1 : 1)));
        const take = Math.min(k, f.length);
        const ch = f.splice(0, take);
        const sw = ch.reduce((acc, c) => acc + c.weight, 0);
        f.push({ weight: sw, isDummy: false, isLeaf: false, children: ch });
      }
      const r = f[0];
      const setD = (node, d) => {
        node.depth = d;
        if (node.children) node.children.forEach(c => setD(c, d + 1));
      };
      setD(r, 0);
      let wpl = 0;
      const getWPL = (node) => {
        if (node.isLeaf) {
          if (!node.isDummy) wpl += node.weight * node.depth;
        } else if (node.children) node.children.forEach(getWPL);
      };
      getWPL(r);
      return { wpl, io: 2 * wpl, dummyAdded: withDummy ? v : 0 };
    };

    return { resWith: simulate(true), resWithout: simulate(false) };
  }

  resetSimulation() {
    this.pause();
    this.generateSnapshots();
    this.currentStep = 0;
    this.renderCurrentStep(false);
  }

  stepForward(withAnimation = true) {
    if (this.currentStep < this.snapshots.length - 1) {
      this.currentStep += 1;
      this.renderCurrentStep(withAnimation);
    } else {
      this.pause();
    }
  }

  stepBackward() {
    if (this.currentStep > 0) {
      this.currentStep -= 1;
      this.renderCurrentStep(false);
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.currentStep >= this.snapshots.length - 1) {
      this.currentStep = 0;
    }
    this.isPlaying = true;
    this.dom.playLabel.textContent = '暂停建树';
    if (this.dom.playIcon) this.dom.playIcon.textContent = '⏸';
    this.dom.btnPlay.classList.add('bg-stone-700');
    this.restartPlayTimer();
  }

  pause() {
    this.isPlaying = false;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.dom.playLabel.textContent = '自动建树';
    if (this.dom.playIcon) this.dom.playIcon.textContent = '▶';
    this.dom.btnPlay.classList.remove('bg-stone-700');
  }

  restartPlayTimer() {
    if (this.playTimer) clearTimeout(this.playTimer);
    if (!this.isPlaying) return;

    const baseDelay = 1200;
    const interval = Math.max(250, baseDelay / this.speed);

    this.playTimer = setTimeout(() => {
      if (this.currentStep < this.snapshots.length - 1) {
        this.stepForward(true);
        this.restartPlayTimer();
      } else {
        this.pause();
      }
    }, interval);
  }

  // --- 树拓扑全局几何坐标平滑计算 ---
  computeForestLayout(forest, totalWidth, totalHeight) {
    const numTrees = forest.length;
    if (numTrees === 0) return;

    const paddingX = 25;
    const availableWidth = totalWidth - 2 * paddingX;
    const treeSegmentWidth = availableWidth / numTrees;

    forest.forEach((root, tIdx) => {
      const subLeft = paddingX + tIdx * treeSegmentWidth;

      let maxDepth = 0;
      const getDepth = (node, d) => {
        node.depth = d;
        if (d > maxDepth) maxDepth = d;
        if (node.children) node.children.forEach(c => getDepth(c, d + 1));
      };
      getDepth(root, 0);

      const leaves = [];
      const getLeaves = (node) => {
        if (!node.children || node.children.length === 0) leaves.push(node);
        else node.children.forEach(getLeaves);
      };
      getLeaves(root);

      const leafCount = leaves.length;
      const leafSpacing = leafCount > 1 ? (treeSegmentWidth - 30) / (leafCount - 1) : 0;

      leaves.forEach((leaf, idx) => {
        leaf.x = subLeft + 15 + idx * leafSpacing;
      });

      const assignYAndParentX = (node) => {
        const topY = 35;
        const layerHeight = 55;
        node.y = topY + node.depth * layerHeight;

        if (node.children && node.children.length > 0) {
          node.children.forEach(assignYAndParentX);
          node.x = node.children.reduce((acc, c) => acc + c.x, 0) / node.children.length;
        }
      };
      assignYAndParentX(root);
    });
  }

  renderCurrentStep(withAnimation = true) {
    const step = this.snapshots[this.currentStep];
    if (!step) return;

    const stats = this.computeStats();
    const { resWith, resWithout } = stats;
    const curWPL = (this.mode === 'with_dummy') ? resWith.wpl : resWithout.wpl;
    const curIO = (this.mode === 'with_dummy') ? resWith.io : resWithout.io;

    // 1. 更新说明与代码行高亮
    this.dom.stepTitle.textContent = step.title;
    this.dom.stepBadge.textContent = `Step ${this.currentStep + 1}/${this.snapshots.length}`;
    this.dom.stepDetail.textContent = step.desc;
    this.highlightCodeLine(step.codeLine);

    // 2. 更新变量监控
    this.dom.varMode.textContent = this.mode === 'with_dummy' ? 'WITH_DUMMY' : 'WITHOUT_DUMMY';
    this.dom.varV.textContent = `${step.dummyNeeded}`;
    this.dom.varSize.textContent = `${step.forest.length}`;
    this.dom.varWpl.textContent = step.wpl ? `${step.wpl}` : `${curWPL}`;

    // 3. 指标卡片
    this.dom.kBadge.textContent = this.k;
    this.dom.metricDummy.textContent = `(${step.n}-1)%${step.k-1} = ${step.u} ➔ 需补 ${step.dummyNeeded} 虚段`;
    this.dom.metricWpl.textContent = `WPL = ${curWPL}`;

    const savedIO = resWithout.io - resWith.io;
    if (this.mode === 'with_dummy') {
      this.dom.metricIo.textContent = `${curIO} 次读写 ${savedIO > 0 ? `(节省 ${savedIO} 次)` : ''}`;
    } else {
      this.dom.metricIo.textContent = `${curIO} 次读写 ${savedIO > 0 ? `(多浪费 ${savedIO} 次)` : ''}`;
    }

    // 4. 候选森林优先队列（FLIP：重建前记录旧位置，重建后平滑滑动到新位置）
    const prevChipPos = new Map();
    this.dom.forestQueue.querySelectorAll('.forest-chip').forEach(el => {
      if (el.dataset.fid) prevChipPos.set(el.dataset.fid, { x: el.offsetLeft, y: el.offsetTop });
    });

    this.dom.forestQueue.innerHTML = '';
    const newChips = [];
    step.forest.forEach(node => {
      const isSel = step.selectedIds.includes(node.id);
      const chip = document.createElement('div');
      chip.className = `forest-chip ${node.isDummy ? 'dummy' : ''} ${isSel ? 'selected' : ''}`;
      chip.dataset.fid = node.id;
      chip.innerHTML = `
        <span class="text-[9px] text-stone-500">${node.isDummy ? '虚段' : node.name}</span>
        <span class="text-stone-900 font-bold">${node.weight}</span>
      `;
      this.dom.forestQueue.appendChild(chip);
      newChips.push(chip);
    });

    if (withAnimation && typeof gsap !== 'undefined') {
      newChips.forEach(chip => {
        const prev = prevChipPos.get(chip.dataset.fid);
        if (!prev) return;
        const dx = prev.x - chip.offsetLeft;
        const dy = prev.y - chip.offsetTop;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        gsap.killTweensOf(chip);
        gsap.fromTo(chip,
          { x: dx, y: dy },
          { x: 0, y: 0, duration: 0.45 / this.speed, ease: 'power2.inOut', overwrite: 'auto' }
        );
      });
    }

    // 5. 核心：平滑拓扑树形图绘制
    this.renderTreeCanvas(step, withAnimation);
  }

  highlightCodeLine(lineNum) {
    const codeBlock = document.getElementById('tree-code-block');
    if (!codeBlock) return;
    const lines = codeBlock.querySelectorAll('.code-line');
    lines.forEach(el => el.classList.remove('active-tree'));

    const target = document.getElementById(`tree-line-${lineNum}`);
    if (target) target.classList.add('active-tree');
  }

  // --- 连续坐标变形树渲染 (FLIP Fluid Morph Canvas) ---
  // 核心机制：重建 DOM 前先记录每个节点的旧坐标 (First)，
  // 按新布局重建 (Last) 后，让所有持续存在的节点从旧位置平滑滑到新位置 (Invert+Play)。
  // 合并步中，被选中的 k 个节点同时向父节点汇聚点移动，父节点在汇聚处生长 —— 不再跳跃。
  renderTreeCanvas(step, withAnimation = true) {
    const canvas = this.dom.canvasArea;
    const svg = this.dom.canvasSvg;
    const container = this.dom.canvasNodes;

    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 300;

    // FLIP First：捕获所有现存节点的旧坐标（含被打断动画的当前值）
    const prevPos = new Map();
    container.querySelectorAll('.tree-node-dom').forEach(el => {
      prevPos.set(el.id.replace('omt-node-', ''), {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0
      });
    });

    // 计算当前所有树的全局坐标
    this.computeForestLayout(step.forest, width, height);

    // 收集所有当前存在的节点
    const allCurrentNodes = [];
    const collectAll = (node) => {
      allCurrentNodes.push(node);
      if (node.children) node.children.forEach(collectAll);
    };
    step.forest.forEach(collectAll);

    // 绘制连线
    const drawEdges = () => {
      svg.innerHTML = '';
      const drawNodeEdges = (node) => {
        if (node.children && node.children.length > 0) {
          node.children.forEach(child => {
            const elP = document.getElementById(`omt-node-${node.id}`);
            const elC = document.getElementById(`omt-node-${child.id}`);
            const pX = elP ? parseFloat(elP.style.left) : node.x;
            const pY = elP ? parseFloat(elP.style.top) : node.y;
            const cX = elC ? parseFloat(elC.style.left) : child.x;
            const cY = elC ? parseFloat(elC.style.top) : child.y;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const midY = (pY + cY) / 2;
            path.setAttribute('d', `M ${pX} ${pY} C ${pX} ${midY}, ${cX} ${midY}, ${cX} ${cY}`);
            path.setAttribute('class', `omt-edge-path ${child.isDummy ? 'dummy-path' : 'active-path'}`);
            svg.appendChild(path);

            drawNodeEdges(child);
          });
        }
      };
      step.forest.forEach(drawNodeEdges);
    };

    // 渲染 DOM 节点
    container.innerHTML = '';
    allCurrentNodes.forEach(node => {
      const isLeaf = node.isLeaf;
      const isDummy = node.isDummy;
      const isRoot = (step.stepIndex === this.snapshots.length - 1 && node.id === step.forest[0]?.id);
      const isNew = (node.id === step.newParentId);

      const nodeDiv = document.createElement('div');
      let nodeClass = 'tree-node-dom ';
      if (isLeaf) nodeClass += isDummy ? 'dummy-leaf ' : 'real-leaf ';
      else nodeClass += isRoot ? 'internal-node root-node ' : 'internal-node ';

      nodeDiv.className = nodeClass;
      nodeDiv.style.left = `${node.x}px`;
      nodeDiv.style.top = `${node.y}px`;
      nodeDiv.id = `omt-node-${node.id}`;

      const tagText = isDummy ? '虚段' : node.name;
      nodeDiv.innerHTML = `<span class="tag-label">${tagText}</span><span>${node.weight}</span>`;
      container.appendChild(nodeDiv);
    });

    drawEdges();

    if (withAnimation && typeof gsap !== 'undefined') {
      const duration = 0.6 / this.speed;
      const isMergeStep = !!step.newParentId;

      // FLIP Invert + Play：所有持续存在的节点从旧坐标滑向新坐标；
      // 合并步中被选中的节点与父节点同步汇聚（时长一致），其余节点跟随布局变化滑动
      allCurrentNodes.forEach(node => {
        const prev = prevPos.get(node.id);
        if (!prev) return; // 新节点（父节点）走下方生长动画
        const dx = Math.abs(prev.x - node.x);
        const dy = Math.abs(prev.y - node.y);
        if (dx < 0.5 && dy < 0.5) return;

        const el = document.getElementById(`omt-node-${node.id}`);
        if (!el) return;

        const isConverging = isMergeStep && step.selectedIds.includes(node.id);
        gsap.killTweensOf(el);
        gsap.fromTo(el,
          { left: `${prev.x}px`, top: `${prev.y}px` },
          {
            left: `${node.x}px`, top: `${node.y}px`,
            duration: isConverging ? duration : duration * 0.8,
            ease: 'power2.inOut',
            overwrite: 'auto',
            onUpdate: drawEdges
          }
        );
      });

      if (step.newParentId) {
        // 新父节点：在子节点汇聚处生长（略微延迟，先看到汇聚再看到合体）
        const parentEl = document.getElementById(`omt-node-${step.newParentId}`);
        if (parentEl) {
          gsap.killTweensOf(parentEl);
          gsap.fromTo(parentEl,
            { scale: 0.3, opacity: 0 },
            {
              scale: 1.0, opacity: 1,
              duration: duration * 0.6,
              delay: duration * 0.4,
              ease: 'back.out(1.6)',
              overwrite: 'auto',
              onUpdate: drawEdges
            }
          );
        }
      } else if (step.selectedIds.length > 0) {
        // 选取步：被选中的节点脉动提示
        step.selectedIds.forEach(id => {
          const el = document.getElementById(`omt-node-${id}`);
          if (el) {
            gsap.killTweensOf(el);
            gsap.fromTo(el,
              { scale: 1.0 },
              { scale: 1.12, duration: 0.3 / this.speed, yoyo: true, repeat: 1, ease: 'power1.inOut', overwrite: 'auto' }
            );
          }
        });
      }
    }
  }
}

// 页面加载启动双引擎与 KaTeX 公式渲染
document.addEventListener('DOMContentLoaded', () => {
  window.treeEngine = new OptimalMergeTreeEngine();

  if (typeof renderMathInElement === 'function') {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false }
      ],
      throwOnError: false
    });
  }
});
