const fs = require('fs');
const path = require('path');

function createZip(files, outputPath) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    files.forEach(file => {
        const nameBuf = Buffer.from(file.name);
        const dataBuf = Buffer.from(file.content);
        
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < dataBuf.length; i++) {
            crc ^= dataBuf[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
            }
        }
        crc = (crc ^ 0xFFFFFFFF) >>> 0;

        const localHeader = Buffer.alloc(30 + nameBuf.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(0, 10);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(dataBuf.length, 18);
        localHeader.writeUInt32LE(dataBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBuf.copy(localHeader, 30);

        localHeaders.push(localHeader, dataBuf);

        const centralHeader = Buffer.alloc(46 + nameBuf.length);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt32LE(0, 12);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(dataBuf.length, 20);
        centralHeader.writeUInt32LE(dataBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 40);
        centralHeader.writeUInt32LE(offset, 42);
        nameBuf.copy(centralHeader, 46);

        centralHeaders.push(centralHeader);
        offset += localHeader.length + dataBuf.length;
    });

    const cdOffset = offset;
    let cdSize = 0;
    centralHeaders.forEach(ch => cdSize += ch.length);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    const finalBuffer = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
    fs.writeFileSync(outputPath, finalBuffer);
}

const files = [];

// 1. package.json
files.push({
    name: "package.json",
    content: JSON.stringify({
        name: "slither-ultra-online",
        version: "4.0.0",
        description: "Servidor Slither Online Next-Gen con Power-Ups, SFX y Skins Avanzadas",
        main: "server.js",
        scripts: { "start": "node server.js" },
        dependencies: { "express": "^4.19.2", "ws": "^8.17.0" }
    }, null, 2)
});

// 2. server.js
files.push({
    name: "server.js",
    content: `const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_SIZE = 4500;
const MAX_FOOD = 700;
const players = new Map();
const foods = new Map();
const powerups = new Map();
let foodIdCounter = 0;
let powerupCounter = 0;

const POWERUP_TYPES = ['SHIELD', 'DOUBLE_MASS', 'SPEED_BOOST', 'SUPER_MAGNET'];

function spawnFood(count) {
    for (let i = 0; i < count; i++) {
        const id = 'f_' + (foodIdCounter++);
        foods.set(id, {
            id,
            x: (Math.random() - 0.5) * WORLD_SIZE,
            y: (Math.random() - 0.5) * WORLD_SIZE,
            size: Math.random() * 4 + 3,
            value: 1,
            color: Math.floor(Math.random() * 360),
            isDeathOrb: false
        });
    }
}
spawnFood(MAX_FOOD);

function respawnPowerups() {
    powerups.clear();
    const count = 12;
    for (let i = 0; i < count; i++) {
        const id = 'pu_' + (powerupCounter++);
        const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        powerups.set(id, {
            id,
            type,
            x: (Math.random() - 0.5) * (WORLD_SIZE * 0.85),
            y: (Math.random() - 0.5) * (WORLD_SIZE * 0.85)
        });
    }
}
respawnPowerups();
setInterval(respawnPowerups, 20000); // Power-ups reaparecen cada 20 segundos

wss.on('connection', (ws) => {
    const id = 'p_' + Math.random().toString(36).substr(2, 7);
    let player = createPlayerState(id, 'Snake', 'CAMARADA');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'JOIN') {
                const fresh = createPlayerState(id, data.name || 'Snake', data.skin || 'CAMARADA');
                players.set(id, fresh);
                player = fresh;
            }
            if (data.type === 'LEAVE_MATCH') {
                dropMass(player);
                players.delete(id);
            }
            if (data.type === 'INPUT' && players.has(id)) {
                player.angle = data.angle;
                player.boosting = !!data.boosting;
            }
            if (data.type === 'SKILL' && players.has(id)) {
                const now = Date.now();
                if (data.skill === 'DASH' && now > player.cooldowns.dash) {
                    player.skillDash = true;
                    player.cooldowns.dash = now + 4000;
                    setTimeout(() => { player.skillDash = false; }, 350);
                }
                if (data.skill === 'MAGNET' && now > player.cooldowns.magnet) {
                    player.skillMagnet = true;
                    player.cooldowns.magnet = now + 8000;
                    setTimeout(() => { player.skillMagnet = false; }, 2500);
                }
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        dropMass(player);
        players.delete(id);
    });

    ws.send(JSON.stringify({
        type: 'INIT',
        id,
        worldSize: WORLD_SIZE
    }));
});

function createPlayerState(id, name, skin) {
    const spawnX = (Math.random() - 0.5) * (WORLD_SIZE * 0.8);
    const spawnY = (Math.random() - 0.5) * (WORLD_SIZE * 0.8);
    const p = {
        id,
        name: name.slice(0, 14),
        skin,
        x: spawnX,
        y: spawnY,
        angle: 0,
        score: 15,
        body: [],
        skillDash: false,
        skillMagnet: false,
        shieldActive: false,
        shieldEndTime: 0,
        doubleMassActive: false,
        doubleMassEndTime: 0,
        speedBoostActive: false,
        speedBoostEndTime: 0,
        cooldowns: { dash: 0, magnet: 0 }
    };
    for (let i = 0; i < 15; i++) {
        p.body.push({ x: spawnX - i * 5, y: spawnY });
    }
    return p;
}

function dropMass(p) {
    if (!p || p.score <= 0) return;
    const totalMassToDrop = Math.floor(p.score);
    const orbCount = Math.min(Math.max(6, Math.floor(totalMassToDrop / 12)), 35);
    const valuePerOrb = totalMassToDrop / orbCount;

    p.body.forEach((seg, idx) => {
        if (idx % Math.ceil(p.body.length / orbCount) === 0) {
            const fid = 'f_death_' + (foodIdCounter++);
            foods.set(fid, {
                id: fid,
                x: seg.x + (Math.random() - 0.5) * 20,
                y: seg.y + (Math.random() - 0.5) * 20,
                size: Math.min(22, Math.max(9, valuePerOrb * 0.8)),
                value: valuePerOrb,
                color: 330,
                isDeathOrb: true
            });
        }
    });
}

// Bucle de Física Servidor (40 TPS)
setInterval(() => {
    if (foods.size < MAX_FOOD) spawnFood(MAX_FOOD - foods.size);

    const now = Date.now();

    players.forEach(p => {
        // Verificar estados de Power-ups
        if (p.shieldActive && now > p.shieldEndTime) p.shieldActive = false;
        if (p.doubleMassActive && now > p.doubleMassEndTime) p.doubleMassActive = false;
        if (p.speedBoostActive && now > p.speedBoostEndTime) p.speedBoostActive = false;

        let moveSpeed = p.boosting && p.score > 15 ? 7.0 : 3.6;
        if (p.speedBoostActive) moveSpeed *= 1.4;
        if (p.skillDash) moveSpeed = 17.0;

        if (p.boosting && p.score > 15) {
            p.score -= 0.1;
            if (p.body.length > 10 && Math.random() < 0.25) p.body.pop();
        }

        // Movimiento
        p.x += Math.cos(p.angle) * moveSpeed;
        p.y += Math.sin(p.angle) * moveSpeed;

        // Limites
        const half = WORLD_SIZE / 2;
        p.x = Math.max(-half, Math.min(half, p.x));
        p.y = Math.max(-half, Math.min(half, p.y));

        // Actualización de Segmentos
        if (p.body.length > 0) {
            p.body[0] = { x: p.x, y: p.y };
            const distBetween = 6;
            for (let i = 1; i < p.body.length; i++) {
                const prev = p.body[i - 1];
                const cur = p.body[i];
                const dx = prev.x - cur.x;
                const dy = prev.y - cur.y;
                const dist = Math.hypot(dx, dy);
                if (dist > distBetween) {
                    const angle = Math.atan2(dy, dx);
                    cur.x = prev.x - Math.cos(angle) * distBetween;
                    cur.y = prev.y - Math.sin(angle) * distBetween;
                }
            }
        }

        const targetLen = Math.floor(15 + p.score * 1.1);
        while (p.body.length < targetLen) {
            const last = p.body[p.body.length - 1] || { x: p.x, y: p.y };
            p.body.push({ x: last.x, y: last.y });
        }

        // Habilidad Imán
        if (p.skillMagnet) {
            foods.forEach(f => {
                if (Math.hypot(p.x - f.x, p.y - f.y) < 280) {
                    f.x += (p.x - f.x) * 0.15;
                    f.y += (p.y - f.y) * 0.15;
                }
            });
        }

        // Colisión con Comida
        foods.forEach((f, fid) => {
            if (Math.hypot(p.x - f.x, p.y - f.y) < 20) {
                const gain = f.value * (p.doubleMassActive ? 2 : 1);
                p.score += gain;
                foods.delete(fid);
            }
        });

        // Colisión con Power-ups
        powerups.forEach((pu, puid) => {
            if (Math.hypot(p.x - pu.x, p.y - pu.y) < 25) {
                if (pu.type === 'SHIELD') { p.shieldActive = true; p.shieldEndTime = now + 7000; }
                if (pu.type === 'DOUBLE_MASS') { p.doubleMassActive = true; p.doubleMassEndTime = now + 10000; }
                if (pu.type === 'SPEED_BOOST') { p.speedBoostActive = true; p.speedBoostEndTime = now + 6000; }
                if (pu.type === 'SUPER_MAGNET') { p.skillMagnet = true; setTimeout(() => p.skillMagnet = false, 4000); }
                powerups.delete(puid);
            }
        });

        // Colisiones entre Jugadores
        if (!p.skillDash && !p.shieldActive) {
            players.forEach((other, otherId) => {
                if (otherId === p.id) return;
                for (let i = 2; i < other.body.length; i++) {
                    const seg = other.body[i];
                    if (Math.hypot(p.x - seg.x, p.y - seg.y) < 13) {
                        dropMass(p);
                        p.dead = true;
                        break;
                    }
                }
            });
        }
    });

    players.forEach((p, id) => { if (p.dead) players.delete(id); });

    const leaderboard = Array.from(players.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({ name: p.name, score: Math.floor(p.score) }));

    const payload = JSON.stringify({
        type: 'STATE',
        players: Array.from(players.values()).map(p => ({
            id: p.id, name: p.name, skin: p.skin, x: p.x, y: p.y,
            angle: p.angle, score: Math.floor(p.score), body: p.body,
            skillDash: p.skillDash, shieldActive: p.shieldActive,
            doubleMassActive: p.doubleMassActive, speedBoostActive: p.speedBoostActive
        })),
        foods: Array.from(foods.values()),
        powerups: Array.from(powerups.values()),
        leaderboard
    });

    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(payload);
    });
}, 25);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(\`Servidor Slither Online en puerto \${PORT}\`));
`
});

// 3. public/index.html
files.push({
    name: "public/index.html",
    content: `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SLITHER ULTRA ONLINE - NEXT GEN</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <canvas id="gameCanvas"></canvas>

    <!-- MENÚ DE INICIO -->
    <div id="login-overlay">
        <div class="glass-card">
            <h1 class="glitch-title">SLITHER ULTRA</h1>
            <p class="subtitle">EDICIÓN MULTIJUGADOR ONLINE</p>
            
            <input type="text" id="nickname" placeholder="TU APODO..." maxlength="14" value="Camarada">
            
            <div class="skin-selector">
                <label>PERSONALIZA TU SKIN SATIRICA:</label>
                <div class="skin-grid">
                    <button class="skin-btn active" data-skin="CAMARADA">CAMARADA ROJO</button>
                    <button class="skin-btn" data-skin="CAPITALISTA">CAPITALISTA ORO</button>
                    <button class="skin-btn" data-skin="DICTADOR">GENERAL RETRO</button>
                    <button class="skin-btn" data-skin="BANQUERO">BANQUERO TENEBROSO</button>
                    <button class="skin-btn" data-skin="POLITICO">POLITICO POPULISTA</button>
                    <button class="skin-btn" data-skin="TOXICO">RESIDUO RADIOACTIVO</button>
                    <button class="skin-btn" data-skin="NEON_CYBER">CYBER GLITCH</button>
                    <button class="skin-btn" data-skin="MATRIX">CODIGO MATRIX</button>
                </div>
            </div>

            <button id="play-btn">ENTRAR AL SERVIDOR</button>
        </div>
    </div>

    <!-- MENÚ DE PAUSA -->
    <div id="pause-overlay" class="hidden">
        <div class="glass-card pause-card">
            <h2>PAUSA DEL JUEGO</h2>
            <p class="pause-warning">LA PARTIDA SIGUE EN VIVO EN SEGUNDO PLANO</p>
            <button id="resume-btn" class="btn-secondary">REANUDAR PARTIDA</button>
            <button id="quit-btn" class="btn-danger">VOLVER AL INICIO</button>
        </div>
    </div>

    <!-- HUD AVANZADO -->
    <div id="hud" class="hidden">
        <div id="pause-hint">PRESIONA [ESC] PARA MENU DE PAUSA</div>

        <div id="leaderboard">
            <div class="lb-header">TOP JUGADORES</div>
            <ol id="lb-list"></ol>
        </div>

        <div id="score-box">
            <span class="label">MASA TOTAL:</span>
            <span id="score-val">0</span>
        </div>

        <div id="buffs-bar"></div>

        <div id="skills-bar">
            <div class="skill-slot" id="skill-dash">
                <span class="key">ESPACIO</span>
                <span class="name">DASH IMPULSO</span>
                <div class="cooldown-overlay" id="cd-dash"></div>
            </div>
            <div class="skill-slot" id="skill-magnet">
                <span class="key">TECLA E</span>
                <span class="name">IMAN GRAVITATORIO</span>
                <div class="cooldown-overlay" id="cd-magnet"></div>
            </div>
        </div>

        <div id="minimap-container">
            <canvas id="minimap" width="150" height="150"></canvas>
            <div class="minimap-title">RADAR TACTICO</div>
        </div>
    </div>

    <script src="app.js"></script>
</body>
</html>
`
});

// 4. public/style.css
files.push({
    name: "public/style.css",
    content: `* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    width: 100vw; height: 100vh; overflow: hidden;
    background-color: #030508;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #fff; user-select: none;
}

#gameCanvas {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;
}

.hidden { display: none !important; }

/* OVERLAYS UI */
#login-overlay, #pause-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(4, 8, 15, 0.82); backdrop-filter: blur(14px);
    display: flex; justify-content: center; align-items: center; z-index: 100;
}

.glass-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.8);
    border-radius: 16px; padding: 30px; width: 420px;
    display: flex; flex-direction: column; gap: 16px; text-align: center;
}

.glitch-title {
    font-size: 30px; font-weight: 900; letter-spacing: 3px;
    background: linear-gradient(45deg, #ff0055, #00f0ff);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}

.subtitle { font-size: 11px; letter-spacing: 2px; color: #888; }

#nickname {
    width: 100%; padding: 12px; background: rgba(0, 0, 0, 0.6);
    border: 1px solid #333; border-radius: 8px; color: #fff;
    font-size: 14px; text-align: center; outline: none;
}
#nickname:focus { border-color: #00f0ff; }

.skin-selector label { font-size: 11px; color: #aaa; display: block; margin-bottom: 8px; }
.skin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; max-height: 180px; overflow-y: auto; }

.skin-btn {
    padding: 8px; background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px;
    color: #ccc; font-size: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;
}
.skin-btn.active, .skin-btn:hover {
    background: rgba(0, 240, 255, 0.2); border-color: #00f0ff; color: #fff;
}

#play-btn, .btn-secondary, .btn-danger {
    padding: 12px; border: none; border-radius: 8px; color: #fff;
    font-weight: bold; font-size: 13px; cursor: pointer; letter-spacing: 1px; transition: 0.2s;
}
#play-btn { background: linear-gradient(90deg, #ff0055, #00f0ff); }
.btn-secondary { background: rgba(0, 240, 255, 0.2); border: 1px solid #00f0ff; }
.btn-danger { background: rgba(255, 0, 85, 0.2); border: 1px solid #ff0055; }
#play-btn:hover, .btn-secondary:hover, .btn-danger:hover { transform: scale(1.02); }

.pause-warning { font-size: 10px; color: #ff0055; letter-spacing: 1px; font-weight: bold; }

/* HUD ELEMENTS */
#hud { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; }

#pause-hint {
    position: absolute; top: 15px; left: 50%; transform: translateX(-50%);
    background: rgba(5, 10, 20, 0.7); border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 6px 14px; border-radius: 20px; font-size: 10px; letter-spacing: 1px; color: #888;
}

#leaderboard {
    position: absolute; top: 20px; right: 20px;
    background: rgba(5, 10, 20, 0.75); border: 1px solid rgba(0, 240, 255, 0.2);
    border-radius: 8px; padding: 12px; width: 190px; backdrop-filter: blur(4px);
}
.lb-header { font-size: 11px; font-weight: bold; color: #00f0ff; margin-bottom: 8px; letter-spacing: 1px; }
#lb-list { font-size: 11px; list-style-position: inside; color: #ddd; }
#lb-list li { margin-bottom: 3px; display: flex; justify-content: space-between; }

#score-box {
    position: absolute; bottom: 20px; left: 20px;
    background: rgba(5, 10, 20, 0.75); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px; padding: 10px 16px; font-size: 12px;
}
#score-box .label { color: #888; margin-right: 6px; }
#score-val { color: #00f0ff; font-weight: bold; font-size: 16px; }

#skills-bar {
    position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 12px; pointer-events: auto;
}
.skill-slot {
    width: 110px; height: 50px; background: rgba(5, 10, 20, 0.8);
    border: 1px solid rgba(0, 240, 255, 0.3); border-radius: 8px;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    position: relative; overflow: hidden;
}
.skill-slot .key { font-size: 9px; color: #00f0ff; font-weight: bold; }
.skill-slot .name { font-size: 8px; color: #aaa; margin-top: 2px; }
.cooldown-overlay {
    position: absolute; bottom: 0; left: 0; width: 100%; height: 0%;
    background: rgba(255, 0, 85, 0.5); transition: height 0.1s linear;
}

#buffs-bar {
    position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px;
}
.buff-tag {
    background: rgba(0, 240, 255, 0.2); border: 1px solid #00f0ff;
    padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: bold; color: #fff;
}

#minimap-container {
    position: absolute; bottom: 20px; right: 20px;
    display: flex; flex-direction: column; align-items: center;
}
#minimap {
    background: rgba(5, 10, 20, 0.85); border: 2px solid rgba(0, 240, 255, 0.4);
    border-radius: 50%; box-shadow: 0 0 10px rgba(0, 240, 255, 0.2);
}
.minimap-title { font-size: 8px; color: #00f0ff; margin-top: 4px; letter-spacing: 1px; font-weight: bold; }
`
});

// 5. public/app.js
files.push({
    name: "public/app.js",
    content: `let canvas, ctx, ws;
let myId = null;
let worldSize = 4500;
let selectedSkin = 'CAMARADA';
let inGame = false;
let isPaused = false;

let gameState = { players: [], foods: [], powerups: [], leaderboard: [] };
let camera = { x: 0, y: 0 };
let mouseAngle = 0;
let isBoosting = false;

let cdDashEnd = 0;
let cdMagnetEnd = 0;

// MOTOR DE EFECTOS DE SONIDO WEB AUDIO API
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function initAudio() {
    if (!audioCtx) audioCtx = new AudioContext();
}

function playEatSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.08);
}

function playPowerupSound() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
}

function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resize();

    window.addEventListener('resize', resize);

    document.querySelectorAll('.skin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedSkin = btn.dataset.skin;
        });
    });

    document.getElementById('play-btn').addEventListener('click', () => {
        initAudio();
        joinGame();
    });

    document.getElementById('resume-btn').addEventListener('click', togglePause);
    document.getElementById('quit-btn').addEventListener('click', quitToMenu);

    window.addEventListener('mousemove', e => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        mouseAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    });

    window.addEventListener('mousedown', () => { if (inGame && !isPaused) isBoosting = true; });
    window.addEventListener('mouseup', () => { isBoosting = false; });

    window.addEventListener('keydown', e => {
        if (e.code === 'Escape' && inGame) {
            togglePause();
        }
        if (inGame && !isPaused) {
            if (e.code === 'Space') triggerSkill('DASH');
            if (e.code === 'KeyE') triggerSkill('MAGNET');
        }
    });

    requestAnimationFrame(renderLoop);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function joinGame() {
    const name = document.getElementById('nickname').value || 'Camarada';
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');

    inGame = true;
    isPaused = false;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(\`\${protocol}//\${location.host}\`);

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'INIT') {
                myId = msg.id;
                worldSize = msg.worldSize;
            }
            if (msg.type === 'STATE') {
                const prevFoodCount = gameState.foods ? gameState.foods.length : 0;
                gameState = msg;
                if (gameState.foods.length < prevFoodCount) playEatSound();
                updateHUD();
            }
        };

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'JOIN', name, skin: selectedSkin }));
        };
    } else {
        ws.send(JSON.stringify({ type: 'JOIN', name, skin: selectedSkin }));
    }

    // Intervalo de entrada
    if (!window.inputInterval) {
        window.inputInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN && inGame && !isPaused) {
                ws.send(JSON.stringify({
                    type: 'INPUT',
                    angle: mouseAngle,
                    boosting: isBoosting
                }));
            }
        }, 33);
    }
}

function togglePause() {
    isPaused = !isPaused;
    const pauseEl = document.getElementById('pause-overlay');
    if (isPaused) {
        pauseEl.classList.remove('hidden');
        isBoosting = false;
    } else {
        pauseEl.classList.add('hidden');
    }
}

function quitToMenu() {
    inGame = false;
    isPaused = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'LEAVE_MATCH' }));
    }
    document.getElementById('pause-overlay').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('login-overlay').classList.remove('hidden');
}

function triggerSkill(skill) {
    const now = Date.now();
    if (skill === 'DASH' && now > cdDashEnd) {
        cdDashEnd = now + 4000;
        ws.send(JSON.stringify({ type: 'SKILL', skill: 'DASH' }));
    }
    if (skill === 'MAGNET' && now > cdMagnetEnd) {
        cdMagnetEnd = now + 8000;
        ws.send(JSON.stringify({ type: 'SKILL', skill: 'MAGNET' }));
    }
}

function updateHUD() {
    const lbEl = document.getElementById('lb-list');
    lbEl.innerHTML = '';
    gameState.leaderboard.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = \`<span>\${p.name}</span><strong>\${p.score}</strong>\`;
        lbEl.appendChild(li);
    });

    const me = gameState.players.find(p => p.id === myId);
    if (me) {
        document.getElementById('score-val').innerText = me.score;
        camera.x += (me.x - camera.x) * 0.1;
        camera.y += (me.y - camera.y) * 0.1;

        // Buffs Activos
        const buffsEl = document.getElementById('buffs-bar');
        buffsEl.innerHTML = '';
        if (me.shieldActive) buffsEl.innerHTML += '<div class="buff-tag">ESCUDO</div>';
        if (me.doubleMassActive) buffsEl.innerHTML += '<div class="buff-tag">DOBLE MASA</div>';
        if (me.speedBoostActive) buffsEl.innerHTML += '<div class="buff-tag">VELOCIDAD</div>';
    }

    const now = Date.now();
    document.getElementById('cd-dash').style.height = Math.max(0, (cdDashEnd - now) / 4000) * 100 + '%';
    document.getElementById('cd-magnet').style.height = Math.max(0, (cdMagnetEnd - now) / 8000) * 100 + '%';

    drawMinimap();
}

function drawMinimap() {
    const mm = document.getElementById('minimap');
    const mctx = mm.getContext('2d');
    mctx.clearRect(0, 0, 150, 150);

    const scale = 150 / worldSize;

    // Fondo radar
    mctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
    mctx.fillRect(0, 0, 150, 150);

    // Power-ups en minimapa
    mctx.fillStyle = '#ffff00';
    gameState.powerups.forEach(pu => {
        const mx = (pu.x + worldSize / 2) * scale;
        const my = (pu.y + worldSize / 2) * scale;
        mctx.fillRect(mx - 1, my - 1, 3, 3);
    });

    // Jugadores
    gameState.players.forEach(p => {
        const mx = (p.x + worldSize / 2) * scale;
        const my = (p.y + worldSize / 2) * scale;
        mctx.fillStyle = p.id === myId ? '#00f0ff' : '#ff0055';
        mctx.beginPath();
        mctx.arc(mx, my, p.id === myId ? 3.5 : 2, 0, Math.PI * 2);
        mctx.fill();
    });
}

function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (inGame) {
        ctx.save();
        ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

        drawGrid();

        // Comida y Orbes de Muerte
        gameState.foods.forEach(f => {
            if (f.isDeathOrb) {
                // Grandes orbes luminosos
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#ff0055';
                ctx.fillStyle = '#ff3377';
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            } else {
                ctx.fillStyle = \`hsl(\${f.color}, 100%, 60%)\`;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Power-ups
        gameState.powerups.forEach(pu => {
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#ffff00';
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(pu.x, pu.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#000';
            ctx.font = 'bold 8px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText(pu.type[0], pu.x, pu.y + 3);
        });

        // Serpientes
        gameState.players.forEach(p => drawSnake(p));

        ctx.restore();
    }

    requestAnimationFrame(renderLoop);
}

function drawGrid() {
    const half = worldSize / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;

    for (let x = -half; x <= half; x += 120) {
        ctx.beginPath(); ctx.moveTo(x, -half); ctx.lineTo(x, half); ctx.stroke();
    }
    for (let y = -half; y <= half; y += 120) {
        ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
    }

    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 8;
    ctx.strokeRect(-half, -half, worldSize, worldSize);
}

function drawSnake(p) {
    if (!p.body || p.body.length === 0) return;

    let primaryColor = '#00f0ff';
    let secondaryColor = '#0055ff';

    if (p.skin === 'CAMARADA') { primaryColor = '#ff0000'; secondaryColor = '#ffcc00'; }
    if (p.skin === 'CAPITALISTA') { primaryColor = '#ffd700'; secondaryColor = '#ffffff'; }
    if (p.skin === 'DICTADOR') { primaryColor = '#4b5320'; secondaryColor = '#111111'; }
    if (p.skin === 'BANQUERO') { primaryColor = '#111111'; secondaryColor = '#333333'; }
    if (p.skin === 'POLITICO') { primaryColor = '#ff8c00'; secondaryColor = '#00008b'; }
    if (p.skin === 'TOXICO') { primaryColor = '#39ff14'; secondaryColor = '#006600'; }
    if (p.skin === 'NEON_CYBER') { primaryColor = '#ff00ff'; secondaryColor = '#00f0ff'; }
    if (p.skin === 'MATRIX') { primaryColor = '#00ff00'; secondaryColor = '#002b00'; }

    // Renderizar cuerpo
    for (let i = p.body.length - 1; i >= 0; i--) {
        const seg = p.body[i];
        const radius = Math.max(8, 14 - (i * 0.04));

        ctx.fillStyle = (i % 2 === 0) ? primaryColor : secondaryColor;
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Escudo visual
        if (p.shieldActive && i === 0) {
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(seg.x, seg.y, radius + 6, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Cabeza
    const head = p.body[0];
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(p.angle);

    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6, -6, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, 6, 4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(7, -6, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7, 6, 2, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    // Apodo
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, head.x, head.y - 22);
}

window.onload = init;
`
});

console.log("Generando archivos del nuevo Slither Ultra Online...");
files.forEach(f => {
    const dir = path.dirname(f.name);
    if (dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f.name, f.content);
    console.log(`[OK] ${f.name}`);
});

createZip(files, "proyecto.zip");
console.log("\n¡Slither Ultra Online empaquetado en 'proyecto.zip'!");