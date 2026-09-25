(function (root) {
  'use strict';

  /** LOCAL_PREF 缺省值：RFC 4271 规定缺省为 100，数值越大越优先。 */
  const DEFAULT_LOCAL_PREF = 100;

  /** 构造一条 BGP 路由（VPN/属性只保留考研需要的四项）。 */
  const makeRoute = (prefix, asPath, nextHop, localPref) => ({
    prefix,
    asPath: Array.isArray(asPath) ? asPath.slice() : [],
    nextHop: nextHop || '',
    localPref: typeof localPref === 'number' ? localPref : DEFAULT_LOCAL_PREF
  });

  const cloneRoute = route => ({ ...route, asPath: route.asPath.slice() });

  /**
   * eBGP 通告：
   *  1) 把发送方 AS 号写到 AS_PATH 最前面（prependCount > 1 即 AS 欺骗 / AS prepend）；
   *  2) NEXT_HOP 改写为发送方自己的接口 IP。
   */
  function advertiseEbgp(route, senderAsn, senderIp, prependCount) {
    const times = typeof prependCount === 'number' && prependCount > 0 ? prependCount : 1;
    const prepended = [];
    for (let i = 0; i < times; i += 1) prepended.push(senderAsn);
    return {
      ...cloneRoute(route),
      asPath: prepended.concat(route.asPath),
      nextHop: senderIp
    };
  }

  /**
   * iBGP 通告：
   *  1) AS_PATH 保持不变（同一 AS 内不追加 AS 号）；
   *  2) NEXT_HOP 默认保持不变，只有 next-hop-self 时才改写为发送方接口 IP。
   */
  function advertiseIbgp(route, senderIp, nextHopSelf) {
    return {
      ...cloneRoute(route),
      nextHop: nextHopSelf ? senderIp : route.nextHop
    };
  }

  /** AS_PATH 环路检测：本 AS 号已出现在 AS_PATH 中。 */
  const hasOwnAsInPath = (route, asn) => route.asPath.indexOf(asn) !== -1;

  /** 入站处理：先做 AS_PATH 环路检测，命中即丢弃。 */
  function receiveUpdate(route, receiverAsn) {
    if (hasOwnAsInPath(route, receiverAsn)) {
      return {
        accepted: false,
        reason: 'AS_PATH 已含本 AS 号 ' + receiverAsn + '，丢弃以防环',
        route: null
      };
    }
    return { accepted: true, reason: '通过入站 AS_PATH 环路检测', route: cloneRoute(route) };
  }

  /**
   * 选路比较：只实现考研最常考的三级规则。
   *   1. LOCAL_PREF 大者优先
   *   2. AS_PATH 短者优先
   *   3. NEXT_HOP 地址小者优先（确定性兜底，真实设备还有多条后续规则）
   */
  function compareRoutes(a, b) {
    if (a.localPref !== b.localPref) return b.localPref - a.localPref;
    if (a.asPath.length !== b.asPath.length) return a.asPath.length - b.asPath.length;
    if (String(a.nextHop) < String(b.nextHop)) return -1;
    if (String(a.nextHop) > String(b.nextHop)) return 1;
    return 0;
  }

  /** 说明 a、b 之间到底靠哪一条规则分出胜负。 */
  function decideRule(a, b) {
    if (a.localPref !== b.localPref) {
      return { rule: 'LOCAL_PREF', detail: a.localPref + ' vs ' + b.localPref, winner: a.localPref > b.localPref ? 'a' : 'b' };
    }
    if (a.asPath.length !== b.asPath.length) {
      return { rule: 'AS_PATH 长度', detail: a.asPath.length + ' vs ' + b.asPath.length, winner: a.asPath.length < b.asPath.length ? 'a' : 'b' };
    }
    return {
      rule: 'NEXT_HOP（兜底）',
      detail: a.nextHop + ' vs ' + b.nextHop,
      winner: String(a.nextHop) <= String(b.nextHop) ? 'a' : 'b'
    };
  }

  /** 从候选路由中挑出最优（Best），返回排序后的名次表。 */
  function selectBest(candidates) {
    if (!candidates || !candidates.length) return null;
    return candidates.slice().sort(compareRoutes)[0];
  }

  function ranking(candidates) {
    return candidates.slice().sort(compareRoutes).map((route, i) => ({ rank: i + 1, route }));
  }

  const formatAsPath = asPath => (asPath && asPath.length ? asPath.join(' ') : '本地始发');

  const api = {
    DEFAULT_LOCAL_PREF,
    makeRoute,
    cloneRoute,
    advertiseEbgp,
    advertiseIbgp,
    hasOwnAsInPath,
    receiveUpdate,
    compareRoutes,
    decideRule,
    selectBest,
    ranking,
    formatAsPath
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BgpModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
