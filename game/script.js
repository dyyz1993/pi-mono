const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 480;
canvas.height = 560;

const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const finalScoreEl = document.getElementById('finalScore');
const gameOverEl = document.getElementById('gameOver');
const startScreenEl = document.getElementById('startScreen');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');

let gameRunning = false;
let score = 0;
let lives = 3;
let frameCount = 0;

const player = {
    x: canvas.width / 2 - 25,
    y: canvas.height - 80,
    width: 50,
    height: 50,
    speed: 5,
    color: '#4a9eff'
};

let bullets = [];
let enemies = [];
let enemyBullets = [];
let particles = [];

const keys = {
    left: false,
    right: false,
    space: false
};

document.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'Space') {
        e.preventDefault();
        if (!keys.space && gameRunning) {
            shoot();
        }
        keys.space = true;
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'Space') keys.space = false;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', restartGame);

function startGame() {
    startScreenEl.classList.add('hidden');
    gameRunning = true;
    score = 0;
    lives = 3;
    bullets = [];
    enemies = [];
    enemyBullets = [];
    particles = [];
    player.x = canvas.width / 2 - 25;
    updateUI();
    gameLoop();
}

function restartGame() {
    gameOverEl.classList.add('hidden');
    startGame();
}

function shoot() {
    bullets.push({
        x: player.x + player.width / 2 - 3,
        y: player.y,
        width: 6,
        height: 15,
        speed: 8,
        color: '#ff6b6b'
    });
}

function spawnEnemy() {
    const enemy = {
        x: Math.random() * (canvas.width - 40),
        y: -40,
        width: 40,
        height: 40,
        speed: 2 + Math.random() * 2,
        color: '#50fa7b',
        hp: 1
    };
    enemies.push(enemy);
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 10; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            radius: Math.random() * 4 + 2,
            color: color,
            life: 30
        });
    }
}

function update() {
    if (!gameRunning) return;

    frameCount++;

    if (keys.left && player.x > 0) {
        player.x -= player.speed;
    }
    if (keys.right && player.x < canvas.width - player.width) {
        player.x += player.speed;
    }

    bullets.forEach((bullet, index) => {
        bullet.y -= bullet.speed;
        if (bullet.y < 0) {
            bullets.splice(index, 1);
        }
    });

    if (frameCount % 60 === 0) {
        spawnEnemy();
    }

    enemies.forEach((enemy, enemyIndex) => {
        enemy.y += enemy.speed;

        if (Math.random() < 0.005) {
            enemyBullets.push({
                x: enemy.x + enemy.width / 2 - 4,
                y: enemy.y + enemy.height,
                width: 8,
                height: 12,
                speed: 4,
                color: '#ff79c6'
            });
        }

        if (enemy.y > canvas.height) {
            enemies.splice(enemyIndex, 1);
        }

        bullets.forEach((bullet, bulletIndex) => {
            if (checkCollision(bullet, enemy)) {
                createExplosion(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2, enemy.color);
                enemies.splice(enemyIndex, 1);
                bullets.splice(bulletIndex, 1);
                score += 10;
                updateUI();
            }
        });

        if (checkCollision(player, enemy)) {
            createExplosion(player.x + player.width / 2, player.y + player.height / 2, player.color);
            enemies.splice(enemyIndex, 1);
            lives--;
            updateUI();
            if (lives <= 0) {
                gameOver();
            }
        }
    });

    enemyBullets.forEach((bullet, index) => {
        bullet.y += bullet.speed;
        if (bullet.y > canvas.height) {
            enemyBullets.splice(index, 1);
        }
        if (checkCollision(player, bullet)) {
            createExplosion(player.x + player.width / 2, player.y + player.height / 2, player.color);
            enemyBullets.splice(index, 1);
            lives--;
            updateUI();
            if (lives <= 0) {
                gameOver();
            }
        }
    });

    particles.forEach((particle, index) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life--;
        if (particle.life <= 0) {
            particles.splice(index, 1);
        }
    });
}

function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawPlayer();
    drawBullets();
    drawEnemies();
    drawEnemyBullets();
    drawParticles();
}

function drawPlayer() {
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.moveTo(player.x + player.width / 2, player.y);
    ctx.lineTo(player.x + player.width, player.y + player.height);
    ctx.lineTo(player.x + player.width / 2, player.y + player.height - 10);
    ctx.lineTo(player.x, player.y + player.height);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(player.x + player.width / 2 - 8, player.y + 20, 5, 0, Math.PI * 2);
    ctx.arc(player.x + player.width / 2 + 8, player.y + 20, 5, 0, Math.PI * 2);
    ctx.fill();
}

function drawBullets() {
    bullets.forEach(bullet => {
        ctx.fillStyle = bullet.color;
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });
}

function drawEnemies() {
    enemies.forEach(enemy => {
        ctx.fillStyle = enemy.color;
        ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        
        ctx.fillStyle = '#000';
        ctx.fillRect(enemy.x + 8, enemy.y + 10, 8, 8);
        ctx.fillRect(enemy.x + 24, enemy.y + 10, 8, 8);
        
        ctx.fillStyle = '#fff';
        ctx.fillRect(enemy.x + 10, enemy.y + 12, 4, 4);
        ctx.fillRect(enemy.x + 26, enemy.y + 12, 4, 4);
    });
}

function drawEnemyBullets() {
    enemyBullets.forEach(bullet => {
        ctx.fillStyle = bullet.color;
        ctx.beginPath();
        ctx.arc(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, bullet.width / 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawParticles() {
    particles.forEach(particle => {
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = particle.life / 30;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

function updateUI() {
    scoreEl.textContent = score;
    livesEl.textContent = lives;
}

function gameOver() {
    gameRunning = false;
    finalScoreEl.textContent = score;
    gameOverEl.classList.remove('hidden');
}

function gameLoop() {
    if (gameRunning) {
        update();
        draw();
        requestAnimationFrame(gameLoop);
    }
}

draw();
