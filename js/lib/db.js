// Persistência local (IndexedDB do browser, neste dispositivo). Nada sai do telemóvel.

const DB_NAME = 'faturas-db';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('invoices')) db.createObjectStore('invoices', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transação cancelada'));
  }));
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async listInvoices() {
    return tx(['invoices'], 'readonly', t => reqP(t.objectStore('invoices').getAll()));
  },
  async getInvoice(id) {
    return tx(['invoices'], 'readonly', t => reqP(t.objectStore('invoices').get(id)));
  },
  /** Grava o registo e (opcionalmente) a imagem original, numa única transação. */
  async saveInvoice(rec, imageBlob = null) {
    return tx(['invoices', 'images'], 'readwrite', t => {
      if (imageBlob) t.objectStore('images').put({ id: rec.imageId, blob: imageBlob, type: imageBlob.type });
      t.objectStore('invoices').put(rec);
      return rec;
    });
  },
  async deleteInvoice(id) {
    const rec = await this.getInvoice(id);
    return tx(['invoices', 'images'], 'readwrite', t => {
      t.objectStore('invoices').delete(id);
      if (rec?.imageId) t.objectStore('images').delete(rec.imageId);
    });
  },
  async getImage(id) {
    return tx(['images'], 'readonly', t => reqP(t.objectStore('images').get(id)));
  },
  async clearAll() {
    return tx(['invoices', 'images'], 'readwrite', t => { t.objectStore('invoices').clear(); t.objectStore('images').clear(); });
  },
};

/** Pede ao browser armazenamento persistente (evita limpeza automática quando possível). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignorar */ }
  return false;
}

export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}
