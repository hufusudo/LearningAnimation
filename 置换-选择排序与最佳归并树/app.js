/**
 * 置换-选择排序与最佳归并树可视化系统 (External Sorting Visualizer)
 * 极简双栏布局：可视化演示 + 伴随代码实时运行与行高亮
 */

// =========================================================================
// 1. 置换-选择排序算法引擎 (REPLACEMENT SELECTION ENGINE)
// =========================================================================

const RS_PRESETS = {
  textbook: [51, 49, 39, 46, 38, 29, 14, 61, 15, 30, 1, 48, 52, 3, 63, 27, 4, 13, 89, 24, 46, 58, 33, 76],
  nearly_sorted: [12, 15, 23, 28, 35, 18, 42, 49, 53, 60, 58, 67, 73, 80, 75, 88, 92, 95, 30, 34, 45, 50, 55, 62],
  reverse: [99, 91, 85, 78, 70, 65, 59, 52, 47, 41, 36, 30, 25, 20, 15, 11, 8, 5, 3, 2]
};

class ReplacementSelectionEngine {
  constructor() {
    this.rawInput = [...RS_PRESETS.textbook];
    this.waCapacity = 6;
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
      btnReset: document.getElementById('rs-btn-reset'),
      btnPrev: document.getElementById('rs-btn-prev'),
      btnPlay: document.getElementById('rs-btn-play'),
      btnNext: document.getElementById('rs-btn-next'),
      playIcon: document.getElementById('rs-play-icon'),
      playLabel: document.getElementById('rs-play-label'),
      speedSlider: document.getElementById('rs-speed'),
      speedVal: document.getElementById('rs-speed-val'),
      waCapSelect: document.getElementById('rs-wa-cap'),
      presetBtns: document.querySelectorAll('.rs-preset-btn'),
      btnImportTree: document.getElementById('rs-btn-import-tree'),

      inputCount: document.getElementById('rs-input-count'),
      inputStream: document.getElementById('rs-input-stream'),

      inspectorCard: document.getElementById('rs-inspector-card'),
      decisionTag: document.getElementById('rs-decision-tag'),
      xVal: document.getElementById('rs-x-val'),
      opSymbol: document.getElementById('rs-op-symbol'),
      lastKeyVal: document.getElementById('rs-last-key-val'),
      decisionDesc: document.getElementById('rs-decision-desc'),

      actCount: document.getElementById('rs-act-count'),
      frzCount: document.getElementById('rs-frz-count'),
      heapSvg: document.getElementById('rs-heap-svg'),
      heapNodes: document.getElementById('rs-heap-nodes'),
      heapCanvas: document.getElementById('rs-heap-canvas'),
      waSlots: document.getElementById('rs-wa-slots'),
      runsTracks: document.getElementById('rs-runs-tracks'),

      stepTitle: document.getElementById('rs-step-title'),
      stepBadge: document.getElementById('rs-step-badge'),
      stepDetail: document.getElementById('rs-step-detail'),

      varRun: document.getElementById('rs-var-run'),
      varLastKey: document.getElementById('rs-var-lastkey'),
      varHeapSize: document.getElementById('rs-var-heapsize'),
      varX: document.getElementById('rs-var-x'),
    };
  }

  bindEvents() {
    this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
    this.dom.btnNext.addEventListener('click', () => this.stepForward(true));
    this.dom.btnPrev.addEventListener('click', () => this.stepBackward());
    this.dom.btnReset.addEventListener('click', () => this.resetSimulation());

    this.dom.speedSlider.addEventListener('input', (e) => {
      this.speed = parseFloat(e.target.value);
      this.dom.speedVal.textContent = `${this.speed.toFixed(1)}x`;
      if (this.isPlaying) this.restartPlayTimer();
    });

    this.dom.waCapSelect.addEventListener('change', (e) => {
      this.waCapacity = parseInt(e.target.value, 10);
      this.resetSimulation();
    });

    this.dom.presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        if (RS_PRESETS[key]) {
          this.rawInput = [...RS_PRESETS[key]];
          this.resetSimulation();
        }
      });
    });

    this.dom.btnImportTree.addEventListener('click', () => {
      const lastSnap = this.snapshots[this.snapshots.length - 1];
      const validRuns = lastSnap.runs.filter(r => r.length > 0);
      if (validRuns.length > 0 && window.treeEngine) {
        window.treeEngine.setCustomRuns(validRuns.map(r => r.length));
        document.getElementById('tree-section').scrollIntoView({ behavior: 'smooth' });
      }
    });

    window.addEventListener('resize', () => {
      this.renderCurrentStep(false);
    });
  }

  generateSnapshots() {
    this.snapshots = [];
    const inputQueue = [...this.rawInput];
    const w = this.waCapacity;

    let wa = [];
    let heapSize = 0;
    let runIndex = 1;
    let lastKey = null;
    let runs = [[]];
    let uniqueIdCounter = 1;

    const cloneState = (overrides = {}) => {
      return {
        stepIndex: this.snapshots.length,
        runIndex,
        lastKey,
        inputQueue: [...inputQueue],
        wa: wa.map(item => (item ? { ...item } : null)),
        heapSize,
        runs: runs.map(r => [...r]),
        waCapacity: w,
        inspector: {
          xVal: null,
          lastKeyVal: lastKey,
          operator: '?',
          status: 'idle',
          desc: '等待读入与置换'
        },
        highlightNodes: [],
        swappedIndices: null,
        animationType: 'NONE',
        title: '步骤',
        desc: '',
        codeLine: 1,
        ...overrides
      };
    };

    // 1. 初态快照
    this.snapshots.push(cloneState({
      title: '算法就绪与初始化',
      desc: `待排序列包含 ${inputQueue.length} 个记录。工作区容量 w = ${w}。准备读入数据构建初始小顶堆。`,
      codeLine: 1
    }));

    // 2. 初始填充工作区
    const initialLoadCount = Math.min(w, inputQueue.length);
    for (let i = 0; i < initialLoadCount; i++) {
      const val = inputQueue.shift();
      wa.push({ id: `node_${uniqueIdCounter++}`, val, isFrozen: false });
    }
    heapSize = wa.length;

    this.snapshots.push(cloneState({
      title: '读入数据填满工作区 WA',
      desc: `从输入流读入前 ${heapSize} 个元素 [${wa.map(n => n.val).join(', ')}] 填入工作区 WA[0..${heapSize - 1}]。`,
      codeLine: 4
    }));

    // 3. 构建初始小顶堆
    const siftDown = (arr, n, rootIdx, recordSteps = true, ctxDesc = '') => {
      let current = rootIdx;
      while (true) {
        let left = 2 * current + 1;
        let right = 2 * current + 2;
        let smallest = current;

        if (left < n && arr[left].val < arr[smallest].val) smallest = left;
        if (right < n && arr[right].val < arr[smallest].val) smallest = right;

        if (smallest !== current) {
          if (recordSteps) {
            this.snapshots.push(cloneState({
              title: '小顶堆下沉比较',
              desc: `${ctxDesc}：比较父节点 WA[${current}](${arr[current].val}) 与子节点 WA[${smallest}](${arr[smallest].val})。`,
              highlightNodes: [current, smallest],
              codeLine: 13
            }));
          }

          const temp = arr[current];
          arr[current] = arr[smallest];
          arr[smallest] = temp;

          if (recordSteps) {
            this.snapshots.push(cloneState({
              title: '堆节点物理交换',
              desc: `${ctxDesc}：交换 WA[${current}] 与 WA[${smallest}]，值 ${arr[smallest].val} 下沉。`,
              swappedIndices: [current, smallest],
              animationType: 'SWAP',
              codeLine: 13
            }));
          }

          current = smallest;
        } else {
          break;
        }
      }
    };

    for (let i = Math.floor(heapSize / 2) - 1; i >= 0; i--) {
      siftDown(wa, heapSize, i, true, '初始建堆');
    }

    this.snapshots.push(cloneState({
      title: '初始小顶堆构建完成',
      desc: `小顶堆就绪！堆顶极小值 WA[0] = ${wa[0].val}。开始生成归并段 R₁。`,
      highlightNodes: [0],
      codeLine: 6
    }));

    // 4. 置换选择主循环
    while (heapSize > 0 || wa.length > 0) {

      if (heapSize === 0) {
        if (wa.length === 0) break;

        const frozenCount = wa.length;
        this.snapshots.push(cloneState({
          title: `归并段 R${runIndex} 生成完毕`,
          desc: `工作区中无满足 ≥ LAST_KEY 的活跃元素（${frozenCount} 个全被冻结）。当前段 R${runIndex} 结束。`,
          codeLine: 2
        }));

        runIndex += 1;
        runs.push([]);
        lastKey = null;

        wa.forEach(item => {
          if (item) item.isFrozen = false;
        });
        heapSize = wa.length;

        this.snapshots.push(cloneState({
          title: `全量解冻，开启归并段 R${runIndex}`,
          desc: `重置 LAST_KEY = -∞。将工作区中所有 ${heapSize} 个暂存冻结元素全部解冻激活，重建小顶堆。`,
          animationType: 'UNFREEZE',
          codeLine: 4
        }));

        for (let i = Math.floor(heapSize / 2) - 1; i >= 0; i--) {
          siftDown(wa, heapSize, i, true, `归并段 R${runIndex} 重建堆`);
        }
        continue;
      }

      // Step A: 选出极小值
      const minNode = wa[0];
      const minVal = minNode.val;

      this.snapshots.push(cloneState({
        title: `抽取堆顶极小值 ${minVal}`,
        desc: `从活跃小顶堆选出最小值 WA[0] = ${minVal}，准备输出至 R${runIndex}。`,
        highlightNodes: [0],
        codeLine: 6
      }));

      runs[runIndex - 1].push(minVal);
      lastKey = minVal;

      this.snapshots.push(cloneState({
        title: `输出 ${minVal} 至归并段 R${runIndex}`,
        desc: `输出 ${minVal} 到 R${runIndex}。更新基准值 LAST_KEY = ${minVal}。`,
        animationType: 'EMIT_RUN',
        codeLine: 7
      }));

      // Step B: 读入新元素置换判定
      if (inputQueue.length > 0) {
        const nextX = inputQueue.shift();
        const nextNode = { id: `node_${uniqueIdCounter++}`, val: nextX, isFrozen: false };
        const isQualified = (nextX >= lastKey);

        this.snapshots.push(cloneState({
          title: `置换判定：读入 x = ${nextX}`,
          desc: `读入 x = ${nextX}，与 LAST_KEY = ${lastKey} 进行比对：${nextX} ${isQualified ? '≥' : '<'} ${lastKey}。`,
          inspector: {
            xVal: nextX,
            lastKeyVal: lastKey,
            operator: isQualified ? '≥' : '<',
            status: isQualified ? 'pass' : 'frozen',
            desc: isQualified ? `${nextX} ≥ ${lastKey}：归入当前段 (保持活跃)` : `${nextX} < ${lastKey}：归入下一段 (冻结置底)`
          },
          codeLine: 11
        }));

        if (isQualified) {
          wa[0] = nextNode;
          this.snapshots.push(cloneState({
            title: `元素 ${nextX} 填入堆顶 WA[0]`,
            desc: `将 ${nextX} 放入堆顶，自顶向下调整小顶堆。`,
            highlightNodes: [0],
            codeLine: 12
          }));

          siftDown(wa, heapSize, 0, true, '活跃元素堆调整');
        } else {
          nextNode.isFrozen = true;
          const targetIndex = heapSize - 1;

          wa[0] = wa[targetIndex];
          wa[targetIndex] = nextNode;
          heapSize -= 1;

          this.snapshots.push(cloneState({
            title: `元素 ${nextX} 冻结并置于 WA[${targetIndex}]`,
            desc: `将冻结元素 ${nextX} 移至堆尾有效范围外 WA[${targetIndex}]。有效容量减 1。原堆尾元素移至堆顶。`,
            swappedIndices: targetIndex > 0 ? [0, targetIndex] : null,
            highlightNodes: [targetIndex],
            animationType: 'SWAP',
            codeLine: 16
          }));

          if (heapSize > 0) {
            siftDown(wa, heapSize, 0, true, '冻结置换后堆调整');
          }
        }

      } else {
        this.snapshots.push(cloneState({
          title: '输入流已耗尽 (EOF)',
          desc: '输入流已无新数据，将活跃堆尾元素移至堆顶收缩堆。',
          codeLine: 9
        }));

        if (heapSize > 1) {
          wa[0] = wa[heapSize - 1];
          wa.splice(heapSize - 1, 1);
          heapSize -= 1;

          this.snapshots.push(cloneState({
            title: `活跃堆收缩调整 (容量 ${heapSize})`,
            desc: `原堆尾元素移至堆顶，调整小顶堆。`,
            highlightNodes: [0],
            swappedIndices: null,
            animationType: 'NONE',
            codeLine: 18
          }));

          siftDown(wa, heapSize, 0, true, '收缩堆调整');
        } else {
          wa.splice(0, 1);
          heapSize = 0;
        }
      }
    }

    const totalRuns = runs.filter(r => r.length > 0).length;
    const totalElements = runs.reduce((acc, r) => acc + r.length, 0);
    const avgLen = totalRuns > 0 ? (totalElements / totalRuns).toFixed(2) : '0';

    this.snapshots.push(cloneState({
      title: '置换-选择排序完成',
      desc: `生成 ${totalRuns} 个归并段，总计 ${totalElements} 个元素，平均段长 ${avgLen}（理论期望 ≈ 2w = ${w * 2}）。`,
      codeLine: 21
    }));
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
    this.dom.playLabel.textContent = '暂停播放';
    if (this.dom.playIcon) this.dom.playIcon.textContent = '⏸';
    this.dom.btnPlay.classList.add('bg-stone-700');
    this.restartPlayTimer();
  }

  pause() {
    this.isPlaying = false;
    if (this.playTimer) clearTimeout(this.playTimer);
    this.dom.playLabel.textContent = '自动播放';
    if (this.dom.playIcon) this.dom.playIcon.textContent = '▶';
    this.dom.btnPlay.classList.remove('bg-stone-700');
  }

  restartPlayTimer() {
    if (this.playTimer) clearTimeout(this.playTimer);
    if (!this.isPlaying) return;

    const baseDelay = 1100;
    const interval = Math.max(220, baseDelay / this.speed);

    this.playTimer = setTimeout(() => {
      if (this.currentStep < this.snapshots.length - 1) {
        this.stepForward(true);
        this.restartPlayTimer();
      } else {
        this.pause();
      }
    }, interval);
  }

  renderCurrentStep(withAnimation = true) {
    const step = this.snapshots[this.currentStep];
    if (!step) return;

    // 1. 更新步骤说明与代码高亮行
    this.dom.stepTitle.textContent = step.title;
    this.dom.stepBadge.textContent = `Step ${this.currentStep + 1}/${this.snapshots.length}`;
    this.dom.stepDetail.textContent = step.desc;

    this.highlightCodeLine(step.codeLine);

    // 2. 更新变量监控
    this.dom.varRun.textContent = `R${step.runIndex}`;
    this.dom.varLastKey.textContent = step.lastKey !== null ? step.lastKey : '-∞';
    this.dom.varHeapSize.textContent = `${step.heapSize}`;
    this.dom.varX.textContent = step.inspector.xVal !== null ? `${step.inspector.xVal}` : '--';

    // 3. 输入流
    this.dom.inputCount.textContent = step.inputQueue.length;
    this.dom.inputStream.innerHTML = '';
    if (step.inputQueue.length === 0) {
      this.dom.inputStream.innerHTML = '<span class="text-stone-400 font-mono text-[11px] italic px-2">已全部读入 (EOF)</span>';
    } else {
      step.inputQueue.forEach((val, idx) => {
        const chip = document.createElement('div');
        chip.className = `stream-node-chip ${idx === 0 ? 'head-chip' : ''}`;
        chip.textContent = val;
        this.dom.inputStream.appendChild(chip);
      });
    }

    // 4. 置换判定台
    const insp = step.inspector;
    this.dom.xVal.textContent = insp.xVal !== null ? insp.xVal : '--';
    this.dom.lastKeyVal.textContent = insp.lastKeyVal !== null ? insp.lastKeyVal : '-∞';
    this.dom.opSymbol.textContent = insp.operator;
    this.dom.decisionDesc.textContent = insp.desc;

    if (insp.status === 'pass') {
      this.dom.decisionTag.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-200';
      this.dom.decisionTag.textContent = '满足单调递增';
      this.dom.opSymbol.className = 'text-base font-extrabold text-emerald-600';
    } else if (insp.status === 'frozen') {
      this.dom.decisionTag.className = 'text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold border border-rose-200';
      this.dom.decisionTag.textContent = '冻结归入下一段';
      this.dom.opSymbol.className = 'text-base font-extrabold text-rose-600';
    } else {
      this.dom.decisionTag.className = 'text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-600';
      this.dom.decisionTag.textContent = '比对中';
      this.dom.opSymbol.className = 'text-base font-extrabold text-stone-400';
    }

    // 5. 堆与槽位
    this.renderHeapAndSlots(step, withAnimation);

    // 6. 输出归并段
    this.renderInitialRuns(step, withAnimation);
  }

  highlightCodeLine(lineNum) {
    const codeBlock = document.getElementById('rs-code-block');
    if (!codeBlock) return;
    const lines = codeBlock.querySelectorAll('.code-line');
    lines.forEach(el => el.classList.remove('active-rs'));

    const target = document.getElementById(`rs-line-${lineNum}`);
    if (target) target.classList.add('active-rs');
  }

  renderHeapAndSlots(step, withAnimation = true) {
    const wa = step.wa;
    const n = wa.length;
    const heapSize = step.heapSize;

    const frozenCount = wa.filter(item => item && item.isFrozen).length;
    this.dom.actCount.textContent = heapSize;
    this.dom.frzCount.textContent = frozenCount;

    // 线性槽位
    this.dom.waSlots.innerHTML = '';
    this.dom.waSlots.style.gridTemplateColumns = `repeat(${step.waCapacity}, minmax(0, 1fr))`;

    for (let i = 0; i < step.waCapacity; i++) {
      const item = wa[i];
      const slot = document.createElement('div');
      const isFrozen = item && item.isFrozen;
      slot.className = `wa-slot-box ${item ? (isFrozen ? 'frozen-slot' : 'active-slot') : 'opacity-40'}`;
      slot.innerHTML = `
        <span class="text-[8px] text-stone-400 absolute top-1 left-1.5">[${i}]</span>
        <span class="font-bold text-xs ${isFrozen ? 'text-rose-700' : 'text-emerald-800'}">${item ? item.val : '--'}</span>
      `;
      this.dom.waSlots.appendChild(slot);
    }

    // 树形结构
    const canvas = this.dom.heapCanvas;
    const svg = this.dom.heapSvg;
    const container = this.dom.heapNodes;

    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 145;

    svg.innerHTML = '';
    container.innerHTML = '';

    if (n === 0) return;

    const positions = [];

    for (let i = 0; i < n; i++) {
      const layer = Math.floor(Math.log2(i + 1));
      const layerCapacity = Math.pow(2, layer);
      const posInLayer = i - (layerCapacity - 1);
      const segmentWidth = width / layerCapacity;
      const x = segmentWidth * posInLayer + segmentWidth / 2;
      const y = 20 + layer * 56; // 动态支持 4 层（容量 8 时需要）
      positions.push({ x, y });
    }

    const drawEdges = () => {
      svg.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        [left, right].forEach(child => {
          if (child < n) {
            const elP = document.getElementById(`rs-node-${i}`);
            const elC = document.getElementById(`rs-node-${child}`);
            const pX = elP ? parseFloat(elP.style.left) : positions[i].x;
            const pY = elP ? parseFloat(elP.style.top) : positions[i].y;
            const cX = elC ? parseFloat(elC.style.left) : positions[child].x;
            const cY = elC ? parseFloat(elC.style.top) : positions[child].y;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', pX);
            line.setAttribute('y1', pY);
            line.setAttribute('x2', cX);
            line.setAttribute('y2', cY);
            line.setAttribute('class', `rs-tree-edge ${child < heapSize && i < heapSize ? 'active-edge' : 'frozen-edge'}`);
            svg.appendChild(line);
          }
        });
      }
    };

    for (let i = 0; i < n; i++) {
      const item = wa[i];
      if (!item) continue;
      const pos = positions[i];
      const isFrozen = item.isFrozen || i >= heapSize;
      const isHighlight = step.highlightNodes.includes(i);

      const nodeDiv = document.createElement('div');
      nodeDiv.className = `heap-node ${isFrozen ? 'frozen-node' : 'active-node'} ${isHighlight ? 'highlight-node' : ''}`;
      nodeDiv.style.left = `${pos.x}px`;
      nodeDiv.style.top = `${pos.y}px`;
      nodeDiv.id = `rs-node-${i}`;

      nodeDiv.innerHTML = `
        <span class="node-idx-badge">${i}</span>
        <span>${item.val}</span>
      `;
      container.appendChild(nodeDiv);
    }

    drawEdges();

    // GSAP 平滑对向物理互换动效
    if (withAnimation && typeof gsap !== 'undefined' && step.swappedIndices && step.animationType === 'SWAP') {
      const [idxA, idxB] = step.swappedIndices;
      const elA = document.getElementById(`rs-node-${idxA}`);
      const elB = document.getElementById(`rs-node-${idxB}`);
      if (elA && elB) {
        const posA = positions[idxA];
        const posB = positions[idxB];
        const duration = 0.45 / this.speed;

        gsap.fromTo(elA, 
          { left: `${posB.x}px`, top: `${posB.y}px`, scale: 1.15, zIndex: 25 },
          { left: `${posA.x}px`, top: `${posA.y}px`, scale: 1.0, zIndex: 10, duration, ease: 'power2.inOut', onUpdate: drawEdges }
        );
        gsap.fromTo(elB, 
          { left: `${posA.x}px`, top: `${posA.y}px`, scale: 1.15, zIndex: 25 },
          { left: `${posB.x}px`, top: `${posB.y}px`, scale: 1.0, zIndex: 10, duration, ease: 'power2.inOut', onUpdate: drawEdges }
        );
      }
    }
  }

  renderInitialRuns(step, withAnimation = true) {
    const container = this.dom.runsTracks;
    container.innerHTML = '';

    step.runs.forEach((runList, rIdx) => {
      const isCurrent = (rIdx === step.runIndex - 1);
      const row = document.createElement('div');
      row.className = `run-track-row ${isCurrent ? 'current-row' : ''}`;

      let pillsHtml = '';
      runList.forEach((v, vIdx) => {
        const isLatest = isCurrent && vIdx === runList.length - 1 && step.animationType === 'EMIT_RUN';
        pillsHtml += `<div class="run-pill ${isLatest ? 'ring-2 ring-amber-400 scale-105' : ''}" id="rs-run-${rIdx}-${vIdx}">${v}</div>`;
      });

      row.innerHTML = `
        <span class="font-mono text-xs font-bold text-amber-800 w-14">R${rIdx + 1} (${runList.length})</span>
        <div class="flex items-center gap-1.5 overflow-x-auto flex-1">${pillsHtml || '<span class="text-stone-400 font-mono text-[11px] italic">生成中...</span>'}</div>
      `;
      container.appendChild(row);

      if (withAnimation && typeof gsap !== 'undefined' && isCurrent && runList.length > 0 && step.animationType === 'EMIT_RUN') {
        const latest = document.getElementById(`rs-run-${rIdx}-${runList.length - 1}`);
        if (latest) {
          gsap.fromTo(latest, { scale: 0.2, y: -15, opacity: 0 }, { scale: 1.0, y: 0, opacity: 1, duration: 0.35 / this.speed, ease: 'back.out(2)' });
        }
      }
    });

    container.scrollTop = container.scrollHeight;
  }
}


// =========================================================================
// 2. 最佳归并树算法引擎 (OPTIMAL MERGE TREE ENGINE - PERSISTENT FLUID MORPH)
// =========================================================================

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
  window.rsEngine = new ReplacementSelectionEngine();
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
