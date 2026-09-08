const express = require('express');
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
server.listen(PORT, '0.0.0.0', () => console.log(`Servidor Slither Online en puerto ${PORT}`));
