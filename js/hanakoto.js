// js/hanakoto.js
// Простой режим кодирования русского текста в кану.
// Без пароля, без шифрования — просто замена букв.

const KANA_POOL =
    'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん' +
    'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン' +
    '日月火水木金土空';

const RUS_LETTERS = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const PUNCT_FWD = { '.': '。', ',': '、', '!': '！', '?': '？' };
const PUNCT_REV = { '。': '.', '、': ',', '！': '!', '？': '?' };

const _FWD = {};
const _REV = {};

(function init() {
    for (let i = 0; i < RUS_LETTERS.length; i++) {
        const L = RUS_LETTERS[i];
        const v = [
            KANA_POOL[(i * 3)     % KANA_POOL.length],
            KANA_POOL[(i * 3 + 1) % KANA_POOL.length],
            KANA_POOL[(i * 3 + 2) % KANA_POOL.length]
        ];
        _FWD[L] = v;
        for (const k of v) _REV[k] = L;
    }
})();

export function encode(text) {
    text = text.toLowerCase();
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (_FWD[ch]) {
            const v = _FWD[ch];
            out += v[i % v.length];
        } else if (PUNCT_FWD[ch]) {
            out += PUNCT_FWD[ch];
        } else {
            out += ch;
        }
    }
    return out;
}

export function decode(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (_REV[ch]) out += _REV[ch];
        else if (PUNCT_REV[ch]) out += PUNCT_REV[ch];
        else out += ch;
    }
    return out;
}

export function looksLikeKana(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x4E00 && c <= 0x9FFF)) return true;
    }
    return false;
}