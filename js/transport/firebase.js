// js/transport/firebase.js
// Транспорт через Firebase Realtime Database.
// Публичный API такой же, как у WebSocket-клиента.

import { CONFIG } from '../config.js';
import {
    initializeApp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getDatabase, ref, set, get, remove, onChildAdded, off, update
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

export class FirebaseTransport extends EventTarget {
    constructor() {
        super();
        this.app  = null;
        this.db   = null;
        this.userId = null;
        this.connected = false;
        this._unsubscribe = null;
    }

    async connect(userId) {
        this.userId = userId;

        try {
            this.app = initializeApp(CONFIG.FIREBASE);
            this.db  = getDatabase(this.app);
        } catch (e) {
            this.emit('status', { state: 'error', reason: 'firebase_init' });
            throw e;
        }

        // Проверим связь быстрым чтением
        try {
            await get(ref(this.db, '.info/connected'));
        } catch (e) {
            this.emit('status', { state: 'error', reason: 'no_connection' });
            throw e;
        }

        this.connected = true;
        this.emit('status', { state: 'online' });
        this.emit('ready', { id: this.userId });

        this._subscribeIncoming();
    }

    async _subscribeIncoming() {
        const queueRef = ref(this.db, 'queues/' + this.userId);

        // Подписываемся на новые сообщения в нашей очереди
        const handler = onChildAdded(queueRef, snapshot => {
            const env = snapshot.val();
            if (!env) return;

            // Прочитали — удаляем (сервер на Firebase хранит, пока не удалишь)
            const childRef = ref(this.db, 'queues/' + this.userId + '/' + snapshot.key);
            remove(childRef).catch(() => {});

            env.id = snapshot.key;
            this.emit('message', env);
        }, err => {
            this.emit('status', { state: 'error', reason: 'subscribe', detail: err.message });
        });

        this._unsubscribe = () => {
            try { off(queueRef, 'child_added', handler); } catch (e) {}
        };
    }

    /**
     * Публикует публичный ключ пользователя.
     * @param {string} userId
     * @param {string} pubB64
     */
    async publishPublicKey(userId, pubB64) {
        const r = ref(this.db, 'pubkeys/' + userId);
        await set(r, { pk: pubB64, ts: Date.now() });
    }

    /**
     * Читает публичный ключ другого пользователя.
     * @returns {Promise<{pk:string, ts:number}|null>}
     */
    async fetchPublicKey(userId) {
        const r = ref(this.db, 'pubkeys/' + userId);
        const snap = await get(r);
        return snap.exists() ? snap.val() : null;
    }

    /**
     * Отправляет envelope получателю.
     * @param {{to:string, nonce:string, ct:string, kind:string}} env
     * @returns {Promise<{ok:boolean, envId:string}>}
     */
    async send(env) {
        if (!this.db) return { ok: false, envId: null };

        const envId = _newId();
        const envelope = {
            from: this.userId,
            to:   env.to,
            nonce: env.nonce,
            ct:    env.ct,
            kind:  env.kind || 'text',
            ts:    Date.now(),
            // размер для отладки
            size:  env.ct.length
        };

        try {
            await set(ref(this.db, 'queues/' + env.to + '/' + envId), envelope);
            this.emit('sent', { envId, ok: true, delivered: true });
            return { ok: true, envId };
        } catch (e) {
            this.emit('sent', { envId, ok: false, delivered: false, error: e.message });
            return { ok: false, envId };
        }
    }

    disconnect() {
        this.connected = false;
        if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
        this.emit('status', { state: 'offline' });
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }
}

function _newId() {
    const b = crypto.getRandomValues(new Uint8Array(8));
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
}