// js/app.js
// Точка входа. Связывает все модули.

import { CONFIG } from './config.js';
import * as C from './crypto.js';
import * as ID from './identity.js';
import * as DB from './storage.js';
import { createTransport } from './transport/index.js';
import * as Contacts from './contacts.js';
import * as Chat from './chat.js';
import * as Media from './media.js';
import * as History from './history.js';
import * as Hana from './hanakoto.js';
import * as Scenes from './scenes.js';
import * as UI from './ui.js';

// ---------- Глобальное состояние ----------
const state = {
    identity: null,       // { id, privateKey, publicRaw }
    transport: null,
    contacts: [],         // массив контактов
    activeContact: null,  // текущий собеседник в чате
    isNewIdentity: false
};

// ---------- Инициализация ----------
async function boot() {
    C.checkCryptoAvailable();

    UI.loadTheme();
    Scenes.initScenes();
    UI.init({
        onTabChange: onTabChange
    });
    UI.setIdleHandler(() => lockSession());

    document.getElementById('splash').classList.add('show');
    setTimeout(() => document.getElementById('splash').classList.remove('show'), 1500);

    // Показать экран создания / разблокировки
    const hasId = await ID.hasIdentity();
    if (hasId) {
        showAuthScreen('unlock');
        const storedId = await ID.getStoredUserId();
        if (storedId) document.getElementById('storedIdPreview').textContent = storedId;
    } else {
        showAuthScreen('create');
    }

    wireGlobalHandlers();
}

function wireGlobalHandlers() {
    // Auth
    document.getElementById('authBtn').onclick = handleAuth;
    document.getElementById('authPwd').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            if (!document.getElementById('authPwd2').closest('.hidden')) {
                document.getElementById('authPwd2').focus();
            } else handleAuth();
        }
    });
    document.getElementById('authPwd2').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleAuth();
    });

    // Theme toggle
    document.getElementById('themeLight').onclick = () => UI.setTheme('light');
    document.getElementById('themeDark').onclick = () => UI.setTheme('dark');

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => UI.setTab(btn.dataset.tab);
    });

    // Chats tab
    document.getElementById('addContactBtn').onclick = openAddContact;
    document.getElementById('copyMyIdBtn').onclick = copyMyId;

    // Add contact modal
    document.getElementById('acClose').onclick = closeAddContact;
    document.getElementById('acGenPwd').onclick = generatePasswordField;
    document.getElementById('acSave').onclick = saveNewContact;

    // Chat screen
    document.getElementById('chatBack').onclick = closeChat;
    document.getElementById('sendBtn').onclick = sendCurrentMessage;
    document.getElementById('chatInput').addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendCurrentMessage();
        }
    });
    document.getElementById('attachBtn').onclick = toggleAttachMenu;
    document.querySelectorAll('#attachMenu button').forEach(b => {
        b.onclick = () => handleAttach(b.dataset.action);
    });

    // Camera modal
    document.getElementById('camClose').onclick = closeCameraModal;
    document.getElementById('camShutter').onclick = cameraShutter;
    document.getElementById('camSwitch').onclick = switchCamera;

    // Media viewer
    document.getElementById('mediaViewer').onclick = e => {
        if (e.target.id === 'mediaViewer') UI.closeMediaViewer();
    };

    // PIN modal
    document.getElementById('pinOk').onclick = () => UI.submitPin();
    document.getElementById('pinCancel').onclick = () => UI.cancelPin();
    document.getElementById('pinInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') UI.submitPin();
    });

    // Hanakoto tab
    document.getElementById('kanaModeEncode').onclick = () => setKanaMode('encode');
    document.getElementById('kanaModeDecode').onclick = () => setKanaMode('decode');
    document.getElementById('kanaTranslate').onclick = kanaTranslate;
    document.getElementById('kanaCopy').onclick = kanaCopy;
    document.getElementById('kanaClear').onclick = kanaClear;

    // Settings
    document.querySelectorAll('.scene-dot').forEach(dot => {
        dot.onclick = () => {
            Scenes.setScene(dot.dataset.scene);
            document.body.dataset.scene = dot.dataset.scene;
            try { localStorage.setItem('hk_scene', dot.dataset.scene); } catch (e) {}
        };
    });
    document.getElementById('wipeBtn').onclick = wipeEverything;
}

// ---------- Аутентификация ----------
function showAuthScreen(mode) {
    const sub = document.getElementById('authSub');
    const pwd2 = document.getElementById('authPwd2');
    const hint = document.getElementById('authHint');
    const stored = document.getElementById('storedIdBlock');

    if (mode === 'create') {
        sub.textContent = 'Создание новой личности';
        pwd2.classList.remove('hidden');
        hint.textContent = 'Придумайте надёжный пароль. Восстановления нет.';
        stored.style.display = 'none';
        document.getElementById('authBtn').textContent = '✨ Создать';
    } else {
        sub.textContent = 'Разблокировка';
        pwd2.classList.add('hidden');
        hint.textContent = 'Введите мастер-пароль для входа.';
        stored.style.display = 'block';
        document.getElementById('authBtn').textContent = '🔓 Войти';
    }
    UI.showScreen('auth');
    setTimeout(() => document.getElementById('authPwd').focus(), 100);
}

async function handleAuth() {
    const pwd  = document.getElementById('authPwd').value;
    const pwd2 = document.getElementById('authPwd2').value;
    const err  = document.getElementById('authErr');
    const btn  = document.getElementById('authBtn');
    err.textContent = '';

    const hasId = await ID.hasIdentity();

    if (!hasId) {
        if (pwd.length < 6) { err.textContent = 'Минимум 6 символов'; return; }
        if (pwd !== pwd2)   { err.textContent = 'Пароли не совпали'; return; }

        btn.disabled = true;
        btn.textContent = '⏳ Генерация ключей...';
        try {
            const id = await ID.createIdentity(pwd);
            state.identity = id;
            state.isNewIdentity = true;

            // Публикуем публичный ключ
            const t = createTransport();
            state.transport = t;
            await ID.publishToFirebase(t, id.id, id.publicRaw);

            await enterMain();
        } catch (e) {
            err.textContent = 'Ошибка: ' + e.message;
            btn.disabled = false;
            btn.textContent = '✨ Создать';
        }
        return;
    }

    // Unlock
    if (!pwd) { err.textContent = 'Введите пароль'; return; }

    btn.disabled = true;
    btn.textContent = '⏳ Проверка...';
    try {
        const id = await ID.loadOrCreateIdentity(pwd);
        state.identity = id;

        const t = createTransport();
        state.transport = t;
        // Убедимся, что наш ключ есть на сервере
        await ID.publishToFirebase(t, id.id, id.publicRaw);

        await enterMain();
    } catch (e) {
        if (e.message === 'WRONG_MASTER_PASSWORD') {
            err.textContent = 'Неверный пароль';
        } else {
            err.textContent = 'Ошибка: ' + e.message;
        }
        btn.disabled = false;
        btn.textContent = '🔓 Войти';
    }
}

// ---------- Вход в главный экран ----------
async function enterMain() {
    UI.showScreen('main');
    document.getElementById('authPwd').value = '';
    document.getElementById('authPwd2').value = '';

    // Проверим выбранную сцену
    let scene = 'school';
    try { scene = localStorage.getItem('hk_scene') || 'school'; } catch (e) {}
    document.body.dataset.scene = scene;
    Scenes.setScene(scene);

    // Покажем ID
    document.getElementById('myIdDisplay').textContent = state.identity.id;

    // Инициализируем модули
    Chat.init({
        myId: state.identity.id,
        privKey: state.identity.privateKey,
        transport: state.transport,
        onNewMessage: onIncomingMessage
    });
    Media.init({
        myId: state.identity.id,
        privKey: state.identity.privateKey,
        transport: state.transport
    });
    History.init({
        onOpenMedia: (url, name, type) => UI.openMediaViewer(url, name, type)
    });

    // Подключаем транспорт
    state.transport.addEventListener('message', async ev => {
        try { await Chat.receiveEnvelope(ev.detail); } catch (e) { console.error(e); }
    });
    state.transport.addEventListener('status', ev => {
        updateConnectionStatus(ev.detail.state);
    });

    await state.transport.connect(state.identity.id);

    // Загружаем контакты
    await refreshContacts();

    UI.setTab('chats');
    UI.toast(state.isNewIdentity ? '✨ Личность создана' : '🔓 Добро пожаловать');
}

function lockSession() {
    UI.forgetPin();
    state.identity = null;
    if (state.transport) state.transport.disconnect();
    state.transport = null;
    state.contacts = [];
    state.activeContact = null;
    showAuthScreen('unlock');
}

// ---------- Статус подключения ----------
function updateConnectionStatus(s) {
    const el = document.getElementById('connStatus');
    if (!el) return;
    if (s === 'online') {
        el.textContent = '● онлайн';
        el.className = 'conn-status online';
    } else if (s === 'connecting') {
        el.textContent = '◌ подключение...';
        el.className = 'conn-status connecting';
    } else {
        el.textContent = '○ оффлайн';
        el.className = 'conn-status offline';
    }
}

// ---------- Табы ----------
function onTabChange(name) {
    if (name === 'chats') {
        refreshContacts();
    }
}

// ---------- Контакты ----------
async function refreshContacts() {
    state.contacts = await Contacts.listContacts();
    renderContactsList();
}

function renderContactsList() {
    const list = document.getElementById('contactsList');
    list.innerHTML = '';

    if (state.contacts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'contacts-empty';
        empty.innerHTML = 'Пока нет контактов.<br>Нажми «+ Добавить», чтобы начать.';
        list.appendChild(empty);
        return;
    }

    for (const c of state.contacts) {
        const item = document.createElement('div');
        item.className = 'contact-item';

        const av = document.createElement('div');
        av.className = 'contact-avatar';
        av.textContent = (c.name[0] || '?').toUpperCase();
        item.appendChild(av);

        const info = document.createElement('div');
        info.className = 'contact-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'contact-name';
        nameEl.textContent = c.name;
        info.appendChild(nameEl);

        const idEl = document.createElement('div');
        idEl.className = 'contact-id';
        idEl.textContent = c.userId;
        info.appendChild(idEl);
        item.appendChild(info);

        // Последнее сообщение
        const last = await DB.getLastMessageWith(c.userId);
        if (last) {
            const lm = document.createElement('div');
            lm.className = 'contact-last';
            lm.textContent = last.kind === 'text'
                ? (last.text || '').slice(0, 40)
                : (last.kind === 'photo' ? '📷 Фото' : '🎥 Видео');
            info.appendChild(lm);
        }

        item.onclick = () => openChat(c);

        // Кнопка удаления
        const del = document.createElement('button');
        del.className = 'contact-del';
        del.textContent = '✕';
        del.onclick = async e => {
            e.stopPropagation();
            if (!confirm('Удалить контакт «' + c.name + '»?')) return;
            await Contacts.removeContact(c.id);
            await refreshContacts();
            UI.toast('🗑️ Удалён');
        };
        item.appendChild(del);

        list.appendChild(item);
    }
}

async function copyMyId() {
    try {
        await navigator.clipboard.writeText(state.identity.id);
        UI.toast('📋 ID скопирован');
    } catch (e) {
        UI.toast('❌ Не удалось');
    }
}

// ---------- Добавление контакта ----------
function openAddContact() {
    document.getElementById('acUserId').value = '';
    document.getElementById('acName').value = '';
    document.getElementById('acPassword').value = '';
    document.getElementById('acErr').textContent = '';
    document.getElementById('addContactModal').classList.add('show');
    setTimeout(() => document.getElementById('acUserId').focus(), 100);
}

function closeAddContact() {
    document.getElementById('addContactModal').classList.remove('show');
}

function generatePasswordField() {
    document.getElementById('acPassword').value = Contacts.generateSharedPassword();
    UI.toast('🔑 Сгенерирован пароль обмена');
}

async function saveNewContact() {
    const userId = document.getElementById('acUserId').value.trim().toUpperCase();
    const name = document.getElementById('acName').value.trim();
    const pwd = document.getElementById('acPassword').value;
    const err = document.getElementById('acErr');
    err.textContent = '';

    if (!/^[A-Z2-9]{8}$/.test(userId)) { err.textContent = 'ID должен быть 8 символов (A-Z, 2-9)'; return; }
    if (!name) { err.textContent = 'Введите имя'; return; }
    if (pwd.length < 16) { err.textContent = 'Пароль обмена — минимум 16 символов'; return; }
    if (userId === state.identity.id) { err.textContent = 'Это ваш ID'; return; }

    const btn = document.getElementById('acSave');
    btn.disabled = true;
    btn.textContent = '⏳ Поиск ключа...';

    try {
        await Contacts.addContactByUserId(
            state.identity.id,
            state.identity.privateKey,
            userId,
            name,
            pwd,
            state.transport
        );
        closeAddContact();
        await refreshContacts();
        UI.toast('✅ Контакт добавлен');
    } catch (e) {
        if (e.message === 'NOT_FOUND') err.textContent = 'Пользователь не найден в сети';
        else if (e.message === 'ALREADY_EXISTS') err.textContent = 'Уже в списке';
        else if (e.message === 'SELF_CONTACT') err.textContent = 'Это ваш ID';
        else err.textContent = 'Ошибка: ' + e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Сохранить';
}

// ---------- Чат ----------
async function openChat(contact) {
    state.activeContact = contact;
    document.getElementById('chatName').textContent = contact.name;
    document.getElementById('chatStatus').textContent = contact.userId;
    UI.showScreen('chat');
    await loadActiveConversation();
}

async function loadActiveConversation() {
    if (!state.activeContact) return;
    const cont = document.getElementById('chatMessages');
    await History.renderConversation(cont, state.activeContact.userId, state.activeContact);
}

function closeChat() {
    state.activeContact = null;
    UI.showScreen('main');
    refreshContacts();
}

async function sendCurrentMessage() {
    if (!state.activeContact) return;
    const inp = document.getElementById('chatInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';

    try {
        await Chat.sendText(state.activeContact, text);
        await loadActiveConversation();
    } catch (e) {
        UI.toast('❌ ' + (e.message || 'Ошибка отправки'));
        inp.value = text;
    }
}

function onIncomingMessage(fromUserId) {
    // Если это текущий открытый чат — перерисовать
    if (state.activeContact && state.activeContact.userId === fromUserId) {
        loadActiveConversation();
    } else {
        // Уведомление
        UI.toast('💬 Новое сообщение');
    }
    // Обновим список контактов (для превью)
    refreshContacts();
}

// ---------- Вложения ----------
function toggleAttachMenu() {
    const m = document.getElementById('attachMenu');
    m.classList.toggle('show');
}

async function handleAttach(action) {
    document.getElementById('attachMenu').classList.remove('show');

    if (action === 'photo') {
        await openCamera('photo');
    } else if (action === 'video') {
        await openCamera('video');
    } else if (action === 'gallery-photo') {
        try {
            const f = await Media.pickFromGallery('image/*');
            await Media.sendMedia(state.activeContact, f, f.name, 'photo');
            await loadActiveConversation();
            UI.toast('📷 Отправлено');
        } catch (e) { if (e.message !== 'CANCELLED') UI.toast('❌ ' + e.message); }
    } else if (action === 'gallery-video') {
        try {
            const f = await Media.pickFromGallery('video/*');
            await Media.sendMedia(state.activeContact, f, f.name, 'video');
            await loadActiveConversation();
            UI.toast('🎥 Отправлено');
        } catch (e) { if (e.message !== 'CANCELLED') UI.toast('❌ ' + e.message); }
    }
}

// ---------- Камера ----------
let _cameraMode = 'photo';
let _recordingStart = 0;
let _recordingTimer = null;

async function openCamera(mode) {
    _cameraMode = mode;
    try {
        await Media.openCamera(mode);
        const video = document.getElementById('camPreview');
        Media.attachToVideo(video);

        document.getElementById('cameraModal').classList.add('show');
        document.getElementById('camModeLabel').textContent =
            mode === 'photo' ? '📷 Фото' : '🎥 Видео';
        document.getElementById('camShutter').textContent = mode === 'photo' ? '●' : '⏺';
    } catch (e) {
        UI.toast('❌ Камера недоступна');
    }
}

function closeCameraModal() {
    document.getElementById('cameraModal').classList.remove('show');
    if (_recordingTimer) { clearInterval(_recordingTimer); _recordingTimer = null; }
    Media.closeCamera();
}

async function cameraShutter() {
    if (_cameraMode === 'photo') {
        try {
            const blob = await Media.capturePhoto();
            closeCameraModal();
            await Media.sendMedia(
                state.activeContact,
                blob,
                'photo_' + Date.now() + '.jpg',
                'photo'
            );
            await loadActiveConversation();
            UI.toast('📷 Отправлено');
        } catch (e) {
            UI.toast('❌ ' + e.message);
        }
        return;
    }

    // Видео
    const shutter = document.getElementById('camShutter');
    const label = document.getElementById('camModeLabel');
    if (!_recordingTimer) {
        // Начало записи
        try {
            Media.startVideoRecording();
            _recordingStart = Date.now();
            shutter.textContent = '⏹';
            label.style.color = '#ff5555';
            _recordingTimer = setInterval(() => {
                const sec = Math.floor((Date.now() - _recordingStart) / 1000);
                const m = String(Math.floor(sec / 60)).padStart(2, '0');
                const s = String(sec % 60).padStart(2, '0');
                label.textContent = '⏺ ' + m + ':' + s;
            }, 500);
        } catch (e) {
            UI.toast('❌ Не удалось начать запись');
        }
    } else {
        // Остановка
        clearInterval(_recordingTimer);
        _recordingTimer = null;
        label.textContent = '⏳ Обработка...';
        try {
            const blob = await Media.stopVideoRecording();
            closeCameraModal();
            await Media.sendMedia(
                state.activeContact,
                blob,
                'video_' + Date.now() + '.webm',
                'video'
            );
            await loadActiveConversation();
            UI.toast('🎥 Отправлено');
        } catch (e) {
            UI.toast('❌ ' + e.message);
        }
    }
}

async function switchCamera() {
    Media.closeCamera();
    try {
        await Media.openCamera(_cameraMode);
        Media.attachToVideo(document.getElementById('camPreview'));
    } catch (e) {}
}

// ---------- Хана-Кото (простой режим) ----------
let _kanaMode = 'encode';

function setKanaMode(m) {
    _kanaMode = m;
    document.getElementById('kanaModeEncode').classList.toggle('active', m === 'encode');
    document.getElementById('kanaModeDecode').classList.toggle('active', m === 'decode');
}

function kanaTranslate() {
    const inp = document.getElementById('kanaInput').value;
    if (!inp.trim()) return;
    let result;
    if (_kanaMode === 'encode') {
        result = Hana.encode(inp);
    } else {
        result = Hana.decode(inp);
    }
    document.getElementById('kanaOutput').textContent = result;
    document.getElementById('kanaOutput').classList.remove('placeholder');
}

async function kanaCopy() {
    const out = document.getElementById('kanaOutput').textContent;
    if (!out || out === 'Здесь появится результат...') return;
    try {
        await navigator.clipboard.writeText(out);
        UI.toast('📋 Скопировано');
    } catch (e) { UI.toast('❌ Не удалось'); }
}

function kanaClear() {
    document.getElementById('kanaInput').value = '';
    document.getElementById('kanaOutput').textContent = 'Здесь появится результат...';
    document.getElementById('kanaOutput').classList.add('placeholder');
}

// ---------- Настройки ----------
async function wipeEverything() {
    if (!confirm('УДАЛИТЬ ВСЁ?\n\nЭто сотрёт личность, контакты, сообщения. Восстановления не будет.')) return;
    if (!confirm('Точно? Понимаешь, что мастер-пароль тоже не вернуть?')) return;

    await DB.clear('messages');
    await DB.clear('contacts');
    await DB.clear('keys');
    await ID.wipeIdentity();

    UI.toast('🗑️ Всё стёрто');
    setTimeout(() => location.reload(), 800);
}

// ---------- Запуск ----------
window.addEventListener('DOMContentLoaded', () => {
    boot().catch(e => {
        console.error(e);
        document.body.innerHTML = '<div style="padding:40px;color:#fff;font-family:monospace;">Ошибка запуска: ' + e.message + '</div>';
    });
});