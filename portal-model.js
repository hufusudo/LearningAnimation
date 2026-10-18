(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PortalModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUBJECT_KEYS = Object.freeze(['math', 'prob', 'ds', 'co', 'os', 'net']);
  const CS_KEYS = Object.freeze(['ds', 'co', 'os', 'net']);
  const SUBJECT_TERMS = Object.freeze({
    math: 'math 高等数学 高数 数学',
    prob: 'prob 概率论 概率统计 概率',
    ds: 'ds 数据结构 数据结构与算法',
    co: 'co 计算机组成原理 计算机组成 组成原理 计组',
    os: 'os 操作系统',
    net: 'net 计算机网络 网络'
  });

  function normalizeView(value) {
    if (typeof value !== 'string') return 'hub';
    const key = value.charAt(0) === '#' ? value.slice(1) : value;
    return key === 'hub' || key === 'all' || key === 'cs' || SUBJECT_KEYS.includes(key)
      ? key
      : 'hub';
  }

  function countModules(records) {
    const list = Array.isArray(records) ? records : [];
    const counts = { all: list.length, math: 0, prob: 0, ds: 0, co: 0, os: 0, net: 0, cs: 0 };
    for (const record of list) {
      if (record && SUBJECT_KEYS.includes(record.discipline)) counts[record.discipline] += 1;
    }
    counts.cs = CS_KEYS.reduce((sum, key) => sum + counts[key], 0);
    return counts;
  }

  function searchText(record) {
    const discipline = record && record.discipline;
    const fields = ['title', 'desc', 'formula', 'badge', 'path'];
    const text = fields.map((field) => String(record && record[field] != null ? record[field] : '')).join(' ');
    const subjectTerms = SUBJECT_TERMS[discipline] || '';
    return `${text} ${subjectTerms}${CS_KEYS.includes(discipline) ? ' 408' : ''}`.toLowerCase();
  }

  function filterModules(records, view, query = '') {
    const key = normalizeView(view);
    if (key === 'hub') return [];
    const list = Array.isArray(records) ? records : [];
    const terms = String(query == null ? '' : query).trim().toLowerCase().split(/\s+/u).filter(Boolean);
    return list.filter((record) => {
      const discipline = record && record.discipline;
      const inView = key === 'all'
        || (key === 'cs' ? CS_KEYS.includes(discipline) : discipline === key);
      if (!inView) return false;
      if (terms.length === 0) return true;
      const text = searchText(record);
      return terms.every((term) => text.includes(term));
    });
  }

  return { SUBJECT_KEYS, CS_KEYS, normalizeView, countModules, filterModules };
});
