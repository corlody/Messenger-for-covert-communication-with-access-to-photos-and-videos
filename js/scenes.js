// js/scenes.js
// Создаёт динамические элементы для сцен (звёзды, ёлки, капли дождя).

export function initScenes() {
    _createStars();
    _createClouds();
    _buildForest();
}

function _createStars() {
    const c = document.getElementById('stars');
    if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < 80; i++) {
        const s = document.createElement('div');
        s.className = 'star';
        const sz = Math.random() * 3 + 1;
        s.style.width = sz + 'px';
        s.style.height = sz + 'px';
        s.style.left = Math.random() * 100 + '%';
        s.style.top = Math.random() * 100 + '%';
        s.style.setProperty('--duration', (Math.random() * 3 + 2) + 's');
        s.style.animationDelay = (Math.random() * 5) + 's';
        c.appendChild(s);
    }
}

function _createClouds() {
    const c = document.getElementById('clouds');
    if (!c) return;
    c.innerHTML = '';
    const positions = [
        { top: '8%',  size: 150, speed: 30, delay: 0 },
        { top: '22%', size: 100, speed: 40, delay: 5 },
        { top: '45%', size: 130, speed: 35, delay: 10 },
        { top: '65%', size: 80,  speed: 45, delay: 3 },
        { top: '82%', size: 110, speed: 32, delay: 8 }
    ];
    for (const p of positions) {
        const cl = document.createElement('div');
        cl.className = 'cloud';
        cl.style.width = p.size + 'px';
        cl.style.height = (p.size * 0.3) + 'px';
        cl.style.top = p.top;
        cl.style.animationDuration = p.speed + 's';
        cl.style.animationDelay = p.delay + 's';
        cl.style.left = (Math.random() * 80 - 20) + '%';
        c.appendChild(cl);
    }
}

function _buildForest() {
    const t = document.getElementById('forestTrees');
    if (!t || t.dataset.built) return;
    t.dataset.built = '1';
    const positions = [
        { l: 3,  cls: 'far' },  { l: 12, cls: 'mid' }, { l: 22, cls: 'near' },
        { l: 32, cls: 'far' },  { l: 42, cls: 'near' },{ l: 52, cls: 'mid' },
        { l: 62, cls: 'near' }, { l: 72, cls: 'far' }, { l: 82, cls: 'mid' },
        { l: 92, cls: 'near' }
    ];
    for (const p of positions) {
        const f = document.createElement('div');
        f.className = 'fir ' + p.cls;
        f.style.left = p.l + '%';
        f.innerHTML = '<div class="fir-l l1"></div><div class="fir-l l2"></div><div class="fir-l l3"></div><div class="trunk"></div>';
        t.appendChild(f);
    }
    const r = document.getElementById('rainDrops');
    if (r) {
        for (let j = 0; j < 15; j++) {
            const d = document.createElement('div');
            d.className = 'rain-drop';
            d.style.left = Math.random() * 100 + '%';
            d.style.animationDelay = (Math.random() * 4) + 's';
            d.style.animationDuration = (2.5 + Math.random() * 2) + 's';
            r.appendChild(d);
        }
    }
}

/**
 * Переключение сцены.
 * @param {string} name - school | sky | room | forest | city
 */
export function setScene(name) {
    document.querySelectorAll('.scene-dot').forEach(d => {
        d.classList.toggle('active', d.dataset.scene === name);
    });
    document.body.classList.remove('scene-school','scene-sky','scene-room','scene-forest','scene-city');
    document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
    if (document.body.classList.contains('secure')) {
        document.body.classList.add('scene-' + name);
        const s = document.querySelector('.scene[data-scene="' + name + '"]');
        if (s) s.classList.add('active');
    }
}

/**
 * Проигрывает заставку «Защита активирована».
 */
export function playSplash() {
    const s = document.getElementById('splash');
    const rain = document.getElementById('splashRain');
    if (!s || !rain) return;
    rain.innerHTML = '';
    const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン日火水木金土空';
    for (let i = 0; i < 30; i++) {
        const sp = document.createElement('span');
        sp.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
        sp.style.left = (Math.random() * 100) + '%';
        sp.style.fontSize = (14 + Math.random() * 16) + 'px';
        sp.style.animationDuration = (2.5 + Math.random() * 3.5) + 's';
        sp.style.animationDelay = (Math.random() * 1.5) + 's';
        sp.style.opacity = 0.2 + Math.random() * 0.5;
        rain.appendChild(sp);
    }
    s.classList.add('show');
    clearTimeout(s._t);
    s._t = setTimeout(() => {
        s.classList.remove('show');
        setTimeout(() => { rain.innerHTML = ''; }, 500);
    }, 2000);
}