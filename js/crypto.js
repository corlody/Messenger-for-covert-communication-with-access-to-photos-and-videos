// js/crypto.js
// Низкоуровневые крипто-примитивы. Никакой UI-логики.

import { CONFIG } from './config.js';

const _enc = new TextEncoder();
const _dec = new TextDecoder();

// ---------- Random ----------
export function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
}

// ---------- Encoding ----------
export function toB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
}
export function fromB64(b64) {
    const s = atob(b64);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
}
export function toB64Url(u8) {
    return toB64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64Url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return fromB64(s);
}
export function toHex(u8) {
    let out = '';
    for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, '0');
    return out;
}
export function utf8(str)     { return _enc.encode(str); }
export function fromUtf8(u8)  { return _dec.decode(u8); }

export function concatBytes(...arrays) {
    let len = 0;
    for (const a of arrays) len += a.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
}

// ---------- Hash ----------
export async function sha256(data) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(buf);
}

// ---------- KDF ----------
export async function pbkdf2(password, salt, iterations = CONFIG.PBKDF2_ITER, lengthBytes = CONFIG.KEY_LEN) {
    const pwBytes = typeof password === 'string' ? utf8(password) : password;
    const baseKey = await crypto.subtle.importKey(
        'raw', pwBytes, 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        baseKey,
        lengthBytes * 8
    );
    return new Uint8Array(bits);
}

export async function hkdf(ikm, salt, info, lengthBytes = CONFIG.KEY_LEN) {
    const baseKey = await crypto.subtle.importKey(
        'raw', ikm, 'HKDF', false, ['deriveBits']
    );
    const infoBytes = typeof info === 'string' ? utf8(info) : info;
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes },
        baseKey,
        lengthBytes * 8
    );
    return new Uint8Array(bits);
}

// ---------- AES-GCM ----------
export async function aesEncrypt(rawKey32, plaintext, aad) {
    const key = await crypto.subtle.importKey(
        'raw', rawKey32, { name: 'AES-GCM' }, false, ['encrypt']
    );
    const nonce = randomBytes(CONFIG.NONCE_LEN);
    const params = { name: 'AES-GCM', iv: nonce };
    if (aad) params.additionalData = aad;
    const ct = await crypto.subtle.encrypt(params, key, plaintext);
    return { nonce, ct: new Uint8Array(ct) };
}

export async function aesDecrypt(rawKey32, nonce, ct, aad) {
    const key = await crypto.subtle.importKey(
        'raw', rawKey32, { name: 'AES-GCM' }, false, ['decrypt']
    );
    const params = { name: 'AES-GCM', iv: nonce };
    if (aad) params.additionalData = aad;
    const pt = await crypto.subtle.decrypt(params, key, ct);
    return new Uint8Array(pt);
}

// ---------- ECDH (P-256) ----------
export async function generateEcKeypair() {
    // Приватный ключ потом шифруется мастер-паролем и лежит в IndexedDB.
    // Публичный — публикуется на сервер под нашим ID.
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );
}

export async function exportKeypair(kp) {
    const pubRaw    = new Uint8Array(await crypto.subtle.exportKey('raw',   kp.publicKey));
    const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    return { pub: pubRaw, privPkcs8 };
}

export async function importEcPublic(pubRaw) {
    return crypto.subtle.importKey(
        'raw', pubRaw, { name: 'ECDH', namedCurve: 'P-256' }, true, []
    );
}

export async function importEcPrivate(pkcs8) {
    return crypto.subtle.importKey(
        'pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
    );
}

export async function ecdhSharedSecret(privKey, pubKey) {
    const bits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: pubKey }, privKey, 256
    );
    return new Uint8Array(bits);
}

// ---------- Ключ беседы (главная функция!) ----------
// Требует: ECDH-секрет + общий пароль обмена.
// Меняешь хоть один символ пароля → ключ полностью другой.
export async function deriveConversationKey(myPriv, theirPubRaw, sharedPassword, myId, theirId) {
    const theirPub    = await importEcPublic(theirPubRaw);
    const ecdhSecret  = await ecdhSharedSecret(myPriv, theirPub);
    const pwBytes     = utf8(sharedPassword);

    const ikm  = concatBytes(ecdhSecret, pwBytes);
    const [idA, idB] = [myId, theirId].sort();
    const salt = await sha256(utf8('hana-koto|' + idA + '|' + idB));

    return hkdf(ikm, salt, 'hana-koto-conv-v1', 32);
}

// ---------- Генерация ID пользователя ----------
export async function deriveUserId(pubKeyRaw) {
    const h = await sha256(pubKeyRaw);
    let id = '';
    for (let i = 0; i < CONFIG.ID_LEN; i++) {
        id += CONFIG.ID_ALPHABET[h[i] % CONFIG.ID_ALPHABET.length];
    }
    return id;
}

// ---------- Генерация длинного пароля обмена ----------
export function generateExchangePassword(length = 32) {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

// ---------- Утилиты ----------
export function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

// Проверка, что WebCrypto доступен
export function checkCryptoAvailable() {
    if (!window.crypto || !window.crypto.subtle) {
        throw new Error('WebCrypto недоступен. Нужен HTTPS и современный браузер.');
    }
    if (typeof TextEncoder === 'undefined') {
        throw new Error('TextEncoder не поддерживается.');
    }
}