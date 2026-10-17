(function (root) {
  'use strict';

  const CAPACITY = 4;

  function copyGroup(group) {
    return { count: group.count, next: group.next, free: group.free.slice() };
  }

  function copyState(state) {
    const groups = {};
    for (const id of Object.keys(state.groups)) groups[id] = copyGroup(state.groups[id]);
    return {
      memory: copyGroup(state.memory),
      groups,
      occupied: state.occupied.slice()
    };
  }

  function createInitial() {
    return {
      memory: { count: 4, next: 100, free: [101, 102, 103] },
      groups: {
        100: { count: 4, next: 90, free: [91, 92, 93] },
        90: { count: 4, next: 80, free: [81, 82, 83] },
        80: { count: 1, next: null, free: [] }
      },
      occupied: []
    };
  }

  function chain(state) {
    if (!state || !state.memory || !state.groups) return [];
    const result = [];
    const visited = new Set();
    let pointer = state.memory.next;
    while (pointer !== null && !visited.has(pointer)) {
      const group = state.groups[pointer];
      if (!group) break;
      visited.add(pointer);
      result.push({ id: Number(pointer), data: copyGroup(group) });
      pointer = group.next;
    }
    return result;
  }

  function freeBlocks(state) {
    if (!state || !state.memory || !Array.isArray(state.memory.free)) return [];
    const blocks = new Set(state.memory.free);
    for (const item of chain(state)) {
      blocks.add(item.id);
      for (const id of item.data.free) blocks.add(id);
    }
    return Array.from(blocks).sort((a, b) => a - b);
  }

  function isBlockId(id) {
    return Number.isSafeInteger(id) && id > 0;
  }

  function isGroup(group) {
    return Boolean(group) && Number.isInteger(group.count) && group.count >= 1 && group.count <= CAPACITY &&
      Array.isArray(group.free) && group.count === group.free.length + 1 &&
      (group.next === null || isBlockId(group.next)) && group.free.every(isBlockId);
  }

  function isValidState(state) {
    if (!state || typeof state !== 'object' || !isGroup(state.memory) ||
        !state.groups || typeof state.groups !== 'object' || Array.isArray(state.groups) ||
        !Array.isArray(state.occupied) || !state.occupied.every(isBlockId)) return false;

    const groupIds = Object.keys(state.groups);
    for (const key of groupIds) {
      const id = Number(key);
      if (!isBlockId(id) || String(id) !== key || !isGroup(state.groups[key])) return false;
    }

    const visited = new Set();
    let pointer = state.memory.next;
    while (pointer !== null) {
      if (visited.has(pointer) || !Object.prototype.hasOwnProperty.call(state.groups, pointer)) return false;
      visited.add(pointer);
      pointer = state.groups[pointer].next;
    }
    if (visited.size !== groupIds.length) return false;

    const realBlocks = [...state.memory.free];
    for (const id of groupIds) {
      realBlocks.push(Number(id), ...state.groups[id].free);
    }
    const seenBlocks = new Set(realBlocks);
    if (seenBlocks.size !== realBlocks.length) return false;
    const seenOccupied = new Set(state.occupied);
    if (seenOccupied.size !== state.occupied.length) return false;
    for (const id of seenOccupied) if (seenBlocks.has(id)) return false;
    return true;
  }

  function transition(state, action, targetId) {
    if (!isValidState(state) || (action !== 'allocate' && action !== 'reclaim')) return null;

    const before = copyState(state);
    const next = copyState(state);
    let id;
    let kind;

    if (action === 'allocate') {
      if (next.memory.count > 1) {
        id = next.memory.free[next.memory.free.length - 1];
        if (targetId !== undefined && targetId !== id) return null;
        next.memory.free.pop();
        next.memory.count = next.memory.free.length + 1;
        kind = 'allocate-pop';
      } else {
        if (next.memory.next === null) return null;
        id = next.memory.next;
        if (targetId !== undefined && targetId !== id) return null;
        const group = next.groups[id];
        if (!group) return null;
        next.memory = copyGroup(group);
        delete next.groups[id];
        kind = 'allocate-group';
      }
      next.occupied.push(id);
    } else {
      if (targetId === undefined) {
        id = next.occupied[next.occupied.length - 1];
      } else {
        id = targetId;
      }
      if (!isBlockId(id)) return null;
      const occupiedIndex = next.occupied.indexOf(id);
      if (occupiedIndex === -1) return null;

      if (next.memory.count < CAPACITY) {
        next.memory.free.push(id);
        next.memory.count = next.memory.free.length + 1;
        kind = 'reclaim-push';
      } else {
        next.groups[id] = copyGroup(next.memory);
        next.memory = { count: 1, next: id, free: [] };
        kind = 'reclaim-spill';
      }
      next.occupied.splice(occupiedIndex, 1);
    }

    return { kind, id, before, after: copyState(next) };
  }

  function buildDemo() {
    const initial = createInitial();
    const plan = [
      ['allocate', 103], ['allocate', 102], ['allocate', 101], ['allocate', 100],
      ['reclaim', 100], ['reclaim', 101], ['reclaim', 102], ['reclaim', 103]
    ];
    const operations = [];
    let state = initial;
    for (let index = 0; index < plan.length; index += 1) {
      const [action, targetId] = plan[index];
      const result = transition(state, action, targetId);
      if (!result) throw new Error(`默认演示操作失败：${action} ${targetId}`);
      operations.push({ ...result, index, action });
      state = result.after;
    }
    return { initial, final: copyState(state), operations };
  }

  const api = { CAPACITY, createInitial, chain, freeBlocks, transition, buildDemo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GroupedFreeModel = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
