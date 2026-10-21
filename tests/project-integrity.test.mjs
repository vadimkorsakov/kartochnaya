import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, prepareProjectImport } from '../src/model/project-integrity.mjs';
const project = () => ({ id: 'p', name: 'Synthetic', resources: [], resourceFolders: [] });
const doc = id => ({ id, projectId: 'p', elements: [], width: 320, height: 240 });
const codes = (result, level = 'errors') => result[level].map(d => d.code);
const plan = (items, options = {}) => { let n = 0; return prepareProjectImport(items, { generateId: () => `new-${++n}`, now: 123, ...options }); };
const item = (p = project(), documents = []) => ({ project: p, documents });
for (const count of [0, 1, 3]) test(`valid project with ${count} documents`, () => assert.deepEqual(analyzeProject(project(), Array.from({ length: count }, (_, i) => doc('d' + i))).errors, []));
for (const depth of [0, 1, 4, 10000]) test(`resource tree depth ${depth}`, () => {
  const p = project(); for (let i = 0; i < depth; i++) p.resourceFolders.push({ id: `f${i}`, parentId: i ? `f${i - 1}` : null });
  p.resources.push({ id: 'r', folderId: depth ? `f${depth - 1}` : null, src: 'data:image/png;base64,synthetic' });
  const result = analyzeProject(p); assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
});
for (const [name, mutate, level, code] of [
  ['missing parent', p => p.resourceFolders.push({ id: 'a', parentId: 'missing' }), 'warnings', 'missing-parent-folder'],
  ['missing folder', p => p.resources.push({ id: 'r', folderId: 'missing' }), 'warnings', 'missing-resource-folder'],
  ['cycle', p => p.resourceFolders.push({ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }), 'errors', 'folder-cycle'],
  ['self-cycle', p => p.resourceFolders.push({ id: 'a', parentId: 'a' }), 'errors', 'folder-cycle'],
  ['duplicate folder', p => p.resourceFolders.push({ id: 'a' }, { id: 'a' }), 'errors', 'duplicate-id'],
  ['duplicate resource', p => p.resources.push({ id: 'a' }, { id: 'a' }), 'errors', 'duplicate-id'],
  ['malformed folder', p => p.resourceFolders.push(null), 'errors', 'invalid-id'],
  ['malformed resources', p => p.resources = {}, 'errors', 'invalid-list'],
]) test(name, () => { const p = project(); mutate(p); assert.ok(codes(analyzeProject(p), level).includes(code)); });
test('wrong project link is critical', () => assert.ok(codes(analyzeProject(project(), [{ ...doc('d'), projectId: 'other' }])).includes('wrong-project')));
test('historical metadata is optional', () => { const p = project(); delete p.resourceFolders; delete p.resources; const d = doc('d'); delete d.projectId; assert.deepEqual(analyzeProject(p, [d]).errors, []); assert.deepEqual(plan([item(p, [d])]).projects[0].resources, undefined); });
test('internal layer, group, mask, boundary and slide identities survive with independent deep copies', () => {
  const p = project(); p.cover = 'data:cover'; p.extra = { unknown: ['preserved'] }; p.resourceFolders = [{ id: 'folder', parentId: null }]; p.resources = [{ id: 'r', folderId: 'folder', src: 'data:image' }];
  const d = doc('d'); d.groups = [{ id: 'g', parentId: null }]; d.elements = [{ id: 'e', groupId: 'g', clipped: true, clipBaseId: 'e', layerMaskSrc: 'data:image/png;mask', pathBoundary: { sourceId: 'e' } }];
  d.slides = [{ id: 's', width: 320, height: 240, elements: structuredClone(d.elements), groups: structuredClone(d.groups) }, { id: 's2', width: 300, height: 200, elements: [], groups: [] }]; d.activeSlideIndex = 0;
  const input = [item(p, [d])], before = structuredClone(input), result = plan(input);
  assert.deepEqual(input, before); assert.equal(result.projects[0].id, 'new-1'); assert.equal(result.documents[0].id, 'new-2'); assert.equal(result.documents[0].projectId, 'new-1');
  for (const field of ['elements', 'groups', 'slides', 'activeSlideIndex']) assert.deepEqual(result.documents[0][field], d[field]);
  for (const field of ['resourceFolders', 'resources', 'cover', 'extra']) assert.deepEqual(result.projects[0][field], p[field]);
  result.projects[0].extra.unknown.push('new'); result.documents[0].slides[0].elements[0].id = 'different'; assert.deepEqual(input, before);
});
test('workspace links use the new owning project; local IDs may repeat across documents', () => {
  const a = doc('a'), b = { ...doc('b'), projectId: 'q' }; a.elements = b.elements = [{ id: 'local' }];
  const result = plan([item(project(), [a]), item({ ...project(), id: 'q' }, [b])]);
  assert.deepEqual(result.documents.map(d => d.projectId), result.projects.map(p => p.id));
});
test('diagnostics are stable and do not repair dangling folders', () => { const p = project(); p.resources.push({ id: 'r', folderId: 'missing' }); const before = structuredClone(p); assert.deepEqual(analyzeProject(p), analyzeProject(p)); assert.equal(plan([item(p)]).projects[0].resources[0].folderId, 'missing'); assert.deepEqual(p, before); });
for (const [name, items] of [
  ['duplicate project IDs', [item(), item()]],
  ['duplicate document IDs across projects', [item(project(), [doc('d')]), item({ ...project(), id: 'q' }, [{ ...doc('d'), projectId: 'q' }])]],
  ['non-array docs', [item(project(), {})]], ['missing project', [{}]],
  ['bad dimensions', [item(project(), [{ ...doc('d'), width: 5001 }])]],
  ['bad slide', [item(project(), [{ ...doc('d'), slides: [null] }])]],
  ['duplicate local ID', [item(project(), [{ ...doc('d'), elements: [{ id: 'e' }, { id: 'e' }] }])]],
]) test(name + ' rejects before plan', () => assert.throws(() => plan(items)));
for (const id of ['p', 'd', 'existing', '', null]) test(`generator rejects collision/invalid ${id}`, () => assert.throws(() => plan([item(project(), [doc('d')])], { generateId: () => id, existingProjectIds: ['existing'] })));
test('generator cannot reuse generated IDs', () => assert.throws(() => plan([item(project(), [doc('d')])], { generateId: () => 'same' })));
test('project and document count limits', () => { assert.throws(() => plan([item(), item()], { maxProjects: 1 })); assert.throws(() => plan([item(project(), [doc('a'), doc('b')])], { maxDocuments: 1 })); });
test('invalid canvas numbers reject', () => { for (const width of [NaN, Infinity, 0, -1, '320']) assert.throws(() => plan([item(project(), [{ ...doc('d'), width }])])); });
