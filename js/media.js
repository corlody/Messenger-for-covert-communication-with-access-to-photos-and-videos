// js/media.js
// Камера + отправка фото/видео через тот же E2E-канал.

import { CONFIG } from './config.js';
import * as C from './crypto.js';
import * as DB from './storage.js';
import * as Contacts from './contacts.js';

let _ctx = null;
let _stream = null;
let _recorder = null;
let _chunks = [];
let _mode = null; // 'photo' | 'video'

export function init(ctx) { _ctx = ctx; }

/**
 * Открывает камеру.
 * @param {'photo'|'video'} mode
 */
export async function openCamera(mode) {
    _mode = mode;
    const constraints = {
        audio: mode === 'video',
        video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        }
    };
    try {
        _stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
        throw new Error('NO_CAMERA');
    }
    return _stream;
}

export function attachToVideo(videoEl) {
    if (!_stream) return;
    videoEl.srcObject = _stream;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.muted = true;
    videoEl.play().catch(() => {});
}

export function closeCamera() {
    if (_recorder && _recorder.state !== 'inactive') {
        try { _recorder.stop(); } catch (e) {}
    }
    _recorder = null;
    _chunks = [];
    if (_stream) {
        _stream.getTracks().forEach(t => t.stop());
        _stream = null;
    }
}

export async function capturePhoto() {
    if (!_stream) throw new Error('NO_CAMERA');

    const video = document.createElement('video');
    video.srcObject = _stream;
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    await video.play();
    await new Promise(r => setTimeout(r, 120));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const g = canvas.getContext('2d');
    g.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('CAPTURE_FAILED')), 'image/jpeg', 0.9);
    });
}

export function startVideoRecording() {
    if (!_stream) throw new Error('NO_CAMERA');
    _chunks = [];

    let mime = '';
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
    ];
    for (const m of candidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
    }

    _recorder = new MediaRecorder(_stream, mime ? { mimeType: mime } : {});
    _recorder.ondataavailable = e => { if (e.data && e.data.size) _chunks.push(e.data); };
    _recorder.start();
}

export function stopVideoRecording() {
    return new Promise((resolve, reject) => {
        if (!_recorder) return reject(new Error('NOT_RECORDING'));
        _recorder.onstop = () => {
            const blob = new Blob(_chunks, { type: _recorder.mimeType || 'video/webm' });
            _chunks = [];
            resolve(blob);
        };
        _recorder.stop();
    });
}

/**
 * Шифрует и отправляет медиафайл.
 * @param {object} contact
 * @param {Blob} blob
 * @param {string} fileName
 * @param {'photo'|'video'} kind
 */
export async function sendMedia(contact, blob, fileName, kind) {
    if (!_ctx) throw new Error('NOT_INIT');

    const maxMB = kind === 'photo' ? CONFIG.MAX_PHOTO_MB : CONFIG.MAX_VIDEO_MB;
    if (blob.size > maxMB * 1024 * 1024) throw new Error('TOO_BIG');

    const convId = Contacts.getConversationId(_ctx.myId, contact.userId);
    const key = await Contacts.getConversationKey(_ctx.myId, _ctx.privKey, contact, convId);

    const raw = new Uint8Array(await blob.arrayBuffer());
    const metaBytes = C.utf8(JSON.stringify({
        name: fileName,
        type: blob.type || 'application/octet-stream',
        size: raw.length
    }));

    const header = new Uint8Array(7 + metaBytes.length);
    header[0] = 0x48; header[1] = 0x4B; header[2] = 0x46; header[3] = 0x31; header[4] = 0x0A;
    header[5] = metaBytes.length & 0xFF;
    header[6] = (metaBytes.length >> 8) & 0xFF;
    header.set(metaBytes, 7);

    const combined = new Uint8Array(header.length + raw.length);
    combined.set(header, 0);
    combined.set(raw, header.length);

    const { nonce, ct } = await C.aesEncrypt(key, combined, C.utf8(convId));

    // Лимит одного сообщения в Firebase Realtime DB
    if (ct.length > CONFIG.MAX_FIREBASE_MSG_MB * 1024 * 1024) {
        throw new Error('NEED_STORAGE'); // большие файлы → Firebase Storage (потом)
    }

    const res = await _ctx.transport.send({
        to: contact.userId,
        nonce: C.toB64(nonce),
        ct: C.toB64(ct),
        kind: kind
    });

    if (!res.ok) throw new Error('SEND_FAILED');

    const msgId = await DB.addMessage({
        withUser: contact.userId,
        direction: 'out',
        kind: kind,
        blob: blob,
        fileName: fileName,
        mimeType: blob.type,
        ts: Date.now(),
        envId: res.envId,
        delivered: true
    });

    return { msgId, envId: res.envId };
}

/**
 * Позволяет выбрать файл из галереи.
 */
export function pickFromGallery(accept) {
    return new Promise((resolve, reject) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept || 'image/*,video/*';
        inp.onchange = () => {
            const f = inp.files && inp.files[0];
            if (!f) return reject(new Error('CANCELLED'));
            resolve(f);
        };
        inp.click();
    });
}