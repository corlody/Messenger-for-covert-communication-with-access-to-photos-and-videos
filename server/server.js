'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT      = process.env.PORT || 3000;
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_QUEUE = 500;
const MAX_ENV   = 2 * 1024 * 1024;              // 2 MB на envelope
const TTL       = 30 * 24 * 3600 * 1000;        // 30 дней в очереди
const ID_RE     = /^[A-Z2-9]{4,64}$/;           // base32-ish, без 0/1/I/O

// ---------- Состояние ----------
const publicKeys = new Map(); // id → { pubkey, updatedAt }
const queues     = new Map(); // id → [envelope]
const clients    = new Map(); // id → ws

// ---------- Персистентность ----------
function loadState() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const pkFile = path.join(DATA_DIR, 'pubkeys.json');
        const qFile  = path.join(DATA_DIR, 'queues.json');
        if (fs.existsSync(pkFile)) {
            const obj = JSON.parse(fs.readFileSync(pkFile, 'utf8'));
            for (const k in obj) publicKeys.set(k, obj[k]);
        }
        if (fs.existsSync(qFile)) {
            const obj = JSON.parse(fs.readFileSync(qFile, 'utf8'));
            for (const k in obj) queues.set(k, obj[k]);
        }
    } catch (e) { console.error('loadState:', e.message); }
}

let saveTimer = null;
function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveState(); }, 2000);
}
function saveState() {
    try {
        const pk = {};
        publicKeys.forEach((v, k) => { pk[k] = v; });
        const q = {};
        queues.forEach((v, k) => { if (v.length) q[k] = v; });
        fs.writeFileSync(path.join(DATA_DIR, 'pubkeys.json'), JSON.stringify(pk));
        fs.writeFileSync(path.join(DATA_DIR, 'queues.json'),  JSON.stringify(q));
    } catch (e) { console.error('saveState:', e.message); }
}

// ---------- Уборка старых сообщений ----------
setInterval(() => {
    const now = Date.now();
    let dropped = 0;
    queues.forEach((arr, id) => {
        const filtered = arr.filter(env => now - env.ts < TTL);
        dropped += arr.length - filtered.length;
        if (filtered.length) queues.set(id, filtered);
        else queues.delete(id);
    });
    if (dropped) { console.log('[cleanup] dropped', dropped); scheduleSave(); }
}, 3600 * 1000);

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            ok: true,
            users: publicKeys.size,
            online: clients.size,
            queued: [...queues.values()].reduce((a, b) => a + b.length, 0),
            uptime: Math.round(process.uptime())
        }));
    }

    // GET /pubkey/:id
    const mGet = req.url.match(/^\/pubkey\/([A-Z2-9]{4,64})$/);
    if (req.method === 'GET' && mGet) {
        const id = mGet[1];
        const rec = publicKeys.get(id);
        if (!rec) { res.writeHead(404); return res.end('{"error":"not_found"}'); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id, pubkey: rec.pubkey, updatedAt: rec.updatedAt }));
    }

    // POST /pubkey  { id, pubkey }
    if (req.method === 'POST' && req.url === '/pubkey') {
        let body = '';
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > 4096) { req.destroy(); return; }
            body += c;
        });
        req.on('end', () => {
            try {
                const { id, pubkey } = JSON.parse(body);
                if (!ID_RE.test(id)) throw new Error('bad id');
                if (typeof pubkey !== 'string' || pubkey.length > 2048) throw new Error('bad key');
                publicKeys.set(id, { pubkey, updatedAt: Date.now() });
                scheduleSave();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true}');
            } catch (e) {
                res.writeHead(400);
                res.end('{"error":"bad_request"}');
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('{"error":"not_found"}');
});

// ---------- WebSocket ----------
const wss = new WebSocket.Server({
    server,
    path: '/ws',
    maxPayload: MAX_ENV + 8192
});

function sendJSON(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
}

function enqueue(to, env) {
    let q = queues.get(to);
    if (!q) { q = []; queues.set(to, q); }
    q.push(env);
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
    scheduleSave();
}

wss.on('connection', ws => {
    ws.isAlive = true;
    ws.userId = null;

    const ping = setInterval(() => {
        if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} return; }
        ws.isAlive = false;
        try { ws.ping(); } catch (e) {}
    }, 30000);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', raw => {
        if (raw.length > MAX_ENV + 8192) return;
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (!msg || typeof msg.type !== 'string') return;

        // --- hello ---
        if (msg.type === 'hello') {
            const id = String(msg.id || '');
            if (!ID_RE.test(id)) return sendJSON(ws, { type: 'error', reason: 'bad_id' });

            const old = clients.get(id);
            if (old && old !== ws) { try { old.close(); } catch (e) {} }

            ws.userId = id;
            clients.set(id, ws);
            sendJSON(ws, { type: 'ready', id });

            // Отдаём накопленную очередь
            const q = queues.get(id) || [];
            for (const env of q) sendJSON(ws, { type: 'msg', env });
            return;
        }

        if (!ws.userId) return sendJSON(ws, { type: 'error', reason: 'not_registered' });

        // --- send ---
        if (msg.type === 'send') {
            const env = msg.env || {};
            const to  = String(env.to || '');
            if (!ID_RE.test(to)) return sendJSON(ws, { type: 'error', reason: 'bad_recipient' });
            if (typeof env.nonce !== 'string' || typeof env.ct !== 'string') {
                return sendJSON(ws, { type: 'error', reason: 'bad_envelope' });
            }
            if (env.ct.length > MAX_ENV) {
                return sendJSON(ws, { type: 'error', reason: 'too_big' });
            }

            const envelope = {
                id:   crypto.randomBytes(8).toString('hex'),
                from: ws.userId,
                to,
                nonce: env.nonce,
                ct:    env.ct,
                kind:  typeof env.kind === 'string' ? env.kind.slice(0, 16) : 'text',
                ts:    Date.now()
            };

            const recipient = clients.get(to);
            if (recipient) {
                sendJSON(recipient, { type: 'msg', env: envelope });
                enqueue(to, envelope);   // до ack держим в очереди на случай обрыва
                sendJSON(ws, { type: 'sent', envId: envelope.id, ok: true, delivered: true });
            } else {
                enqueue(to, envelope);
                sendJSON(ws, { type: 'sent', envId: envelope.id, ok: true, delivered: false });
            }
            return;
        }

        // --- ack ---
        if (msg.type === 'ack') {
            const ids = Array.isArray(msg.ids) ? msg.ids : [];
            const q = queues.get(ws.userId) || [];
            const filtered = q.filter(e => !ids.includes(e.id));
            if (filtered.length) queues.set(ws.userId, filtered);
            else queues.delete(ws.userId);
            scheduleSave();
            return;
        }
    });

    ws.on('close', () => {
        clearInterval(ping);
        if (ws.userId && clients.get(ws.userId) === ws) clients.delete(ws.userId);
    });

    ws.on('error', () => {});
});

// ---------- Запуск ----------
loadState();
server.listen(PORT, () => {
    console.log('Hana-Koto relay · порт ' + PORT);
    console.log('Данные: ' + DATA_DIR);
    console.log('Пользователей в базе: ' + publicKeys.size);
});

process.on('SIGINT',  () => { saveState(); process.exit(0); });
process.on('SIGTERM', () => { saveState(); process.exit(0); });