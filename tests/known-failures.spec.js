const {
  test, expect, openHome, importPayload, records,
} = require('./helpers');
const linked = require('./fixtures/linked-document.json');
const archive = require('./fixtures/project-with-folders.json');

test('KF-001: document import should preserve boundary and group references', async ({ page }, testInfo) => {
  await openHome(page);
  const source = linked.document;
  expect(source.elements.some(element => element.id === source.elements[1].pathBoundary.sourceId)).toBe(true);
  expect(source.elements.every(element => source.groups.some(group => group.id === element.groupId))).toBe(true);
  await importPayload(page, linked);
  let imported;
  await expect.poll(async () => {
    imported = (await records(page, 'docs')).find(document => document.title === source.title + ' (импорт)');
    return imported?.elements.length;
  }).toBe(2);
  const text = imported.elements.find(element => element.type === 'text');
  expect(text?.pathBoundary).toBeTruthy();
  const references = {
    boundarySourceExists: imported.elements.some(element => element.id === text.pathBoundary.sourceId),
    layerGroupsExist: imported.elements.every(element => imported.groups.some(group => group.id === element.groupId)),
  };
  await testInfo.attach('imported-reference-diagnostics', { body: JSON.stringify({ references, imported }, null, 2), contentType: 'application/json' });
  // Mark only the intended contract assertion as expected to fail: setup must succeed.
  test.fail(true, 'KF-001: importJSON remaps element/groupId but not sourceId/groups[].id; see docs/known-issues.md');
  expect(references).toEqual({ boundarySourceExists: true, layerGroupsExist: true });
});

test('KF-002: project import should preserve resource folders', async ({ page }, testInfo) => {
  await openHome(page);
  expect(archive.project.resourceFolders).toHaveLength(1);
  expect(archive.project.resources[0].folderId).toBe(archive.project.resourceFolders[0].id);
  await importPayload(page, archive);
  let imported;
  await expect.poll(async () => {
    imported = (await records(page, 'projects')).find(project => project.name === archive.project.name + ' (импорт)');
    return imported?.resources.length;
  }).toBe(1);
  expect(imported.resources[0].folderId).toBe('folder-original');
  await testInfo.attach('imported-folder-diagnostics', { body: JSON.stringify(imported, null, 2), contentType: 'application/json' });
  test.fail(true, 'KF-002: importProjectBackup omits resourceFolders; see docs/known-issues.md');
  expect(imported.resourceFolders).toEqual(archive.project.resourceFolders);
});
