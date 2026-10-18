/* DNS 查询全景 · 事件推演模型（纯计算，无 DOM） */
(function (root, factory) {
  const data = typeof module === 'object' && module.exports ? require('./data.js') : root.DNSData;
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DNSModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  const MESSAGES = {
    client: { qr: 0, rd: 1, aa: 0, an: 0, ns: 0, ar: 0, label: '客户端查询', tone: 'query' },
    iterative: { qr: 0, rd: 0, aa: 0, an: 0, ns: 0, ar: 0, label: '迭代查询', tone: 'query' },
    recursive: { qr: 0, rd: 1, aa: 0, an: 0, ns: 0, ar: 0, label: '递归查询', tone: 'query' },
    referral: { qr: 1, rd: 0, aa: 0, an: 0, ns: 1, ar: 1, label: '推荐应答', tone: 'referral' },
    answer: { qr: 1, rd: 1, aa: 1, an: 1, ns: 0, ar: 0, label: '权威应答', tone: 'answer' }
  };

  const ZONES = ['single', 'two'];
  const MODES = ['iterative', 'recursive'];
  const TARGETS = ['t', 'u'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildScenario(zone, mode, target) {
    if (!ZONES.includes(zone)) throw new RangeError(`未知区划模式: ${zone}`);
    if (!MODES.includes(mode)) throw new RangeError(`未知查询方式: ${mode}`);
    if (!TARGETS.includes(target)) throw new RangeError(`未知目标主机: ${target}`);

    const targetInfo = D.TARGETS[target];
    const isT = target === 't';
    const twoZones = zone === 'two';
    const host = targetInfo.host;
    const steps = [];
    const state = {
      zone,
      mode,
      target,
      outbound: 0,
      match: 'root',
      trail: D.TRAIL_BY_MATCH.root.slice(),
      queried: [],
      answeredBy: null,
      resolved: false,
      answer: null,
      usedRoutes: {}
    };

    const snapshot = () => clone(state);

    function addStep(definition) {
      const before = snapshot();
      if (definition.match) {
        state.match = definition.match;
        state.trail = D.TRAIL_BY_MATCH[definition.match].slice();
      }
      if (definition.outbound !== undefined) state.outbound = definition.outbound;
      if (definition.queried) {
        for (const server of definition.queried) {
          if (!state.queried.includes(server)) state.queried.push(server);
        }
      }
      if (definition.answeredBy) state.answeredBy = definition.answeredBy;
      if (definition.resolved) {
        state.resolved = true;
        state.answer = targetInfo.ip;
      }
      for (const flight of definition.flights) {
        state.usedRoutes[D.routeKey(flight.from, flight.to)] = flight.kind;
      }
      const after = snapshot();
      steps.push({
        ...definition,
        before,
        after,
        target: targetInfo,
        zone,
        mode,
        index: steps.length
      });
    }

    const q = (from, to, kind, label) => ({ from, to, kind, label });
    const query = (from, to) => q(from, to, 'query', '询问');
    const relay = (from, to) => q(from, to, 'relay', '代问');
    const referral = (from, to) => q(from, to, 'referral', '推荐');
    const answer = (from, to) => q(from, to, 'answer', '应答');

    /* 第一步在两种查询方式下相同：客户端把查询交给本地 DNS，RD=1。 */
    addStep({
      key: 'client',
      short: '发起',
      phase: '请求',
      title: '客户端发起查询',
      caption: `客户端把 ${host} 交给本地 DNS，期望递归（RD=1）。`,
      duration: 1.5,
      flights: [query('client', 'local')],
      messageQuery: MESSAGES.client,
      messageReply: MESSAGES.client,
      match: 'root',
      outbound: 0,
      queried: [],
      tag: null
    });

    if (mode === 'iterative') {
      addStep({
        key: 'root',
        short: '问根',
        phase: '根域',
        title: '本地 DNS 询问根服务器',
        caption: '根不直接回答，只指向 .com 的顶级域服务器。',
        duration: 2.6,
        flights: [query('local', 'root'), referral('root', 'local')],
        messageQuery: MESSAGES.iterative,
        messageReply: MESSAGES.referral,
        match: 'root',
        outbound: 1,
        queried: ['root'],
        tag: '只给线索',
        tagAt: 'root'
      });

      addStep({
        key: 'tld',
        short: '问 TLD',
        phase: '顶级域',
        title: '本地 DNS 询问 .com',
        caption: '.com 不回答最终地址，只指向 abc.com 的权限服务器。',
        duration: 2.6,
        flights: [query('local', 'tld'), referral('tld', 'local')],
        messageQuery: MESSAGES.iterative,
        messageReply: MESSAGES.referral,
        match: 'com',
        outbound: 2,
        queried: ['tld'],
        tag: '指向 abc',
        tagAt: 'tld'
      });

      if (!isT) {
        /* u.x.abc.com：即使 y 被委派，u 仍在 abc.com 主区内，查询仍是 3 次。 */
        addStep({
          key: 'auth-u',
          short: '问 abc',
          phase: '权限',
          title: '权限服务器直接应答',
          caption: 'u 未被委派，仍在 abc.com 区内；权限服务器直接给出地址。',
          duration: 3.2,
          flights: [
            query('local', 'auth'),
            answer('auth', 'local'),
            answer('local', 'client')
          ],
          messageQuery: MESSAGES.iterative,
          messageReply: MESSAGES.answer,
          match: 'u',
          outbound: 3,
          queried: ['auth'],
          answeredBy: 'auth',
          resolved: true,
          tag: '同区直答',
          tagAt: 'auth'
        });
      } else if (!twoZones) {
        /* t.y.abc.com · 单区：abc 直接拥有 t 的权威记录，3 次查询完成。 */
        addStep({
          key: 'auth-t',
          short: '问 abc',
          phase: '权限',
          title: '权限服务器单区应答',
          caption: 'abc.com 直接拥有 t 的权威记录，返回地址并交付客户端。',
          duration: 3.2,
          flights: [
            query('local', 'auth'),
            answer('auth', 'local'),
            answer('local', 'client')
          ],
          messageQuery: MESSAGES.iterative,
          messageReply: MESSAGES.answer,
          match: 't',
          outbound: 3,
          queried: ['auth'],
          answeredBy: 'auth',
          resolved: true,
          tag: 'AA · 权威',
          tagAt: 'auth'
        });
      } else {
        /* t.y.abc.com · 两区：abc 只给委派线索，必须追加第 4 次查询。 */
        addStep({
          key: 'auth-referral',
          short: '问 abc',
          phase: '权限',
          title: 'abc 识别 y 已委派',
          caption: 'abc.com 发现 y 已独立成区，返回 dns.y.abc.com 的委派线索。',
          duration: 2.6,
          flights: [query('local', 'auth'), referral('auth', 'local')],
          messageQuery: MESSAGES.iterative,
          messageReply: MESSAGES.referral,
          match: 'abc',
          outbound: 3,
          queried: ['auth'],
          tag: 'y 已委派',
          tagAt: 'auth'
        });

        addStep({
          key: 'authy',
          short: '问 y',
          phase: '子区',
          title: '本地 DNS 追加查询 y 子区',
          caption: '本地 DNS 追加第 4 次查询，y 子区给出最终地址并交付客户端。',
          duration: 3.4,
          flights: [
            query('local', 'authy'),
            answer('authy', 'local'),
            answer('local', 'client')
          ],
          messageQuery: MESSAGES.iterative,
          messageReply: MESSAGES.answer,
          match: 't',
          outbound: 4,
          queried: ['authy'],
          answeredBy: 'authy',
          resolved: true,
          tag: '跨区查询',
          tagAt: 'authy'
        });
      }
    } else {
      /* 递归：本地只发一次；右侧服务器总线逐级接力。 */
      addStep({
        key: 'recur-root',
        short: '问根',
        phase: '根域',
        title: '本地 DNS 请求根服务器递归',
        caption: '本地 DNS 只向外发出 1 次查询，请根服务器代为递归。',
        duration: 2.1,
        flights: [relay('local', 'root')],
        messageQuery: MESSAGES.recursive,
        messageReply: MESSAGES.recursive,
        match: 'root',
        outbound: 1,
        queried: ['root'],
        tag: '本地只发 1 次',
        tagAt: 'local'
      });

      addStep({
        key: 'recur-tld',
        short: '根代问',
        phase: '顶级域',
        title: '根服务器代问 .com',
        caption: '根服务器接力，代问 .com 顶级域服务器；本地保持等待。',
        duration: 1.9,
        flights: [relay('root', 'tld')],
        messageQuery: MESSAGES.recursive,
        messageReply: MESSAGES.recursive,
        match: 'com',
        outbound: 1,
        queried: ['tld'],
        tag: '根代问',
        tagAt: 'tld'
      });

      addStep({
        key: 'recur-auth',
        short: 'TLD 代问',
        phase: '权限',
        title: '.com 代问 abc.com',
        caption: 'TLD 继续接力，代问 abc.com 权限服务器；本地仍只发过 1 次。',
        duration: 1.9,
        flights: [relay('tld', 'auth')],
        messageQuery: MESSAGES.recursive,
        messageReply: MESSAGES.recursive,
        match: 'abc',
        outbound: 1,
        queried: ['auth'],
        tag: 'TLD 代问',
        tagAt: 'auth'
      });

      if (isT && twoZones) {
        addStep({
          key: 'recur-authy',
          short: 'abc 代问',
          phase: '子区',
          title: 'abc 代问 y 子区',
          caption: 'abc 识别 y 独立成区，再把请求交给 y 子区服务器。',
          duration: 1.9,
          flights: [relay('auth', 'authy')],
          messageQuery: MESSAGES.recursive,
          messageReply: MESSAGES.recursive,
          match: 'y',
          outbound: 1,
          queried: ['authy'],
          tag: '跨区代问',
          tagAt: 'authy'
        });
      }

      const returnFlights = (isT && twoZones)
        ? [
            answer('authy', 'auth'),
            answer('auth', 'tld'),
            answer('tld', 'root'),
            answer('root', 'local'),
            answer('local', 'client')
          ]
        : [
            answer('auth', 'tld'),
            answer('tld', 'root'),
            answer('root', 'local'),
            answer('local', 'client')
          ];

      addStep({
        key: 'recur-return',
        short: '返回',
        phase: '应答',
        title: '答案沿原链返回',
        caption: '最终地址沿原链返回；本地对外始终只查询 1 次。',
        duration: returnFlights.length === 5 ? 3.8 : 3.4,
        flights: returnFlights,
        messageQuery: MESSAGES.recursive,
        messageReply: MESSAGES.answer,
        match: target,
        outbound: 1,
        queried: [],
        answeredBy: isT && twoZones ? 'authy' : 'auth',
        resolved: true,
        tag: '只发 1 次',
        tagAt: 'local'
      });
    }

    const total = Math.round(steps.reduce((sum, step) => sum + step.duration, 0) * 1000) / 1000;
    return {
      key: `${zone}/${mode}/${target}`,
      zone,
      mode,
      target,
      targetInfo,
      steps,
      total
    };
  }

  return {
    MESSAGES,
    ZONES,
    MODES,
    TARGETS,
    buildScenario
  };
});
