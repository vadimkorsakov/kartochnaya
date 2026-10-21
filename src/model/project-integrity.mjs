// JSON records only. This module inspects copies and never repairs source data.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.length > 0;
const copy = value => JSON.parse(JSON.stringify(value));

export function analyzeProject(project, documents = []) {
  const diagnostics = { errors: [], warnings: [], info: [] };
  const report = (level, code, path) => diagnostics[level].push({ code, path });
  if (!record(project)) { report('errors', 'invalid-project', 'project'); return diagnostics; }
  if (!identity(project.id)) report('warnings', 'missing-historical-id', 'project.id');
  if (!Array.isArray(documents)) { report('errors', 'invalid-documents', 'documents'); return diagnostics; }
  const list = (owner, key, path) => {
    if (owner[key] == null) { report('info', 'optional-field-absent', path); return []; }
    if (!Array.isArray(owner[key])) { report('errors', 'invalid-list', path); return []; }
    return owner[key];
  };
  const index = (items, path) => {
    const ids = new Map();
    items.forEach((item, i) => {
      if (!record(item) || !identity(item.id)) report('errors', 'invalid-id', `${path}[${i}]`);
      else if (ids.has(item.id)) report('errors', 'duplicate-id', `${path}[${i}].id`);
      else ids.set(item.id, item);
    });
    return ids;
  };
  const folders = list(project, 'resourceFolders', 'project.resourceFolders');
  const resources = list(project, 'resources', 'project.resources');
  const folderIds = index(folders, 'project.resourceFolders');
  index(resources, 'project.resources');
  folders.forEach((folder, i) => {
    if (record(folder) && folder.parentId && !folderIds.has(folder.parentId)) report('warnings', 'missing-parent-folder', `project.resourceFolders[${i}].parentId`);
  });
  // Iterative traversal is bounded by the number of folders, even for deep archives.
  const visited = new Set();
  for (const id of folderIds.keys()) {
    const path = new Set(); let next = id;
    while (folderIds.has(next) && !visited.has(next)) {
      if (path.has(next)) { report('errors', 'folder-cycle', `project.resourceFolders:${next}`); break; }
      path.add(next); next = folderIds.get(next).parentId;
    }
    for (const entry of path) visited.add(entry);
  }
  resources.forEach((resource, i) => {
    if (record(resource) && resource.folderId && !folderIds.has(resource.folderId)) report('warnings', 'missing-resource-folder', `project.resources[${i}].folderId`);
  });
  const documentIds = new Set();
  documents.forEach((doc, i) => {
    const path = `documents[${i}]`;
    if (!record(doc)) { report('errors', 'invalid-document', path); return; }
    if (!identity(doc.id)) report('warnings', 'missing-historical-id', path + '.id');
    else if (documentIds.has(doc.id)) report('errors', 'duplicate-id', path + '.id');
    else documentIds.add(doc.id);
    if (doc.projectId == null || doc.projectId === '') report('info', 'historical-project-link-absent', path + '.projectId');
    else if (doc.projectId !== project.id) report('errors', 'wrong-project', path + '.projectId');
    const canvas = (value, at) => {
      if (!record(value) || !Array.isArray(value.elements) || !(Number.isFinite(value.width) && value.width > 0 && value.width <= 5000 && Number.isFinite(value.height) && value.height > 0 && value.height <= 5000)) {
        report('errors', 'invalid-canvas', at); return;
      }
      const elements = index(value.elements, at + '.elements');
      const groups = index(list(value, 'groups', at + '.groups'), at + '.groups');
      for (const [id, element] of elements) {
        if (element.groupId && !groups.has(element.groupId)) report('warnings', 'missing-layer-group', `${at}.elements:${id}.groupId`);
        if (element.clipBaseId && !elements.has(element.clipBaseId)) report('warnings', 'missing-clip-base', `${at}.elements:${id}.clipBaseId`);
        if (element.pathBoundary?.sourceId && !elements.has(element.pathBoundary.sourceId)) report('warnings', 'missing-boundary-source', `${at}.elements:${id}.pathBoundary.sourceId`);
      }
      for (const [id, group] of groups) if (group.parentId && !groups.has(group.parentId)) report('warnings', 'missing-group-parent', `${at}.groups:${id}.parentId`);
    };
    canvas(doc, path);
    if (doc.slides != null) {
      if (!Array.isArray(doc.slides) || !doc.slides.length) report('errors', 'invalid-slides', path + '.slides');
      else {
        index(doc.slides, path + '.slides');
        doc.slides.forEach((slide, j) => canvas(slide, `${path}.slides[${j}]`));
        if (!Number.isInteger(doc.activeSlideIndex) || doc.activeSlideIndex < 0 || doc.activeSlideIndex >= doc.slides.length) report('warnings', 'invalid-active-slide', path + '.activeSlideIndex');
      }
    }
  });
  return diagnostics;
}

export function prepareProjectImport(items, { generateId, now, existingProjectIds = [], existingDocumentIds = [], maxProjects = 500, maxDocuments = 5000 } = {}) {
  if (!Array.isArray(items) || items.length > maxProjects || items.reduce((n, item) => n + (Array.isArray(item?.documents) ? item.documents.length : 0), 0) > maxDocuments) throw new Error('Некорректный архив проектов: превышен лимит');
  if (typeof generateId !== 'function' || !Number.isFinite(now)) throw new TypeError('ID generator and time are required');
  const diagnostics = { errors: [], warnings: [], info: [] }, projectIds = new Set(), documentIds = new Set();
  items.forEach((item, i) => {
    const result = analyzeProject(item?.project, item?.documents);
    if (!Array.isArray(item?.documents)) result.errors.push({ code: 'invalid-documents', path: 'documents' });
    for (const level of Object.keys(diagnostics)) diagnostics[level].push(...result[level].map(message => ({ ...message, path: `projects[${i}].${message.path}` })));
    const check = (id, ids, path) => { if (identity(id)) { if (ids.has(id)) diagnostics.errors.push({ code: 'duplicate-id', path }); ids.add(id); } };
    check(item?.project?.id, projectIds, `projects[${i}].project.id`);
    for (const doc of (Array.isArray(item?.documents) ? item.documents : [])) check(doc?.id, documentIds, `projects[${i}].documents.id`);
  });
  if (diagnostics.errors.length) { const error = new Error('Повреждённый архив: ' + diagnostics.errors[0].code); error.diagnostics = diagnostics; throw error; }
  const reserved = new Set([...existingProjectIds, ...existingDocumentIds, ...projectIds, ...documentIds]);
  const fresh = () => {
    const id = generateId();
    if (!identity(id) || reserved.has(id)) throw new Error('Конфликт нового идентификатора');
    reserved.add(id); return id;
  };
  const projects = [], documents = [];
  for (const item of items) {
    const project = { ...copy(item.project), id: fresh(), name: String(item.project.name || 'Проект').slice(0, 90) + ' (импорт)', createdAt: now, updatedAt: now, exportCounters: {} };
    projects.push(project);
    for (const original of item.documents) documents.push({ ...copy(original), id: fresh(), projectId: project.id, createdAt: original.createdAt || now, updatedAt: now });
  }
  return { projects, documents, diagnostics };
}
