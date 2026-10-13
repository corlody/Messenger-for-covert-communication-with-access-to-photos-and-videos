// js/config.js
// Все настройки в одном месте.

export const CONFIG = {
    APP_NAME: 'Хана-Кото',
    APP_TAGLINE: 'E2E · без облака',
    VERSION: '3.0.0',

    // ============ FIREBASE ============
    FIREBASE: {
        apiKey: "AIzaSyDOETv23DSCbQmu4-JIgvqP-3HhI4M2sHM",
        authDomain: "hana-koto.firebaseapp.com",
        databaseURL: "https://hana-koto-default-rtdb.europe-west1.firebasedatabase.app",
        projectId: "hana-koto",
        storageBucket: "hana-koto.firebasestorage.app",
        messagingSenderId: "14838409838",
        appId: "1:14838409838:web:13fd94f81a6f228cad947f"
    },

    // ============ КРИПТО ============
    PBKDF2_ITER: 250000,
    SALT_LEN: 16,
    KEY_LEN: 32,
    NONCE_LEN: 12,
    ID_LEN: 8,

    // Слабый ключ (PIN) — второй уровень защиты
    PIN_ENABLED: true,
    PIN_LEN: 4,
    PIN_AUTOLOCK_SEC: 60,

    // ============ ЛИМИТЫ ============
    MAX_CONTACTS: 20,
    MAX_TEXT: 20000,
    MAX_PHOTO_MB: 15,
    MAX_VIDEO_MB: 100,
    MAX_FIREBASE_MSG_MB: 8,

    // ============ UI ============
    IDLE_LOCK_MIN: 30,
    ALPHABET: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
    EXCHANGE_PASSWORD_LEN: 32,

    // ============ ХРАНИЛИЩЕ ============
    DB_NAME: 'hana_koto_v3',
    DB_VERSION: 1
};