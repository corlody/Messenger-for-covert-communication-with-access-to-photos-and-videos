// js/history.js
import * as DB from './storage.js';

let _renderedUrls = [];
let _onOpenMedia = null;

export function init(opts) {
    _onOpenMedia = opts.onOpenMedia;
}

export function revokeAll() {
    for (const url of _renderedUrls) {
        try { URL.revokeObjectURL(url); } catch (e) {}
    }
    _renderedUrls = [];
}

/**
 * @param {HTMLElement} container
 * @param {string} userId - с кем переписка
 * @param {object} contact - { name, userId }
 */
export async function renderConversation(container, userId, contact) {
    revokeAll();
    container.innerHTML = '';

    const messages = await DB.getMessagesWith(userId);
    if (messages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.innerHTML = 'Пока пусто.<br>Отправь первое сообщение.';
        container.appendChild(empty);
        return;
    }

    let lastDate = '';
    for (const m of messages) {
        const dayLabel = _dayLabel(m.ts);
        if (dayLabel !== lastDate) {
            const sep = document.createElement('div');
            sep.className = 'day-sep';
            sep.textContent = dayLabel;
            container.appendChild(sep);
            lastDate = dayLabel;
        }
        container.appendChild(_renderMessage(m, contact));
    }

    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 30);
}

function _renderMessage(m, contact) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (m.direction === 'out' ? 'out' : 'in');

    const body = document.createElement('div');
    body.className = 'msg-body' + ((m.kind === 'photo' || m.kind === 'video') ? ' media' : '');

    if (m.kind === 'text') {
        body.textContent = m.text;
    } else if (m.blob) {
        const url = URL.createObjectURL(m.blob);
        _renderedUrls.push(url);

        if (m.kind === 'photo') {
            const img = document.createElement('img');
            img.src = url;
            img.alt = m.fileName || 'photo';
            img.loading = 'lazy';
            img.onclick = () => _openMedia(url, m.fileName, 'image');
            body.appendChild(img);
        } else if (m.kind === 'video') {
            const v = document.createElement('video');
            v.src = url;
            v.preload = 'metadata';
            v.muted = true;
            v.setAttribute('playsinline', 'true');
            v.onclick = () => _openMedia(url, m.fileName, 'video');
            body.appendChild(v);

            const play = document.createElement('div');
            play.className = 'play-overlay';
            play.textContent = '▶';
            body.appendChild(play);
        }
    }

    wrap.appendChild(body);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = _timeLabel(m.ts);
    const checks = (m.direction === 'out') ? (m.delivered ? ' ✓' : ' ⏳') : '';
    meta.textContent = time + checks;
    wrap.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    if (m.kind === 'text') {
        const cp = document.createElement('button');
        cp.textContent = '📋';
        cp.title = 'Копировать';
        cp.onclick = () => navigator.clipboard.writeText(m.text).catch(() => {});
        actions.appendChild(cp);
    } else if (m.blob) {
        const dl = document.createElement('button');
        dl.textContent = '💾';
        dl.title = 'Скачать';
        dl.onclick = () => _download(m.blob, m.fileName || 'file');
        actions.appendChild(dl);
    }

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = 'Удалить';
    del.onclick = async () => {
        if (!confirm('Удалить сообщение?')) return;
        await DB.deleteMessage(m.id);
        wrap.remove();
    };
    actions.appendChild(del);

    wrap.appendChild(actions);
    return wrap;
}

function _openMedia(url, name, type) {
    if (_onOpenMedia) _onOpenMedia(url, name, type);
}

function _download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const same = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    if (same(d, today)) return 'Сегодня';
    if (same(d, yest)) return 'Вчера';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(2);
    return dd + '.' + mm + '.' + yy;
}

function _timeLabel(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}