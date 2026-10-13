// js/identity.js
import { CONFIG } from './config.js';
import * as C from './crypto.js';
import * as DB from './storage.js';

const STORE = 'identity';
const REC_ID = 'self';

/**
 * Загружает или создаёт личность.
 * @param {string} masterPassword
 * @returns {Promise<{id:string, privateKey:CryptoKey, publicRaw:Uint8Array, isNew:boolean}>}
 */
export async function loadOrCreateIdentity(masterPassword) {
    const rec = await DB.get(STORE, REC_ID);

    if (!rec) {
        return await createIdentity(masterPassword);
    }

    // Расшифровываем приватный ключ мастер-паролем
    const salt   = C.fromB64(rec.privSalt);
    const nonce  = C.fromB64(rec.privNonce);
    const ct     = C.fromB64(rec.privCt);
    const wrapKey = await C.pbkdf2(masterPassword, salt, CONFIG.PBKDF2_ITER, 32);

    let privPkcs8;
    try {
        privPkcs8 = await C.aesDecrypt(wrapKey, nonce, ct, C.utf8('hk-priv-v1'));
    } catch (e) {
        throw new Error('WRONG_MASTER_PASSWORD');
    }

    const privateKey = await C.importEcPrivate(privPkcs8);
    const publicRaw  = C.fromB64(rec.pubB64);
    const id         = rec.id;

    return { id, privateKey, publicRaw, isNew: false };
}

/**
 * Создаёт новую личность и сохраняет её.
 */
export async function createIdentity(masterPassword) {
    const kp = await C.generateEcKeypair();
    const { pub, privPkcs8 } = await C.exportKeypair(kp);
    const id = await C.deriveUserId(pub);

    const salt    = C.randomBytes(CONFIG.SALT_LEN);
    const wrapKey = await C.pbkdf2(masterPassword, salt, CONFIG.PBKDF2_ITER, 32);
    const { nonce, ct } = await C.aesEncrypt(
        wrapKey, privPkcs8, C.utf8('hk-priv-v1')
    );

    const rec = {
        id: REC_ID,
        userId: id,
        pubB64:   C.toB64(pub),
        privSalt: C.toB64(salt),
        privNonce:C.toB64(nonce),
        privCt:   C.toB64(ct),
        createdAt: Date.now()
    };
    await DB.put(STORE, rec);

    const privateKey = await C.importEcPrivate(privPkcs8);
    return { id, privateKey, publicRaw: pub, isNew: true };
}

/**
 * Отдаёт публичный ключ серверу (POST /pubkey).
 * @returns {Promise<boolean>}
 */
export async function publishPublicKey(id, publicRaw) {
    try {
        const res = await fetch(CONFIG.RELAY_API + '/pubkey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id,
                pubkey: C.toB64(publicRaw)
            })
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

/**
 * Получает публичный ключ другого пользователя.
 */
export async function fetchPublicKey(userId) {
    const res = await fetch(CONFIG.RELAY_API + '/pubkey/' + encodeURIComponent(userId));
    if (!res.ok) throw new Error('NOT_FOUND');
    const data = await res.json();
    return {
        id: data.id,
        publicRaw: C.fromB64(data.pubkey),
        updatedAt: data.updatedAt
    };
}

/**
 * Есть ли уже сохранённая личность? (для быстрого показа экрана ввода пароля)
 */
export async function hasIdentity() {
    const rec = await DB.get(STORE, REC_ID);
    return !!rec;
}

/**
 * Возвращает сохранённый ID без ввода пароля (для отображения в UI).
 */
export async function getStoredUserId() {
    const rec = await DB.get(STORE, REC_ID);
    return rec ? rec.userId : null;
}

/**
 * УДАЛЯЕТ личность (полный сброс).
 * Внимание: вместе с ней станут нечитаемы все сохранённые сообщения.
 */
export async function wipeIdentity() {
    await DB.del(STORE, REC_ID);
}