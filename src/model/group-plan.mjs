// Pure preflight: no document mutation, ID allocation, history or persistence.
export function planLayerGroup(doc, elementIds, groupIds, newId) {
  const elements = doc.elements, groups = doc.groups || [];
  const fail = message => { throw new Error(message); };
  const ids = [...elements, ...groups].map(x => x.id);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || ids.includes(newId)) fail('Конфликт идентификаторов слоёв');
  const byGroup = new Map(groups.map(g => [g.id, g]));
  const chain = id => {
    const result = [];
    while (id) {
      if (!byGroup.has(id) || result.includes(id)) fail('Нарушена иерархия групп');
      result.push(id); id = byGroup.get(id).parentId;
    }
    return result;
  };
  groups.forEach(g => chain(g.id));
  const ancestry = new Map(elements.map(e => [e.id, chain(e.groupId)]));
  // A folder is an indivisible contiguous block, including nested descendants.
  const checkBlocks = list => {
    for (const g of groups) {
      const positions = list.flatMap((e, i) => ancestry.get(e.id).includes(g.id) ? [i] : []);
      if (positions.length && positions.at(-1) - positions[0] + 1 !== positions.length) fail('Нельзя разделять содержимое группы');
    }
  };
  checkBlocks(elements);
  const requested = new Set(groupIds);
  for (const id of requested) if (!byGroup.has(id)) fail('Группа не найдена');
  const roots = groups.filter(g => requested.has(g.id) && !chain(g.parentId).some(id => requested.has(id)));
  const inside = e => roots.some(g => ancestry.get(e.id).includes(g.id));
  const chosen = new Set(elementIds);
  for (const id of chosen) if (!ancestry.has(id)) fail('Слой не найден');
  const leaves = elements.filter(e => chosen.has(e.id) && !inside(e));
  if (leaves.length + roots.length < 2) fail('Выбери минимум два слоя или папки');
  const parents = [...leaves.map(e => e.groupId || null), ...roots.map(g => g.parentId || null)];
  if (!parents.every(id => id === parents[0])) fail('Группировать можно только слои одного уровня');
  const moving = elements.filter(e => chosen.has(e.id) || inside(e));
  if (!moving.length) fail('Выбери непустые слои или папки');
  const movingIds = new Set(moving.map(e => e.id));
  const top = elements.findLastIndex(e => movingIds.has(e.id));
  // Array order is bottom to top: insert after all unselected objects below
  // the uppermost selected object, not at the lowest selected index.
  const insertion = elements.slice(0, top + 1).filter(e => !movingIds.has(e.id)).length;
  const remaining = elements.filter(e => !movingIds.has(e.id));
  remaining.splice(insertion, 0, ...moving);
  checkBlocks(remaining);
  const leafIds = new Set(leaves.map(e => e.id));
  const proposed = remaining.map(e => leafIds.has(e.id) ? { ...e, groupId: newId } : e);
  // Match findClipBase's order/folder semantics, including legacy missing IDs
  // and unresolved chains. Never unclip or rewrite clipBaseId as a repair.
  const bases = list => {
    const result = new Map();
    let parent, base = null;
    for (const e of list) {
      if ((e.groupId || null) !== parent) base = null;
      parent = e.groupId || null;
      if (e.clipped) result.set(e.id, base);
      else base = e.id;
    }
    return result;
  };
  const before = bases(elements), after = bases(proposed);
  if ([...before].some(([id, base]) => after.get(id) !== base)) fail('Группировка изменит обтравочную маску. Выбери всю цепочку вместе с базой');
  // Region effects consume the accumulated backdrop. Crossing a region changes
  // its input even when every clipping base is unchanged.
  for (const region of elements.filter(e => e.isFxRegion)) {
    const below = list => list.slice(0, list.findIndex(e => e.id === region.id)).map(e => e.id).join('\0');
    if (below(elements) !== below(proposed)) fail('Группировка изменит область действия эффекта выделения');
  }
  return { elements: remaining, leaves, roots, parentId: parents[0] };
}
