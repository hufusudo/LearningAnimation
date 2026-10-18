/* 首页：有限预览、对象重排与标题衔接。静置不运行时钟。 */
(function () {
  'use strict';

  const SUBJECTS = {
    math: { title: '高等数学', short: '高等数学', code: 'MATHEMATICS', description: '从几何关系出发，看见极限、微分与积分的过程。', featured: ['极限定义', '格林公式', '偏导与可微'] },
    prob: { title: '概率论与数理统计', short: '概率统计', code: 'PROBABILITY & STATISTICS', description: '观察分布、切片与面积之间的联系。', featured: ['边缘概率', '条件概率', '抽样分布'] },
    ds: { title: '数据结构', short: '数据结构', code: 'DATA STRUCTURES', description: '跟随数据的移动，理解排序、树与图的每次变化。', featured: ['迪杰斯特拉', '堆排序', '红黑树'] },
    co: { title: '计算机组成原理', short: '计组原理', code: 'COMPUTER ORGANIZATION', description: '沿着数据通路，观察指令、寄存器与运算电路。', featured: [] },
    os: { title: '计算机操作系统', short: '操作系统', code: 'OPERATING SYSTEMS', description: '把调度、存储与资源管理变成可追踪的过程。', featured: ['请求分页', '时钟页面', '磁盘调度'] },
    net: { title: '计算机网络', short: '计算机网络', code: 'COMPUTER NETWORKS', description: '跟随一个分组，观察协议的交互与传输。', featured: ['回退N帧', 'TCP', '哈夫曼树'] },
    all: { title: '全部演示', short: '全部', code: 'ALL DISCIPLINES', description: '高等数学、概率统计与计算机基础的交互式演示。' },
    cs: { title: '计算机 408 全科', short: '408 全科', code: 'COMPUTER SCIENCE / 408', description: '数据结构、计算机组成原理、操作系统与计算机网络。' }
  };
  const EASE = 'cubic-bezier(.2,.7,.2,1)';

  function diagram(key) {
    const captions = {
      math: '曲线下的矩形近似表示积分的累积。仅为概念示意。',
      prob: '概率密度曲线右侧的阴影表示右尾概率。仅为概念示意。',
      ds: '在二叉搜索树中沿 8、3、6 的路径查找。仅为概念示意。',
      co: 'CPU 的寄存器经系统总线与主存交换信息。仅为概念示意。',
      os: '虚页 P1 映射到物理帧 F3，页内偏移保持不变。仅为概念示意。',
      net: '分组沿链路从发送端经过路由器到达接收端。仅为概念示意。'
    };
    let content = '';
    if (key === 'math') {
      let bars = '';
      for (let i = 0; i < 12; i++) {
        const x = 100 + i * 39, y = 180 - 125 * Math.pow((x + 17 - 80) / 500, 2);
        bars += `<rect x="${x}" y="${y.toFixed(2)}" width="34" height="${(190 - y).toFixed(2)}" class="bar${i === 8 ? ' current' : ''}"/>`;
      }
      content = `<path class="axis" d="M65 26V190H612"/><path class="area" d="M80 180Q330 180 580 55V190H80Z"/>
        <g data-reveal>${bars}</g><path class="curve" data-draw d="M80 180Q330 180 580 55"/>
        <text class="formula" x="460" y="35">∫ f(x) dx</text><text class="small" x="75" y="214">a</text><text class="small" x="577" y="214">b</text>
        <path class="wire" d="M412 194v8m34-8v8M412 198h34"/><text class="small center" x="429" y="217">Δx</text>`;
    } else if (key === 'prob') {
      const points = [];
      for (let x = 70; x <= 610; x += 5) points.push([x, 186 - 132 * Math.exp(-0.5 * Math.pow((x - 340) / 92, 2))]);
      const line = values => values.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y.toFixed(2)}`).join(' ');
      const tail = points.filter(([x]) => x >= 440);
      content = `<path class="axis" d="M65 32V186H620"/><path class="area" d="${line(points)}L610 186H70Z"/>
        <path class="tail" data-reveal d="${line(tail)}L610 186H440Z"/><path class="curve" data-draw d="${line(points)}"/>
        <path class="wire" stroke-dasharray="3 4" d="M440 115V191"/><text class="formula" x="470" y="70">α</text>
        <text class="small" x="493" y="70">右尾面积</text><text class="small center" x="440" y="211">qα</text><text class="small" x="624" y="192">x</text>`;
    } else if (key === 'ds') {
      const nodes = [[340, 40, 8], [220, 104, 3], [460, 104, 12], [145, 178, 1], [285, 178, 6], [395, 178, 10], [535, 178, 15]];
      content = `<path class="wire" d="M340 40L220 104L145 178M220 104L285 178M340 40L460 104L395 178M460 104L535 178"/>
        <path class="route" data-draw d="M340 40L220 104L285 178"/>
        ${nodes.map(([x, y, value]) => `<circle class="node${value === 6 ? ' current' : ''}" cx="${x}" cy="${y}" r="21"/><text class="mono center" x="${x}" y="${y + 5}">${value}</text>`).join('')}
        <circle data-reveal cx="285" cy="178" r="27" fill="none" stroke="#a6c3ae" stroke-width="1"/>
        <text class="small" x="80" y="221">查找 6</text><text class="mono green" x="154" y="221">8 → 3 → 6</text>`;
    } else if (key === 'co') {
      content = `<rect class="node" x="70" y="58" width="230" height="120" rx="8"/><text x="88" y="84">CPU</text>
        ${['PC', 'MAR', 'MDR'].map((label, i) => `<rect class="node" x="${86 + i * 69}" y="104" width="60" height="43" rx="4"/><text class="mono center" x="${116 + i * 69}" y="131">${label}</text>`).join('')}
        <rect class="node" x="475" y="58" width="135" height="120" rx="8"/><text class="center" x="542" y="111">物理主存</text><text class="small center" x="542" y="135">Memory</text>
        <path class="wire" d="M300 122H475"/><path class="route" data-draw data-travel d="M305 122H470"/>
        <text class="small center" x="386" y="96">系统总线</text><text class="small" x="70" y="215">寄存器与主存之间的数据通路</text>
        <g class="diagram-token" data-token><rect class="token" x="-12" y="-7" width="24" height="14" rx="3"/></g>`;
    } else if (key === 'os') {
      content = `<text class="small" x="93" y="34">虚拟页</text><text class="small" x="449" y="25">物理帧</text>
        ${[0, 1, 2].map((v, i) => `<rect class="node${v === 1 ? ' current' : ''}" x="90" y="${48 + i * 47}" width="135" height="42" rx="4"/><text class="mono center" x="157" y="${74 + i * 47}">P${v}</text>`).join('')}
        ${[0, 1, 2, 3].map((v, i) => `<rect class="node${v === 3 ? ' current' : ''}" x="440" y="${39 + i * 41}" width="150" height="36" rx="4"/><text class="mono center" x="515" y="${62 + i * 41}">F${v}${v === 3 ? ' · P1' : ''}</text>`).join('')}
        <path class="route" data-draw data-travel d="M225 116H330V180H440"/><text class="small center green" x="337" y="214">页内偏移不变</text>
        <g class="diagram-token" data-token><rect class="token" x="-10" y="-7" width="20" height="14" rx="3"/></g>`;
    } else {
      content = `<rect class="node" x="65" y="77" width="125" height="91" rx="7"/><rect class="node" x="490" y="77" width="125" height="91" rx="7"/>
        <path class="wire" d="M190 123H310M370 123H490"/><circle class="node" cx="340" cy="123" r="30"/>
        <text class="center" x="127" y="118">发送端</text><text class="mono small center" x="127" y="141">Host A</text><text class="center" x="552" y="118">接收端</text><text class="mono small center" x="552" y="141">Host B</text>
        <path class="route" data-draw d="M190 123H310M370 123H490"/><path fill="none" stroke="none" data-travel d="M194 123H486"/>
        <path class="wire" d="M326 123h28m-8-6 8 6-8 6"/><text class="small center" x="340" y="176">路由器</text><text class="small" x="65" y="215">分组沿链路传递</text>
        <g class="diagram-token" data-token><rect class="token" x="-12" y="-8" width="24" height="16" rx="3"/><path stroke="white" stroke-width="1" d="M-5-4v8M0-4v8"/></g>`;
    }
    return `<svg class="diagram" viewBox="0 0 680 230" role="img" aria-labelledby="diagram-title-${key} diagram-desc-${key}"><title id="diagram-title-${key}">${SUBJECTS[key].title}概念预览</title><desc id="diagram-desc-${key}">${captions[key]}</desc>${content}</svg>`;
  }

  function init() {
    const $ = id => document.getElementById(id);
    const Model = window.PortalModel;
    if (!Model || !Array.isArray(window.MODULES)) {
      $('resource-notice').hidden = false;
      $('resource-notice').textContent = '演示目录未能加载，请检查 modules.js 与 portal-model.js 后刷新页面。';
      return;
    }
    const records = window.MODULES;
    const counts = Model.countModules(records);
    const keys = Model.SUBJECT_KEYS;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let userReduced = null;
    let reduced = media.matches;
    let view = null, previewKey = null, previewTimer = null, resizeFrame = null;
    let enteredHub = false, routeCleanup = null;
    const animations = new Map();
    const rows = new Map(), cards = new Map();
    const filters = new Map();

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }
    function put(id, value) {
      const node = $(id), text = String(value);
      if (node.textContent !== text) node.textContent = text;
    }
    function cancelGroup(group) {
      const owned = animations.get(group);
      if (!owned) return;
      [...owned].forEach(animation => animation.cancel());
      owned.clear();
    }
    function cancelAll() { finishRouteTransition(); animations.forEach((_, group) => cancelGroup(group)); }
    function animate(node, frames, options = {}, group = 'ui') {
      if (reduced || document.hidden || typeof node.animate !== 'function') return null;
      const animation = node.animate(frames, { duration: 260, easing: EASE, ...options });
      if (!animations.has(group)) animations.set(group, new Set());
      const owned = animations.get(group);
      owned.add(animation);
      animation.onfinish = animation.oncancel = () => owned.delete(animation);
      return animation;
    }
    function finishRouteTransition() {
      const cleanup = routeCleanup;
      routeCleanup = null;
      cancelGroup('route');
      if (cleanup) cleanup();
    }
    function hubLabelSelector(key) {
      return keys.includes(key) ? `.subject-row[data-subject="${key}"] .subject-name` : `.collection-link[href="#${key}"] > span:first-child`;
    }
    function textRect(node) {
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    }
    function captureRouteTransition(previous, next) {
      if (previous === null || (previous !== 'hub' && next !== 'hub') || reduced || document.hidden || typeof document.body.animate !== 'function') return null;
      const leavingHub = previous === 'hub';
      const section = $(leavingHub ? 'view-hub' : 'view-catalog');
      const fromPreview = leavingHub && keys.includes(next) && document.activeElement?.closest('.preview-panel');
      const selector = leavingHub ? (fromPreview ? '#preview-title' : hubLabelSelector(next)) : '#catalog-title';
      const source = section.querySelector(selector);
      const bounds = section.getBoundingClientRect();
      const clone = section.cloneNode(true);
      const clonedTitle = clone.querySelector(selector);
      // 快照只作 100ms 的退场底片；不保留重复 ID 或可聚焦的副本。
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      clone.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach(node => node.setAttribute('tabindex', '-1'));
      Object.assign(clone.style, { position: 'absolute', left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', margin: '0' });
      const backdrop = el('div', 'route-outgoing');
      backdrop.setAttribute('aria-hidden', 'true'); backdrop.inert = true; backdrop.appendChild(clone);
      return {
        backdrop, clonedTitle,
        source: keys.includes(leavingHub ? next : previous) ? textRect(source) : null,
        fontSize: source ? parseFloat(getComputedStyle(source).fontSize) : 0,
        text: source ? source.textContent : '',
        target: next === 'hub' ? hubLabelSelector(previous) : '#catalog-title'
      };
    }
    function playRouteTransition(snapshot) {
      if (!snapshot) return;
      const section = $(view === 'hub' ? 'view-hub' : 'view-catalog');
      const target = section.querySelector(snapshot.target), destination = textRect(target);
      const source = snapshot.source, headerBottom = document.querySelector('.site-header').getBoundingClientRect().bottom;
      const onScreen = rect => rect && rect.top >= headerBottom && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
      const shared = onScreen(source) && onScreen(destination);
      const oldOpacity = target ? target.style.opacity : '';
      let ghost = null;
      // 先提交真实页面，再播放不拦截点击的视觉底片；搜索及导航不等转场结束。
      document.body.appendChild(snapshot.backdrop);
      const cleanup = () => {
        snapshot.backdrop.remove();
        if (ghost) ghost.remove();
        if (target) target.style.opacity = oldOpacity;
      };
      routeCleanup = cleanup;
      animate(snapshot.backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' }, 'route');
      let completion = animate(section, [{ opacity: 0 }, { opacity: 1 }], { duration: shared ? 120 : 180, delay: shared ? 160 : 80, fill: 'backwards' }, 'route');
      if (shared) {
        if (snapshot.clonedTitle) snapshot.clonedTitle.style.opacity = '0';
        const style = getComputedStyle(target), scale = snapshot.fontSize / parseFloat(style.fontSize);
        ghost = el('div', 'route-title'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
        Object.assign(ghost.style, { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight });
        const oldText = el('span', '', snapshot.text), newText = el('span', 'route-title-new', target.textContent);
        ghost.append(oldText, newText); document.body.appendChild(ghost);
        const glyph = textRect(oldText);
        target.style.opacity = '0';
        completion = animate(ghost, [
          { transform: `translate(${source.left - glyph.left * scale}px, ${source.top - glyph.top * scale}px) scale(${scale})` },
          { transform: `translate(${destination.left - glyph.left}px, ${destination.top - glyph.top}px) scale(1)` }
        ], { duration: 280, fill: 'forwards' }, 'route');
        animate(oldText, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: .4 }, { opacity: 0, offset: .85 }, { opacity: 0, offset: 1 }], { duration: 280, fill: 'forwards' }, 'route');
        animate(newText, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .4 }, { opacity: 1, offset: .85 }, { opacity: 1, offset: 1 }], { duration: 280, fill: 'forwards' }, 'route');
      }
      if (completion) completion.finished.then(() => { if (routeCleanup === cleanup) finishRouteTransition(); }).catch(() => {});
      else finishRouteTransition();
    }
    function clearPreviewTimer() {
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    function playDiagram() {
      if (reduced || document.hidden) return;
      const stage = $('preview-visual');
      const path = stage.querySelector('[data-draw]');
      if (path) {
        const length = path.getTotalLength();
        path.style.strokeDasharray = `${length} ${length}`;
        animate(path, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: 750, delay: 60, easing: 'linear' }, 'preview');
      }
      const reveal = stage.querySelector('[data-reveal]');
      if (reveal) animate(reveal, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: previewKey === 'ds' ? 600 : 180 }, 'preview');
      const travel = stage.querySelector('[data-travel]');
      const token = stage.querySelector('[data-token]');
      if (travel && token) {
        const length = travel.getTotalLength();
        const frames = Array.from({ length: 41 }, (_, i) => {
          const p = i / 40, point = travel.getPointAtLength(p * length);
          return { transform: `translate(${point.x}px, ${point.y}px)`, opacity: Math.min(1, p * 10, (1 - p) * 10), offset: p };
        });
        animate(token, frames, { duration: 850, delay: 120, easing: 'linear' }, 'preview');
      }
    }
    function featured(key) {
      const available = records.filter(record => record.discipline === key);
      const preferred = SUBJECTS[key].featured.map(term => available.find(record => record.title.includes(term))).filter(Boolean);
      return [...new Set([...preferred, ...available])].slice(0, 3);
    }
    function renderPreview(key, motion = true) {
      if (view !== 'hub' || !keys.includes(key) || previewKey === key) return;
      clearPreviewTimer(); cancelGroup('preview');
      previewKey = key;
      rows.forEach((row, subject) => row.classList.toggle('is-preview', subject === key));
      const meta = SUBJECTS[key], number = String(keys.indexOf(key) + 1).padStart(2, '0');
      put('preview-code', `${number} / ${meta.code}`); put('preview-title', meta.title);
      $('preview-open').href = '#' + key;
      $('preview-open').replaceChildren(document.createTextNode(`查看 ${counts[key]} 个演示 `), el('span', '', '↗'));
      $('preview-open').lastChild.setAttribute('aria-hidden', 'true');
      $('preview-visual').innerHTML = diagram(key);
      $('preview-links').replaceChildren(...featured(key).map(record => {
        const link = el('a', 'preview-link'); link.href = record.path;
        const title = el('span', '', record.title); title.title = record.title;
        const arrow = el('span', 'link-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true');
        link.append(title, arrow); return link;
      }));
      if (motion) {
        animate($('preview-visual'), [{ opacity: .2, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 }, 'preview');
        playDiagram();
      }
    }

    keys.forEach((key, index) => {
      const row = el('a', 'subject-row'); row.href = '#' + key; row.dataset.subject = key;
      row.append(el('span', 'subject-number', String(index + 1).padStart(2, '0')), el('span', 'subject-name', SUBJECTS[key].short), el('span', 'subject-count', counts[key]), el('span', 'subject-arrow', '↗'));
      row.lastChild.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-label', `${SUBJECTS[key].title}，${counts[key]} 个演示`);
      row.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        clearPreviewTimer();
        previewTimer = window.setTimeout(() => { previewTimer = null; renderPreview(key); }, 100);
      });
      row.addEventListener('pointerleave', clearPreviewTimer);
      row.addEventListener('focus', () => { clearPreviewTimer(); renderPreview(key); });
      rows.set(key, row); $('subject-list').appendChild(row);
    });
    ['all', ...keys, 'cs'].forEach(key => {
      const link = el('a', 'filter-link'); link.href = '#' + key; link.dataset.view = key;
      link.append(el('span', '', SUBJECTS[key].short), el('span', 'filter-count', counts[key]));
      filters.set(key, link); $('subject-filters').appendChild(link);
    });
    records.forEach(record => {
      const meta = SUBJECTS[record.discipline];
      const card = el('article', 'project-card'); card.dataset.discipline = record.discipline; card.dataset.path = record.path;
      const link = el('a', 'project-link'); link.href = record.path;
      const information = el('div', 'project-meta');
      const badge = (record.badge || '').replace(/\b60fps\s*/gi, '').trim();
      information.append(el('span', '', meta.short), el('span', '', badge));
      const title = el('h3', 'project-title', record.title);
      const description = el('p', 'project-description', record.desc || '');
      const footer = el('div', 'project-footer');
      // 目录不加载公式引擎；TeX 形式留给演示页排版，不在卡片上暴露源码。
      const plainFormula = record.formula && !/\\|_|\^\{/.test(record.formula) ? record.formula : '进入演示';
      const formula = el('span', 'project-formula', plainFormula); formula.title = plainFormula;
      const arrow = el('span', 'project-arrow'); arrow.setAttribute('aria-hidden', 'true');
      footer.append(formula, arrow); link.append(information, title, description, footer); card.appendChild(link);
      cards.set(record, card); $('projects-grid').appendChild(card);
    });
    put('header-all-count', counts.all); put('hub-total-count', counts.all); put('hub-all-count', counts.all); put('hub-cs-count', counts.cs);

    function moveIndicator(indicator, target) {
      if (!target || target.closest('[hidden]')) { indicator.style.opacity = '0'; return; }
      indicator.style.transform = `translateX(${target.offsetLeft}px) scaleX(${target.offsetWidth})`;
      indicator.style.opacity = '1';
    }
    function updateIndicators() {
      moveIndicator($('top-nav-indicator'), $(view === 'hub' ? 'nav-hub' : 'nav-all'));
      moveIndicator($('filter-indicator'), filters.get(view));
    }
    function nearViewport(rect) { return rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight + 100; }
    function renderCatalog(motion = true) {
      const input = $('filter-search'), query = input.value;
      const matched = Model.filterModules(records, view, query);
      const visible = new Set(matched), before = new Map(), previouslyShown = new Set();
      cards.forEach((card, record) => {
        if (!card.hidden) {
          previouslyShown.add(record);
          if (motion && !reduced) {
            const rect = card.getBoundingClientRect();
            if (nearViewport(rect)) before.set(record, { rect, opacity: Number(getComputedStyle(card).opacity) });
          }
        }
      });
      cancelGroup('catalog');
      cards.forEach((card, record) => { card.hidden = !visible.has(record); });
      const scope = counts[view];
      put('result-status', query.trim() ? `显示 ${matched.length} / ${scope} 个演示` : `${matched.length} 个演示`);
      $('clear-search').hidden = !query;
      $('empty-state').hidden = matched.length > 0;
      $('empty-clear').hidden = !query;
      $('empty-state').querySelector('h2').textContent = query.trim() ? '没有匹配的演示' : '目录暂无演示';
      $('empty-state').querySelector('p').textContent = query.trim() ? '试试更短的关键词，或切换学科。' : '新增演示会自动收录在这里。';
      if (!motion || reduced || document.hidden) return;
      // 先统一读取新位置，再统一写入动画，避免读写交错。只处理视口附近的对象。
      const after = matched.map(record => ({ record, card: cards.get(record), rect: cards.get(record).getBoundingClientRect() })).filter(item => nearViewport(item.rect));
      let incoming = 0;
      after.forEach(({ record, card, rect }) => {
        const previous = before.get(record);
        if (previous) {
          const x = previous.rect.left - rect.left, y = previous.rect.top - rect.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1 || previous.opacity < .99) animate(card, [{ transform: `translate(${x}px, ${y}px)`, opacity: previous.opacity }, { transform: 'translate(0, 0)', opacity: 1 }], { duration: 260 }, 'catalog');
        } else if (!previouslyShown.has(record)) {
          animate(card, [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, delay: Math.min(incoming++, 5) * 18 }, 'catalog');
        }
      });
    }
    function route() {
      const next = Model.normalizeView(window.location.hash);
      if (next === view) return;
      finishRouteTransition();
      const previous = view;
      const transition = captureRouteTransition(previous, next);
      const focusInHub = $('view-hub').contains(document.activeElement);
      const focusInCatalog = $('view-catalog').contains(document.activeElement);
      clearPreviewTimer(); cancelGroup('preview'); cancelGroup('entrance');
      view = next;
      $('view-hub').hidden = view !== 'hub'; $('view-catalog').hidden = view === 'hub';
      const activeNav = view === 'hub' ? 'nav-hub' : 'nav-all';
      ['nav-hub', 'nav-all'].forEach(id => {
        if (id === activeNav) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
      });
      if (view === 'hub') {
        cancelGroup('catalog');
        renderPreview(keys.includes(previous) ? previous : previewKey || 'math', previous === null && !enteredHub);
        if (!enteredHub) {
          if (previous === null) document.querySelectorAll('[data-entrance]').forEach((node, i) => animate(node, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, delay: i * 45 }, 'entrance'));
          enteredHub = true;
        }
      } else {
        const meta = SUBJECTS[view];
        put('catalog-code', meta.code); put('catalog-title', meta.title); put('catalog-description', meta.description);
        document.title = meta.title + ' · 可视化实验室';
        $('filter-search').value = '';
        filters.forEach((link, key) => {
          if (key === view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        renderCatalog(previous !== null && previous !== 'hub');
      }
      if (view === 'hub') document.title = '可视化实验室 · 看见知识的过程';
      if (previous !== null) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (view === 'hub' && focusInCatalog) $('hub-title').focus({ preventScroll: true });
        else if (view !== 'hub' && focusInHub) $('catalog-title').focus({ preventScroll: true });
      }
      updateIndicators();
      playRouteTransition(transition);
    }
    function setMotion() {
      reduced = userReduced === null ? media.matches : userReduced;
      document.body.dataset.reduced = String(reduced);
      $('motion-toggle').setAttribute('aria-pressed', String(reduced));
      put('motion-label', reduced ? '动效已减弱' : '减少动效');
      if (reduced) cancelAll();
    }
    function clearSearch() {
      $('filter-search').value = ''; renderCatalog(); $('filter-search').focus({ preventScroll: true });
    }
    function focusSearch() {
      if (view === 'hub') {
        window.location.hash = 'all';
        // 在 hashchange 之前同步显示目录，随后事件由单一路由状态去重。
        route();
      }
      $('filter-search').focus({ preventScroll: true });
      if ($('filter-search').getBoundingClientRect().top < 76) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    $('filter-search').addEventListener('input', () => renderCatalog());
    $('clear-search').addEventListener('click', clearSearch);
    $('empty-clear').addEventListener('click', clearSearch);
    $('filter-search').addEventListener('keydown', event => {
      if (!event.isComposing && event.key === 'Escape' && event.target.value) { event.preventDefault(); clearSearch(); }
    });
    $('global-search').disabled = false; $('global-search').addEventListener('click', focusSearch);
    $('motion-toggle').disabled = false;
    $('motion-toggle').addEventListener('click', () => { userReduced = !reduced; setMotion(); });
    media.addEventListener('change', setMotion);
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', () => {
      finishRouteTransition(); cancelGroup('catalog');
      if (resizeFrame === null) resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; updateIndicators(); });
    });
    function stopMotion() {
      clearPreviewTimer(); cancelAll();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
    window.addEventListener('pagehide', stopMotion);
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest('input, textarea, select, button, [contenteditable]')) return;
      if (event.key === '/') { event.preventDefault(); focusSearch(); }
    });
    setMotion(); route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
