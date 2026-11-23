import { isBuiltinListMarker, validateListMarker } from '../model/list-presets.mjs';
import { runStoreRequest, runStoreTransaction } from './indexeddb.mjs';

export const listMarkerLibraryKey = 'list-markers-v1';
export const listMarkerLibraryLimit = 100;

const isPersonalMarker = marker => validateListMarker(marker) && !isBuiltinListMarker(marker);

function readMarkers(record) {
  const markers = new Set();
  if (Array.isArray(record?.markers)) {
    for (const marker of record.markers) {
      if (isPersonalMarker(marker)) markers.add(marker);
      if (markers.size === listMarkerLibraryLimit) break;
    }
  }
  return [...markers];
}

export async function loadListMarkers(db) {
  if (!db) throw new DOMException('IndexedDB is unavailable', 'InvalidStateError');
  return readMarkers(await runStoreRequest(db, 'settings', 'readonly', store => store.get(listMarkerLibraryKey)));
}

export async function updateListMarkers(db, action, marker) {
  if (!isPersonalMarker(marker) || !['add', 'remove'].includes(action)) {
    throw new TypeError('Invalid personal list marker operation');
  }
  let markers, status;
  await runStoreTransaction(db, ['settings'], 'readwrite', getStore => {
    const store = getStore('settings');
    const request = store.get(listMarkerLibraryKey);
    // Read and write under one transaction, including when two tabs edit the library.
    request.onsuccess = () => {
      markers = readMarkers(request.result);
      const index = markers.indexOf(marker);
      if (action === 'add') {
        if (index !== -1) { status = 'duplicate'; return; }
        if (markers.length === listMarkerLibraryLimit) { status = 'full'; return; }
        markers.push(marker);
        status = 'added';
      } else {
        if (index === -1) { status = 'missing'; return; }
        markers.splice(index, 1);
        status = 'removed';
      }
      store.put({key:listMarkerLibraryKey, markers});
    };
  });
  return {markers, status};
}
