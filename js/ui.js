// js/ui.js
import { CONFIG } from './config.js';

let _toastTimer = null;
let _onTabChange = null;
let _currentPin = null;
let _pinTimer = null;
let _pinResolve = null;

export function init(opts) {
    _onTabChange = opts.onTabChange;
}

// ---------- Toast ----------
export function toast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Табы ----------
export function setTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
        c.style.display = (c.id === 'tab-' + name) ? 'block' : 'none';
    });
    if (_onTabChange) _onTabChange(name);
}

// ---------- Экраны (главный роутер) ----------
export function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
}

// ---------- Тема ----------
export function setTheme(theme) {
    const wasSecure = document.body.classList.contains('secure');
    const sc = document.body.dataset.scene || 'school';
    document.body.className = theme;
    if (wasSecure) {
        document.body.classList.add('secure');
        document.body.classList.add('scene-' + sc);
    }
    const l = document.getElementById('themeLight');
    const d = document.getElementById('themeDark');
    if (l && d) {
        if (theme === 'light') { l.classList.add('active-light'); d.classList.remove('active-dark'); }
        else { d.classList.add('active-dark'); l.classList.remove('active-light'); }
    }
    try { localStorage.setItem('hk_theme', theme); } catch (e) {}
}

export function loadTheme() {
    try {
        const t = localStorage.getItem('hk_theme');
        if (t) setTheme(t);
    } catch (e) {}
}

// ---------- Модалка мастер-пароля ----------
export function openMasterGate() {
    const modal = document.getElementById('gateModal');
    const input = document.getElementById('gateInput');
    const err   = document.getElementById('gateErr');
    if (!modal) return;
    err.textContent = '';
    input.value = '';
    modal.classList.add('show');
    setTimeout(() => input.focus(), 150);
}

export function closeMasterGate() {
    document.getElementById('gateModal').classList.remove('show');
}

export function showGateError(msg) {
    const err = document.getElementById('gateErr');
    if (err) err.textContent = msg;
}

// ---------- PIN-модалка (для расшифровки сообщений) ----------
export function askPin(reasonText) {
    // Если PIN уже в памяти — вернуть сразу
    if (_currentPin) return Promise.resolve(_currentPin);

    return new Promise(resolve => {
        _pinResolve = resolve;
        const modal = document.getElementById('pinModal');
        const input = document.getElementById('pinInput');
        const err   = document.getElementById('pinErr');
        const sub   = document.getElementById('pinSub');

        if (!modal) return resolve(null);

        sub.textContent = reasonText || 'Введите PIN';
        err.textContent = '';
        input.value = '';
        modal.classList.add('show');
        setTimeout(() => input.focus(), 150);
    });
}

export function submitPin() {
    const input = document.getElementById('pinInput');
    const err   = document.getElementById('pinErr');
    const val   = input.value.trim();
    if (val.length !== CONFIG.PIN_LEN || !/^\d+$/.test(val)) {
        err.textContent = 'PIN должен быть ' + CONFIG.PIN_LEN + ' цифры';
        return;
    }
    _currentPin = val;
    _scheduleAutoLock();
    document.getElementById('pinModal').classList.remove('show');
    if (_pinResolve) _pinResolve(val);
    _pinResolve = null;
}

export function cancelPin() {
    document.getElementById('pinModal').classList.remove('show');
    if (_pinResolve) _pinResolve(null);
    _pinResolve = null;
}

export function getPin() { return _currentPin; }

export function forgetPin() {
    _currentPin = null;
    clearTimeout(_pinTimer);
}

function _scheduleAutoLock() {
    clearTimeout(_pinTimer);
    if (!CONFIG.PIN_ENABLED) return;
    _pinTimer = setTimeout(() => {
        forgetPin();
    }, CONFIG.PIN_AUTOLOCK_SEC * 1000);
}

// Сбрасываем таймер при активности
['click', 'keydown', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, () => {
        if (_currentPin) _scheduleAutoLock();
    }, { passive: true });
});

// ---------- Модалка просмотра медиа ----------
export function openMediaViewer(url, name, type) {
    const v = document.getElementById('mediaViewer');
    const wrap = document.getElementById('mediaViewerBody');
    const meta = document.getElementById('mediaViewerMeta');
    const dl = document.getElementById('mediaViewerDownload');
    if (!v || !wrap) return;

    wrap.innerHTML = '';
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        wrap.appendChild(img);
    } else {
        const vid = document.createElement('video');
        vid.src = url;
        vid.controls = true;
        vid.autoplay = true;
        vid.setAttribute('playsinline', 'true');
        wrap.appendChild(vid);
    }
    meta.textContent = name || '';
    dl.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = name || 'file';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    v.classList.add('show');
}

export function closeMediaViewer() {
    const v = document.getElementById('mediaViewer');
    const wrap = document.getElementById('mediaViewerBody');
    if (!v || !wrap) return;
    v.classList.remove('show');
    wrap.innerHTML = '';
}

// ---------- Кнопки заголовка чата ----------
export function setTitle(text, subtitle) {
    const t = document.getElementById('mainTitle');
    const s = document.getElementById('mainSubtitle');
    if (t) t.textContent = text;
    if (s) s.textContent = subtitle || '';
}

// ---------- Автозакрытие сессии по простою ----------
let _idleTimer = null;
let _onIdleLock = null;

export function setIdleHandler(fn) { _onIdleLock = fn; }
export function resetIdle() {
    clearTimeout(_idleTimer);
    if (!_onIdleLock) return;
    _idleTimer = setTimeout(() => _onIdleLock(), CONFIG.IDLE_LOCK_MIN * 60 * 1000);
}
['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => {
    document.addEventListener(ev, resetIdle, { passive: true });
});