const {
  test,
  expect,
  openHome,
  createDocument,
  createText,
  addShape,
  exportedDocument,
  records,
  openLibraryDocument,
  importPayload,
  canvasPoint,
} = require("./helpers");

async function observe(page) {
  await page.addInitScript(() => {
    window.saveAudit = {
      transactions: [],
      operations: [],
      commits: [],
      aborts: [],
      hold: false,
      fail: false,
      releases: [],
    };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      const tx = transaction.call(this, stores, mode, ...rest);
      if (mode === "readwrite") {
        const entry = { stores: [...tx.objectStoreNames] };
        saveAudit.transactions.push(entry);
        tx.addEventListener("complete", () => saveAudit.commits.push(entry));
        tx.addEventListener("abort", () => saveAudit.aborts.push(entry));
      }
      return tx;
    };
    for (const method of ["put", "add", "delete"]) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        const r = original.apply(this, args),
          store = this,
          tx = this.transaction;
        saveAudit.operations.push({
          store: this.name,
          method,
          value: structuredClone(args[0]),
        });
        if (this.name === "docs" && method === "put")
          r.addEventListener("success", () => {
            if (saveAudit.fail) {
              tx.abort();
              return;
            }
            if (saveAudit.hold) {
              let released = false;
              saveAudit.releases.push(() => (released = true));
              const pump = () => {
                if (!released)
                  store.get(args[0].id).addEventListener("success", pump);
              };
              pump();
            }
          });
        return r;
      };
    }
  });
}
async function audit(page) {
  return page.evaluate(() => ({
    transactions: saveAudit.transactions,
    operations: saveAudit.operations,
    commits: saveAudit.commits,
    aborts: saveAudit.aborts,
  }));
}
async function quiet(page) {
  await page.waitForTimeout(650);
}
async function saved(page) {
  await expect(page.locator("#saveStatus")).toHaveText(
    "Сохранено на этом устройстве",
  );
}
async function reset(page) {
  await page.evaluate(() => {
    saveAudit.transactions = [];
    saveAudit.operations = [];
    saveAudit.commits = [];
    saveAudit.aborts = [];
  });
}
async function release(page) {
  await page.evaluate(() => {
    saveAudit.hold = false;
    saveAudit.releases.splice(0).forEach((f) => f());
  });
}
async function home(page) {
  await page.locator("#documentTabsHome").click();
}
function docWrites(a) {
  return a.transactions.filter((t) => t.stores.includes("docs")).length;
}

test("F05 passive reload, opening, home, closing and reopening perform zero document writes", async ({
  page,
}, info) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 passive");
  await saved(page);
  const before = await exportedDocument(page);
  await page.reload();
  await expect(page.locator("#homeScreen")).toBeVisible();
  await quiet(page);
  const startup = await audit(page);
  await openLibraryDocument(page, before.id);
  await quiet(page);
  await home(page);
  await openLibraryDocument(page, before.id);
  await quiet(page);
  await page
    .locator(`[data-tab-id="${before.id}"] .document-tab-close`)
    .click();
  await openLibraryDocument(page, before.id);
  await quiet(page);
  const after = await records(page, "docs");
  const observed = await audit(page);
  await info.attach("writes", {
    body: JSON.stringify({ startup, observed, before, after }),
    contentType: "application/json",
  });
  expect(after.find((d) => d.id === before.id)).toEqual(before);
  expect(docWrites(startup)).toBe(0);
  expect(docWrites(observed)).toBe(0);
  await saved(page);
});

test("F05 two and three clean tabs, focus, zoom and home remain read only", async ({
  page,
}, info) => {
  await observe(page);
  await openHome(page);
  const docs = [];
  for (let i = 0; i < 3; i++) {
    await createDocument(page, "F05 tab " + i);
    await saved(page);
    docs.push(await exportedDocument(page));
    await home(page);
  }
  const before = await records(page, "docs");
  await reset(page);
  for (const index of [0, 1, 0, 1, 2, 0, 2, 1])
    await page.locator(`[data-tab-id="${docs[index].id}"]`).click();
  await page.locator("#fitBtn").click();
  await home(page);
  await quiet(page);
  const observed = await audit(page);
  await info.attach("writes", {
    body: JSON.stringify(observed),
    contentType: "application/json",
  });
  expect(await records(page, "docs")).toEqual(before);
  expect(docWrites(observed)).toBe(0);
});

test("F05 active slide click is read only; real navigation persists active root and keeps history", async ({
  page,
}, info) => {
  await observe(page);
  await openHome(page);
  await importPayload(page, {
    format: "kartochnaya-v1",
    document: {
      id: "series",
      title: "F05 series",
      type: "card",
      hasCustomName: true,
      width: 320,
      height: 240,
      background: "#ffffff",
      elements: [],
      groups: [],
      activeSlideIndex: 0,
      slides: [0, 1].map((i) => ({
        id: "slide" + i,
        width: 320 + i * 20,
        height: 240,
        background: i ? "#ff0000" : "#ffffff",
        elements: [],
        groups: [],
      })),
    },
  });
  let imported;
  await expect
    .poll(async () => {
      imported = (await records(page, "docs")).find(
        (d) => d.title === "F05 series (импорт)",
      );
      return !!imported;
    })
    .toBe(true);
  await page.locator('[data-filter="card"]').click();
  await openLibraryDocument(page, imported.id);
  await saved(page);
  const before = await exportedDocument(page);
  await reset(page);
  await page.locator('#seriesSidebarList [data-side-slide="0"]').click();
  await quiet(page);
  const same = await audit(page);
  await page.locator('#seriesSidebarList [data-side-slide="1"]').click();
  await saved(page);
  await quiet(page);
  const after = await exportedDocument(page),
    observed = await audit(page);
  await info.attach("writes", {
    body: JSON.stringify({ same, observed, before, after }),
    contentType: "application/json",
  });
  expect(docWrites(same)).toBe(0);
  expect(docWrites(observed)).toBe(1);
  expect(after.activeSlideIndex).toBe(1);
  expect(after.width).toBe(340);
  expect(after.slides).toEqual(before.slides);
  expect((await records(page, "docs")).find((d) => d.id === after.id)).toEqual(
    after,
  );
  await page.reload();
  await expect(page.locator("#homeScreen")).toBeVisible();
  await page.locator('[data-filter="card"]').click();
  await openLibraryDocument(page, after.id);
  expect((await exportedDocument(page)).activeSlideIndex).toBe(1);
});

test("F05 a new unsaved document and two rapid text edits persist the latest version once", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await reset(page);
  await createDocument(page, "F05 new");
  await saved(page);
  const doc = await exportedDocument(page);
  expect(docWrites(await audit(page))).toBe(1);
  expect((await records(page, "docs")).find((d) => d.id === doc.id)).toEqual(
    doc,
  );
  await createText(page, "first");
  await saved(page);
  await reset(page);
  await page.locator("#dockSelect").click();
  const point = await canvasPoint(page, 65, 60);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator("#inlineText")).toBeVisible();
  await page.locator("#inlineText").fill("second");
  await page.locator("#inlineText").fill("latest");
  await page.locator("#inlineText").press("ControlOrMeta+Enter");
  await saved(page);
  const after = await exportedDocument(page);
  expect(after.elements[0].text).toBe("latest");
  expect(docWrites(await audit(page))).toBe(1);
  await page.reload();
  await openLibraryDocument(page, doc.id);
  expect((await exportedDocument(page)).elements[0].text).toBe("latest");
});

test("F05 A → B → C under held transaction never confirms an obsolete edit", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 race");
  await saved(page);
  await reset(page);
  await page.evaluate(() => (saveAudit.hold = true));
  await addShape(page);
  await expect
    .poll(() => page.evaluate(() => saveAudit.releases.length))
    .toBe(1);
  await addShape(page);
  await quiet(page);
  await addShape(page);
  await quiet(page);
  await expect(page.locator("#saveStatus")).toHaveText("Сохраняем…");
  expect((await audit(page)).commits).toHaveLength(0);
  await release(page);
  await saved(page);
  const doc = await exportedDocument(page);
  expect(doc.elements).toHaveLength(3);
  expect((await records(page, "docs")).find((d) => d.id === doc.id)).toEqual(
    doc,
  );
  await page.reload();
  await openLibraryDocument(page, doc.id);
  expect((await exportedDocument(page)).elements).toEqual(doc.elements);
});

test("F05 failed X survives tab switches and failed close; explicit retry confirms the same memory", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 X");
  await saved(page);
  const x = await exportedDocument(page);
  await home(page);
  await createDocument(page, "F05 Y");
  await saved(page);
  const y = await exportedDocument(page);
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  await page.evaluate(() => (saveAudit.fail = true));
  await addShape(page);
  await expect(page.locator("#saveStatus")).toContainText("Ошибка сохранения");
  await page.locator(`[data-tab-id="${y.id}"]`).click();
  await saved(page);
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  await expect(page.locator("#saveStatus")).toContainText("Ошибка сохранения");
  await page.locator(`[data-tab-id="${x.id}"] .document-tab-close`).click();
  await quiet(page);
  await expect(page.locator(`[data-tab-id="${x.id}"]`)).toBeVisible();
  expect((await records(page, "docs")).find((d) => d.id === x.id)).toEqual(x);
  await page.evaluate(() => (saveAudit.fail = false));
  await page.locator("#brandHomeBtn").click();
  await expect(page.locator("#homeScreen")).toBeVisible();
  expect(
    (await records(page, "docs")).find((d) => d.id === x.id).elements,
  ).toHaveLength(1);
  await page.reload();
  await openLibraryDocument(page, x.id);
  expect((await exportedDocument(page)).elements).toHaveLength(1);
});

test("F05 legacy display preparation never rewrites raw stored document", async ({
  page,
}, info) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 legacy");
  await saved(page);
  const initial = await exportedDocument(page);
  // Simulate an old v3 record, before this application session loads it.
  const legacy = {
    ...initial,
    type: "card",
    hasCustomName: true,
    groups: undefined,
    backgroundAlpha: undefined,
    slides: undefined,
    activeSlideIndex: undefined,
  };
  await page.evaluate(async (record) => {
    const r = indexedDB.open("kartochnaya_local_v1");
    const db = await new Promise(
      (resolve) => (r.onsuccess = () => resolve(r.result)),
    );
    await new Promise((resolve, reject) => {
      const tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").put(record);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, legacy);
  await page.reload();
  await expect(page.locator("#homeScreen")).toBeVisible();
  await quiet(page);
  await page.locator('[data-filter="card"]').click();
  await openLibraryDocument(page, initial.id);
  await quiet(page);
  await saved(page);
  await home(page);
  await quiet(page);
  const after = (await records(page, "docs")).find((d) => d.id === initial.id),
    observed = await audit(page);
  await info.attach("legacy", {
    body: JSON.stringify({ legacy, after, observed }),
    contentType: "application/json",
  });
  expect(after).toEqual(legacy);
  expect(docWrites(observed)).toBe(0);
});

test("F05 inline text finalization and debounce belong to the outgoing tab", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 text X");
  await createText(page, "before");
  await saved(page);
  const x = await exportedDocument(page);
  await home(page);
  await createDocument(page, "F05 text Y");
  await saved(page);
  const y = await exportedDocument(page);
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  await page.locator("#dockSelect").click();
  const point = await canvasPoint(page, 65, 60);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator("#inlineText")).toBeFocused();
  await page.locator("#inlineText").fill("final outgoing text");
  await expect(page.locator("#inlineText")).toHaveValue("final outgoing text");
  await page.locator(`[data-tab-id="${y.id}"]`).click();
  await quiet(page);
  await saved(page);
  expect((await records(page, "docs")).find((d) => d.id === y.id)).toEqual(y);
  expect(
    (await records(page, "docs")).find((d) => d.id === x.id).elements[0].text,
  ).toBe("final outgoing text");
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  expect((await exportedDocument(page)).elements[0].text).toBe(
    "final outgoing text",
  );
});

test("F05 unchanged text finalization preserves timestamp and performs no write", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 unchanged text");
  await createText(page, "unchanged");
  await saved(page);
  const before = await exportedDocument(page);
  await reset(page);
  await page.locator("#dockSelect").click();
  const point = await canvasPoint(page, 65, 60);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator("#inlineText")).toBeVisible();
  await page.locator("#inlineText").press("ControlOrMeta+Enter");
  await quiet(page);
  expect(await exportedDocument(page)).toEqual(before);
  expect(docWrites(await audit(page))).toBe(0);
  expect((await records(page, "docs")).find((d) => d.id === before.id)).toEqual(
    before,
  );
});

test("F05 live text changes cannot display saved and reverting restores confirmed status", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 indicator");
  await createText(page, "confirmed");
  await saved(page);
  const before = await exportedDocument(page);
  await reset(page);
  await page.locator("#dockSelect").click();
  const point = await canvasPoint(page, 65, 60);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator("#inlineText")).toBeFocused();
  await page.locator("#inlineText").fill("not confirmed");
  await expect(page.locator("#saveStatus")).toHaveText("Сохраняем…");
  expect((await records(page, "docs")).find((d) => d.id === before.id)).toEqual(
    before,
  );
  await page.locator("#inlineText").fill("confirmed");
  await saved(page);
  await quiet(page);
  expect(docWrites(await audit(page))).toBe(0);
});

test("F05 rejected startup sample is never exposed as a confirmed library record", async ({
  page,
}) => {
  await observe(page);
  await page.addInitScript(() => (saveAudit.fail = true));
  await openHome(page);
  await quiet(page);
  expect(await records(page, "docs")).toEqual([]);
  await expect(page.locator("#projectGrid [data-docid]")).toHaveCount(0);
});

test("F05 confirmed ZIP snapshot does not rewrite clean documents", async ({
  page,
}, info) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 ZIP");
  await createText(page, "ZIP confirmed");
  await saved(page);
  const before = await records(page, "docs");
  await reset(page);
  await home(page);
  await page.locator('[data-home-nav="data"]').click();
  await page.locator("#zipStorage").click();
  await expect(page.locator("#zipConfirm")).toBeEnabled();
  const pending = page.waitForEvent("download");
  await page.locator("#zipConfirm").click();
  const download = await pending;
  const { readFile } = require("node:fs/promises");
  const { readBackup } = await import("../src/backup/archive.mjs");
  const backup = await readBackup(await readFile(await download.path()));
  expect(backup.data.docs).toEqual(before);
  expect(await records(page, "docs")).toEqual(before);
  const observed = await audit(page);
  await info.attach("zip-writes", {
    body: JSON.stringify(observed),
    contentType: "application/json",
  });
  expect(docWrites(observed)).toBe(0);
});

test("F05 A → A held flushes share one real transaction", async ({ page }) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 identical pending");
  await saved(page);
  await reset(page);
  await page.evaluate(() => (saveAudit.hold = true));
  await addShape(page);
  await expect
    .poll(() => page.evaluate(() => saveAudit.releases.length))
    .toBe(1);
  await page.locator("#brandHomeBtn").click();
  await page.locator("#brandHomeBtn").click();
  expect(docWrites(await audit(page))).toBe(1);
  expect((await audit(page)).commits).toHaveLength(0);
  await expect(page.locator("#saveStatus")).toHaveText("Сохраняем…");
  await release(page);
  await expect(page.locator("#homeScreen")).toBeVisible();
  const docs = await records(page, "docs");
  expect(
    docs.find((d) => d.title === "F05 identical pending").elements,
  ).toHaveLength(1);
  await quiet(page);
  expect(docWrites(await audit(page))).toBe(1);
});

test("F05 renaming a dormant tab waits behind its pending content snapshots", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 rename X");
  await saved(page);
  const x = await exportedDocument(page);
  await home(page);
  await createDocument(page, "F05 rename Y");
  await saved(page);
  const y = await exportedDocument(page);
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  await page.evaluate(() => (saveAudit.hold = true));
  await addShape(page);
  await expect
    .poll(() => page.evaluate(() => saveAudit.releases.length))
    .toBe(1);
  await addShape(page);
  await quiet(page);
  await page.locator(`[data-tab-id="${y.id}"]`).click();
  await home(page);
  await page.locator(`[data-docid="${x.id}"] .project-title`).dblclick();
  await page.locator(".project-title-edit").fill("F05 renamed");
  await page.locator(".project-title-edit").press("Enter");
  await release(page);
  await quiet(page);
  await expect
    .poll(
      async () =>
        (await records(page, "docs")).find((d) => d.id === x.id)?.title,
    )
    .toBe("F05 renamed");
  expect(
    (await records(page, "docs")).find((d) => d.id === x.id).elements,
  ).toHaveLength(2);
  await page.locator(`[data-tab-id="${x.id}"]`).click();
  await saved(page);
  const latest = await exportedDocument(page);
  expect(latest.title).toBe("F05 renamed");
  expect(latest.elements).toHaveLength(2);
  await page.reload();
  await openLibraryDocument(page, x.id);
  expect((await exportedDocument(page)).elements).toEqual(latest.elements);
  expect((await exportedDocument(page)).title).toBe("F05 renamed");
});

test("F05 workspace preparation waits for an actual new editor snapshot after preview", async ({
  page,
}) => {
  await observe(page);
  await openHome(page);
  await createDocument(page, "F05 replacement pending");
  await addShape(page);
  await saved(page);
  const original = await exportedDocument(page),
    projects = await records(page, "projects");
  const { createBackup } = await import("../src/backup/archive.mjs");
  const incoming = await createBackup({
    projects: [{ ...projects[0], id: "restored-f05" }],
    docs: [{ ...original, id: "restored-f05-doc", projectId: "restored-f05" }],
    fonts: [],
    settings: [],
  });
  await home(page);
  await page
    .locator("#zipInput")
    .setInputFiles({
      name: "pending-replace.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(incoming.bytes),
    });
  await expect(page.locator("#zipConfirm")).toBeEnabled();
  await page.locator("[name=zipRestoreMode][value=replace]").check();
  await expect(page.locator("#zipComparison")).toContainText("Текущие данные");
  await expect(page.locator("#zipReplacePrepare")).toBeEnabled();
  await expect(page.locator("#zipBackupDialog")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.evaluate(() => (saveAudit.hold = true));
  // A real UI edit arriving after preview must be drained before sealing replacement.
  await page
    .locator("#layers [data-layeract=visibility]")
    .first()
    .evaluate((button) => button.click());
  await page.locator("#zipReplacePrepare").click();
  await expect
    .poll(() => page.evaluate(() => saveAudit.releases.length))
    .toBeGreaterThan(0);
  await expect(page.locator("#zipConfirm")).toBeDisabled();
  await release(page);
  await expect(page.locator("#zipConfirm")).toBeEnabled();
  expect(
    (await records(page, "docs")).find((d) => d.id === original.id).elements[0]
      .visible,
  ).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#zipConfirm").click(),
  ]);
  await expect(page.locator("#homeScreen")).toBeVisible();
  await quiet(page);
  expect((await records(page, "docs")).map((d) => d.id)).toEqual([
    "restored-f05-doc",
  ]);
  await page.reload();
  await expect(page.locator("#homeScreen")).toBeVisible();
  await quiet(page);
  expect((await records(page, "docs")).map((d) => d.id)).toEqual([
    "restored-f05-doc",
  ]);
});
