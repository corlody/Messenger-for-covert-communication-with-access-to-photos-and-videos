// js/contacts.js
import { CONFIG } from './config.js';
import * as C from './crypto.js';
import * as ID from './identity.js';
import * as DB from './storage.js';

/**
 * Добавляет нового собеседника.
 * @param {string} myId - мой userId
 * @param {CryptoKey} myPrivKey - мой приватный ECDH-ключ
 * @param {string} theirUserId - userId собеседника
 * @param {string} name - как его называть
 * @param {string} sharedPassword - общий пароль (переданный через ТГ)
 * @param {object} transport - Firebase-транспорт
 */
export async function addContactByUserId(myId, myPrivKey, theirUserId, name, sharedPassword, transport) {
    if (theirUserId === myId) throw new Error('SELF_CONTACT');

    const existing = await DB.getContactByUserId(theirUserId);
    if (existing) throw new Error('ALREADY_EXISTS');

    let theirPub;
    try {
        theirPub = await ID.fetchFromFirebase(transport, theirUserId);
    } catch (e) {
        throw new Error('NOT_FOUND');
    }
    if (!theirPub.publicRaw || theirPub.publicRaw.length !== 65) {
        throw new Error('BAD_KEY');
    }

    // Проверяем, что пароль рабочий — выводим ключ беседы
    const convKey = await C.deriveConversationKey(
        myPrivKey,
        theirPub.publicRaw,
        sharedPassword,
        myId,
        theirUserId
    );

    const id = await DB.addContact({
        userId: theirUserId,
        name: name.trim().slice(0, 32),
        publicRaw: theirPub.publicRaw,
        sharedPassword: sharedPassword,
        addedAt: Date.now()
    });

    const convId = getConversationId(myId, theirUserId);
    await DB.cacheConvKey(convId, convKey);
    return id;
}

export async function listContacts() {
    return DB.getContacts();
}

export async function removeContact(id) {
    return DB.deleteContact(id);
}

export async function renameContact(id, newName) {
    return DB.updateContact(id, { name: newName.trim().slice(0, 32) });
}

export function getConversationId(idA, idB) {
    return [idA, idB].sort().join('|');
}

/**
 * Возвращает ключ беседы (из кэша или выводит заново).
 */
export async function getConversationKey(myId, myPrivKey, contact, convId) {
    let key = await DB.getCachedConvKey(convId);
    if (key) return key;

    key = await C.deriveConversationKey(
        myPrivKey,
        contact.publicRaw,
        contact.sharedPassword,
        myId,
        contact.userId
    );
    await DB.cacheConvKey(convId, key);
    return key;
}

/**
 * Генерирует длинный пароль обмена для отправки в ТГ.
 */
export function generateSharedPassword() {
    return C.generateExchangePassword(CONFIG.EXCHANGE_PASSWORD_LEN);
}