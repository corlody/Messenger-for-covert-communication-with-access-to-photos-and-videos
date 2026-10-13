// js/transport/index.js
// Единая точка входа для транспорта.
// Сейчас — Firebase. Потом можно добавить WebRTC для больших файлов.

import { CONFIG } from '../config.js';
import { FirebaseTransport } from './firebase.js';

export function createTransport() {
    // Пока только Firebase, потом можно добавить switch
    return new FirebaseTransport();
}