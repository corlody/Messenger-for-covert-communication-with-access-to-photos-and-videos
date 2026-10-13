// js/storage.js
// Простая обёртка над IndexedDB с промисами.

const DB_NAME = 'hana_koto_v3';
const DB_VERSION = 1;

const STORES = {
    identity: { keyPath: 'id' },              // одна запись id='self'
    contacts: { keyPath: 'id', autoIncrement: true, indexes: ['userId'] },
    messages: { keyPath: 'id', autoIncrement: true, indexes: ['withUser', 'timestamp'] },
    keys:     { keyPath: 'convId' }           // кэш ключей беседы
};

let _dbPromise = null;

function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            for (const name in STORES) {
                if (db.objectStoreNames.contains(name)) continue;
                const cfg = STORES[name];
                const store = db.createObjectStore(name, {
                    keyPath: cfg.keyPath,
                    autoIncrement: cfg.autoIncrement || false
                });
                (cfg.indexes || []).forEach(idx => {
                    store.createIndex(idx, idx, { unique: false });
                });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
    return _dbPromise;
}

function tx(storeName, mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const result = fn(store);
        t.oncomplete = () => resolve(result && result._val);
        t.onerror    = () => reject(t.error);
        t.onabort    = () => reject(t.error);
    }));
}

// ---------- Базовые операции ----------
export async function get(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror   = () => reject(r.error);
    });
}

export async function put(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
        r.onsuccess = () => resolve(r.result);
        r.onerror   = () => reject(r.error);
    });
}

export async function add(storeName, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readwrite').objectStore(storeName).add(value);
        r.onsuccess = () => resolve(r.result);
        r.onerror   = () => reject(r.error);
    });
}

export async function del(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
        r.onsuccess = () => resolve();
        r.onerror   = () => reject(r.error);
    });
}

export async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror   = () => reject(r.error);
    });
}

export async function clear(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const r = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
        r.onsuccess = () => resolve();
        r.onerror   = () => reject(r.error);
    });
}

// ---------- Специализированные помощники ----------

// --- Контакты ---
export async function addContact(contact) {
    // contact = { userId, name, publicRaw (Uint8Array), sharedPassword, addedAt }
    const rec = {
        ...contact,
        publicRaw: contact.publicRaw ? Array.from(contact.publicRaw) : null
    };
    return add('contacts', rec);
}

export async function getContacts() {
    const list = await getAll('contacts');
    return list.map(c => ({
        ...c,
        publicRaw: c.publicRaw ? new Uint8Array(c.publicRaw) : null
    }));
}

export async function getContactByUserId(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const store = db.transaction('contacts', 'readonly').objectStore('contacts');
        const idx = store.index('userId');
        const r = idx.get(userId);
        r.onsuccess = () => {
            const c = r.result;
            if (!c) return resolve(null);
            resolve({
                ...c,
                publicRaw: c.publicRaw ? new Uint8Array(c.publicRaw) : null
            });
        };
        r.onerror = () => reject(r.error);
    });
}

export async function updateContact(id, patch) {
    const existing = await get('contacts', id);
    if (!existing) return;
    const merged = { ...existing, ...patch };
    if (patch.publicRaw && patch.publicRaw instanceof Uint8Array) {
        merged.publicRaw = Array.from(patch.publicRaw);
    }
    return put('contacts', merged);
}

export async function deleteContact(id) {
    return del('contacts', id);
}

// --- Сообщения ---
// message = { withUser, direction:'in'|'out', kind:'text'|'photo'|'file',
//             text?, blob?, fileName?, mimeType?, ts, delivered?, read? }
export async function addMessage(msg) {
    const rec = { ...msg, ts: msg.ts || Date.now() };
    // Blob в IndexedDB кладётся как есть — это работает.
    return add('messages', rec);
}

export async function getMessagesWith(userId, limit = 500) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const store = db.transaction('messages', 'readonly').objectStore('messages');
        const idx = store.index('withUser');
        const r = idx.getAll(IDBKeyRange.only(userId));
        r.onsuccess = () => {
            let arr = r.result || [];
            arr.sort((a, b) => a.ts - b.ts);
            if (arr.length > limit) arr = arr.slice(arr.length - limit);
            resolve(arr);
        };
        r.onerror = () => reject(r.error);
    });
}

export async function getLastMessageWith(userId) {
    const arr = await getMessagesWith(userId, 1);
    return arr.length ? arr[arr.length - 1] : null;
}

export async function deleteMessage(id) {
    return del('messages', id);
}

export async function deleteMessagesWith(userId) {
    const arr = await getMessagesWith(userId, 10000);
    for (const m of arr) await del('messages', m.id);
}

// --- Кэш ключей беседы ---
export async function cacheConvKey(convId, rawKey) {
    return put('keys', {
        convId,
        rawB64: btoa(String.fromCharCode(...rawKey)),
        cachedAt: Date.now()
    });
}

export async function getCachedConvKey(convId) {
    const rec = await get('keys', convId);
    if (!rec) return null;
    const bin = atob(rec.rawB64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
}

export async function clearConvKeyCache() {
    return clear('keys');
}

// --- Полная очистка (для «стереть всё») ---
export async function wipeAll() {
    await clear('messages');
    await clear('contacts');
    await clear('keys');
    // identity не трогаем — она привязана к мастер-паролю
}