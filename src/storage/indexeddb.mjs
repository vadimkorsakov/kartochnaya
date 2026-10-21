// A request result is provisional until its transaction commits. No application state lives here.
export function runStoreRequest(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    if (!db) {
      if (mode === 'readonly') resolve(null); // Historical read fallback only.
      else reject(new DOMException('IndexedDB is unavailable', 'InvalidStateError'));
      return;
    }
    let transaction, request, result, succeeded = false, settled = false, failure;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const abort = error => {
      // Keep the original callback/contract error even when abort itself throws.
      failure = error;
      try { transaction?.abort(); } catch { /* Already inactive or finished. */ }
      fail(error);
    };
    try {
      transaction = db.transaction(storeName, mode);
      transaction.oncomplete = () => {
        if (settled) return;
        if (!succeeded) { fail(failure || new TypeError('IDBRequest did not succeed')); return; }
        settled = true;
        resolve(result);
      };
      transaction.onerror = () => fail(failure || transaction.error || new DOMException('IndexedDB transaction failed', 'UnknownError'));
      transaction.onabort = () => fail(failure || transaction.error || new DOMException('IndexedDB transaction aborted', 'AbortError'));
      request = operation(transaction.objectStore(storeName));
      // Structural validation also works across realms and with small event doubles in unit tests.
      if (!request || typeof request.addEventListener !== 'function' || !('result' in request)
          || !('error' in request) || request.transaction !== transaction) {
        // Consume a rejected async callback, but never accept it as an IndexedDB operation.
        if (request instanceof Promise) request.catch(() => {});
        throw new TypeError('operation must synchronously return an IDBRequest from this transaction');
      }
      request.addEventListener('success', () => { result = request.result; succeeded = true; });
      request.addEventListener('error', () => {
        failure = request.error || new DOMException('IndexedDB request failed', 'UnknownError');
        fail(failure);
        // Do not preventDefault: the browser must still roll the transaction back.
      });
    } catch (error) { abort(error); }
  });
}

export function openDatabase({ indexedDB: factory, onBlocked, onVersionChange, onClose } = {}) {
  return new Promise((resolve, reject) => {
    let request, settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    try {
      if (factory === undefined) factory = globalThis.indexedDB;
      if (!factory) throw new DOMException('IndexedDB is unavailable', 'InvalidStateError');
      request = factory.open('kartochnaya_local_v1', 3);
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        } catch (error) {
          try { request.transaction?.abort(); } catch { /* Retain the upgrade error. */ }
          fail(error);
        }
      };
      request.onblocked = () => {
        const error = new DOMException('IndexedDB opening is blocked by another connection', 'InvalidStateError');
        fail(error);
        onBlocked?.(error);
      };
      request.onerror = () => fail(request.error || new DOMException('IndexedDB opening failed', 'UnknownError'));
      request.onsuccess = () => {
        const db = request.result;
        // An open request cannot be cancelled; close a late connection after a blocked/error fallback.
        if (settled) { db.close(); return; }
        db.onversionchange = event => { db.close(); onVersionChange?.(event); };
        db.onclose = event => onClose?.(event);
        settled = true;
        resolve(db);
      };
    } catch (error) { fail(error); }
  });
}

// The callback queues requests synchronously and returns undefined. Request handlers
// may queue dependent requests while the same transaction is still active.
export function runStoreTransaction(db, storeNames, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction, failure, settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    const abort = error => { failure ||= error; try { transaction?.abort(); } catch {} fail(failure); };
    try {
      if (!db) throw new DOMException('IndexedDB is unavailable', 'InvalidStateError');
      if (!Array.isArray(storeNames) || !storeNames.length || storeNames.some(name => typeof name !== 'string') || new Set(storeNames).size !== storeNames.length) throw new TypeError('Expected distinct store names');
      if (typeof operation !== 'function' || operation.constructor?.name === 'AsyncFunction') throw new TypeError('operation must be synchronous');
      transaction = db.transaction(storeNames, mode);
      transaction.oncomplete = () => { if (!settled) { settled = true; resolve(); } };
      transaction.onerror = event => {
        failure ||= event.target?.error || transaction.error || new DOMException('IndexedDB transaction failed', 'UnknownError');
        // Never preventDefault: request errors must roll back all stores.
        fail(failure);
      };
      transaction.onabort = () => fail(failure || transaction.error || new DOMException('IndexedDB transaction aborted', 'AbortError'));
      const result = operation(name => {
        if (!storeNames.includes(name)) throw new DOMException('Store outside transaction scope', 'NotFoundError');
        return transaction.objectStore(name);
      });
      if (result !== undefined) {
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        throw new TypeError('operation must synchronously queue requests and return undefined');
      }
    } catch (error) { abort(error); }
  });
}
