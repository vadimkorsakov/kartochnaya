// JSON model operations only. No repair on load, DOM, storage or editor state.
const copy = value => JSON.parse(JSON.stringify(value));
const identity = value => typeof value === 'string' && value.length > 0;

// Reserve references too: a fresh ID must never accidentally heal a dangling link.
export function canvasGraphIds(value) {
  const ids = [];
  const canvas = node => {
    for (const item of [...(node.elements || []), ...(node.groups || [])]) {
      ids.push(item.id, item.groupId, item.parentId, item.clipBaseId, item.pathBoundary?.sourceId);
    }
    ids.push(node.id);
  };
  canvas(value);
  for (const slide of value.slides || []) canvas(slide);
  return ids.filter(identity);
}
function allocator(source, generateId, reservedIds = []) {
  const used = new Set([...canvasGraphIds(source), ...reservedIds]);
  return () => {
    const id = generateId();
    if (!identity(id) || used.has(id)) throw new Error('Конфликт нового идентификатора');
    used.add(id); return id;
  };
}

/**
 * Full clones preserve historical unresolved references; they do not repair data.
 * Selections remap copied targets, keep external targets present in destination,
 * detach unavailable boundary links (keeping geometry/fallback), and unclip when
 * the base is unavailable. Only copied groups or destination groups are retained.
 */
export function remapCanvasGraph(canvasLike, generateId, options = {}) {
  return remapGraph(canvasLike, allocator(canvasLike, generateId, [...(options.reservedIds || []), ...(options.availableElementIds || []), ...(options.availableGroupIds || [])]), options).result;
}
function remapGraph(canvasLike, fresh, options = {}, maps = {}) {
  const result = copy(canvasLike);
  const mapIds = (items, map = new Map()) => {
    const seen = new Set();
    for (const item of items || []) {
      if (identity(item.id) && seen.has(item.id)) throw new Error('Повторный идентификатор в холсте');
      const next = map.get(item.id) || fresh();
      if (identity(item.id)) { seen.add(item.id); map.set(item.id, next); }
      item.id = next;
    }
    return map;
  };
  const elements = mapIds(result.elements, maps.elements), groups = mapIds(result.groups, maps.groups);
  const availableElements = new Set(options.availableElementIds || []);
  const availableGroups = new Set(options.availableGroupIds || []);
  const reference = (id, map, available) => map.get(id) || (options.selection && !available.has(id) ? null : id);
  for (const e of result.elements || []) {
    if (e.groupId) e.groupId = reference(e.groupId, groups, availableGroups);
    if (e.clipBaseId) {
      const target = reference(e.clipBaseId, elements, availableElements);
      if (target) e.clipBaseId = target;
      else { delete e.clipBaseId; e.clipped = false; }
    }
    if (e.pathBoundary?.sourceId) {
      const old = e.pathBoundary.sourceId;
      e.pathBoundary.sourceId = reference(old, elements, availableElements);
      if (options.selection && e.pathBoundary.sourceId !== old) e.pathBoundary.sourceLast = null;
    }
    if (options.selection && e.type === 'text') e.isTitleLayer = false;
  }
  for (const g of result.groups || []) if (g.parentId) g.parentId = reference(g.parentId, groups, availableGroups);
  return { result, elements, groups };
}

// The root and active slide are two representations of one canvas. Share their
// ID maps, preserving each representation's fields (including historical absence
// or divergence) rather than overwriting user data while cloning.
export function remapDocumentGraph(document, generateId, options = {}) {
  const fresh = allocator(document, generateId, options.reservedIds);
  const root = remapGraph(document, fresh), result = root.result;
  result.id = fresh();
  if (Array.isArray(document.slides) && document.slides.length) {
    const active = Math.max(0, Math.min(document.slides.length - 1, Number(document.activeSlideIndex) || 0));
    result.slides = document.slides.map((slide, i) => {
      const next = remapGraph(slide, fresh, {}, i === active ? root : {}).result;
      next.id = fresh();
      return next;
    });
  }
  return result;
}

// Include explicit groups and descendants, including empty subgroups. A plain
// layer selection does not implicitly duplicate its containing group.
export function selectCanvasGraph(canvas, elementIds, groupIds = []) {
  const chosen = new Set(elementIds), roots = new Set(groupIds);
  const groups = new Map((canvas.groups || []).map(g => [g.id, g]));
  const included = group => {
    const seen = new Set(); let id = group.id;
    while (id && !seen.has(id)) {
      if (roots.has(id)) return true;
      seen.add(id); id = groups.get(id)?.parentId;
    }
    return false;
  };
  const result = copy({ elements: (canvas.elements || []).filter(e => chosen.has(e.id)), groups: [...groups.values()].filter(included) });
  // Old clipped layers may omit clipBaseId. Capture the existing stacking
  // semantics for the new copy only; never rewrite the source or stale links.
  for (const e of result.elements) if (e.clipped && !e.clipBaseId) {
    const index = canvas.elements.findIndex(item => item.id === e.id);
    for (let i = index - 1; i >= 0; i--) {
      const below = canvas.elements[i];
      if ((below.groupId || null) !== (e.groupId || null)) break;
      if (!below.clipped) { e.clipBaseId = below.id; break; }
    }
  }
  return result;
}
