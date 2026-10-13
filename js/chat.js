// js/chat.js
import { CONFIG } from './config.js';
import * as C from './crypto.js';
import * as DB from './storage.js';
import * as Contacts from './contacts.js';

let _ctx = null; // { myId, privKey, transport, onNewMessage }

export function init(ctx) {
    _ctx = ctx;
}

/**
 * Шифрует и отправляет текст.
 */
export async function sendText(contact, text) {
    if (!_ctx) throw new Error('NOT_INIT');
    if (text.length > CONFIG.MAX_TEXT) throw new Error('TOO_LONG');

    const convId = Contacts.getConversationId(_ctx.myId, contact.userId);
    const key = await Contacts.getConversationKey(_ctx.myId, _ctx.privKey, contact, convId);

    const { nonce, ct } = await C.aesEncrypt(key, C.utf8(text), C.utf8(convId));

    const res = await _ctx.transport.send({
        to: contact.userId,
        nonce: C.toB64(nonce),
        ct: C.toB64(ct),
        kind: 'text'
    });

    if (!res.ok) throw new Error('SEND_FAILED');

    const msgId = await DB.addMessage({
        withUser: contact.userId,
        direction: 'out',
        kind: 'text',
        text: text,
        ts: Date.now(),
        envId: res.envId,
        delivered: true
    });

    return { msgId, envId: res.envId };
}

/**
 * Обрабатывает входящий envelope от транспорта.
 */
export async function receiveEnvelope(env) {
    if (!_ctx) return;

    const contact = await DB.getContactByUserId(env.from);
    if (!contact) {
        console.warn('Unknown sender', env.from);
        return;
    }

    const convId = Contacts.getConversationId(_ctx.myId, env.from);
    const key = await Contacts.getConversationKey(_ctx.myId, _ctx.privKey, contact, convId);

    let payload;
    try {
        const nonce = C.fromB64(env.nonce);
        const ct = C.fromB64(env.ct);
        payload = await C.aesDecrypt(key, nonce, ct, C.utf8(convId));
    } catch (e) {
        console.error('Decrypt failed from', env.from, e.message);
        return;
    }

    if (env.kind === 'text') {
        const text = C.fromUtf8(payload);
        await DB.addMessage({
            withUser: env.from,
            direction: 'in',
            kind: 'text',
            text: text,
            ts: env.ts,
            envId: env.id
        });
        if (_ctx.onNewMessage) _ctx.onNewMessage(env.from);
        return;
    }

    if (env.kind === 'photo' || env.kind === 'video') {
        await _storeBinaryIncoming(env, payload, contact);
    }
}

async function _storeBinaryIncoming(env, payload, contact) {
    // Контейнер: "HKF1\n" + uint16 metaLen (LE) + JSON meta + raw bytes
    if (payload.length < 9 ||
        payload[0] !== 0x48 || payload[1] !== 0x4B ||
        payload[2] !== 0x46 || payload[3] !== 0x31 ||
        payload[4] !== 0x0A) {
        console.warn('Bad binary container');
        return;
    }
    const metaLen = payload[5] | (payload[6] << 8);
    let meta;
    try {
        meta = JSON.parse(C.fromUtf8(payload.slice(7, 7 + metaLen)));
    } catch (e) {
        console.warn('Bad meta');
        return;
    }
    const data = payload.slice(7 + metaLen);
    const blob = new Blob([data], { type: meta.type || 'application/octet-stream' });

    await DB.addMessage({
        withUser: env.from,
        direction: 'in',
        kind: env.kind,
        blob: blob,
        fileName: meta.name || 'file',
        mimeType: meta.type || 'application/octet-stream',
        ts: env.ts,
        envId: env.id
    });

    if (_ctx.onNewMessage) _ctx.onNewMessage(env.from);
}

export async function loadConversation(contact) {
    if (!_ctx) return [];
    return DB.getMessagesWith(contact.userId);
}

export async function deleteConversation(contact) {
    return DB.deleteMessagesWith(contact.userId);
}