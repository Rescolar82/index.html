const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const W = 960, H = 540;
const LANES = [-1, 0, 1];        // -1 left, 0 mid, 1 right
const LANE_X = i => W/2 + i * 180;

let state = 'menu'; // 'menu' | 'play' | 'over'
let score = 0, best = Number(localStorage.getItem('rr_best')||0);
let mult = 1, stars = 0;

const player = {
  lane: 0,
  x: LANE_X(0),
  y: H - 110,
  targetX: LANE_X(0),
  vy: 0,
  w: 70, h: 90,
  onGround: true,
  inv: 0
};

const grav = 2200, jumpV = -900;
const objs = []; // falling and crossing objects
let tSpawn = 0, spawnMS = 900;
let gameTime = 0;

const keys = { left:false, right:false, jump:false };
let deferredFS = null;

// --- helpers ---
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function now(){ return performance.now(); }
function rand(a,b){ return a + Math.random()*(b-a); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// --- minimalist audio (WebAudio beeps) ---
let AC=null; function ac(){ return AC||(AC=new (window.AudioContext||window.webkitAudioContext)()); }
function sfx(freq,dur=0.12,type='square',vol=0.06){
  try{
    const A=ac(), o=A.createOscillator(), g=A.createGain();
    o.type=type; o.frequency.value=freq; g.gain.value=vol;
    o.connect(g).connect(A.destination); o.start(); o.stop(A.currentTime+dur);
  }catch{}
}
const snd = {
  coin: ()=>sfx(880, .11, 'square', .05),
  hit:  ()=>sfx(160, .2, 'sawtooth', .07),
  jump: ()=>sfx(520, .1, 'triangle', .05)
};

// --- input ---
window.addEventListener('keydown', e=>{
  if (e.key==='ArrowLeft'||e.key==='a') keys.left = true;
  if (e.key==='ArrowRight'||e.key==='d') keys.right= true;
  if (e.code==='Space'||e.key==='w'||e.key==='ArrowUp'){ keys.jump = true; if(state==='play') doJump(); }
});
window.addEventListener('keyup', e=>{
  if (e.key==='ArrowLeft'||e.key==='a') keys.left = false;
  if (e.key==='ArrowRight'||e.key==='d') keys.right= false;
  if (e.code==='Space'||e.key==='w'||e.key==='ArrowUp') keys.jump = false;
});

// Mobile buttons
const btnL = document.getElementById('btnLeft');
const btnR = document.getElementById('btnRight');
const btnJ = document.getElementById('btnJump');
btnL?.addEventListener('pointerdown', ()=> laneDelta(-1));
btnR?.addEventListener('pointerdown', ()=> laneDelta(+1));
btnJ?.addEventListener('pointerdown', ()=> doJump());

// Swipe
let touchStart=null;
canvas.addEventListener('touchstart', e=>{ touchStart = e.changedTouches[0]; });
canvas.addEventListener('touchend', e=>{
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.clientX;
  const dy = t.clientY - touchStart.clientY;
  if (Math.abs(dx) > Math.abs(dy)){
    if (dx > 30) laneDelta(+1);
    if (dx < -30) laneDelta(-1);
  } else {
    if (dy < -30) doJump();
  }
  touchStart=null;
});

// Fullscreen
document.getElementById('btnFull')?.addEventListener('click', async ()=>{
  const wrap = document.getElementById('gameWrap');
  try{
    if (!document.fullscreenElement && wrap.requestFullscreen) await wrap.requestFullscreen({ navigationUI:'hide' });
    else if (document.exitFullscreen) await document.exitFullscreen();
  }catch{}
  document.body.classList.toggle('immersive', !!document.fullscreenElement);
});

// UI buttons
document.getElementById('btnStart')?.addEventListener('click', ()=> startGame(true));
document.getElementById('btnHow')?.addEventListener('click', ()=>{
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('overlayHow').classList.remove('hidden');
});
document.getElementById('btnBack')?.addEventListener('click', ()=>{
  document.getElementById('overlayHow').classList.add('hidden');
  document.getElementById('overlay').classList.remove('hidden');
});
document.getElementById('btnRetry')?.addEventListener('click', ()=> startGame(false));
document.getElementById('btnHome')?.addEventListener('click', ()=>{
  state='menu'; showOverlay('Raccoon Rush','Listo para empezar');
});

// --- core ---
function reset(){
  objs.length=0; score=0; mult=1; stars=0; gameTime=0; spawnMS=900;
  player.lane=0; player.x=LANE_X(0); player.targetX=player.x; player.y=H-110;
  player.vy=0; player.onGround=true; player.inv=0;
}

function startGame(fromMenu){
  reset(); state='play';
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('overlayHow').classList.add('hidden');
  document.getElementById('overlayGameOver').classList.add('hidden');
  ac().resume?.();
}

function gameOver(){
  state='over';
  best=Math.max(best, Math.floor(score));
  localStorage.setItem('rr_best', String(best));
  const ov = document.getElementById('overlayGameOver');
  ov.querySelector('#ov-score').textContent = `Puntos: ${Math.floor(score)} — Mejor: ${best}`;
  ov.classList.remove('hidden');
}

function laneDelta(d){
  if (state!=='play') return;
  player.lane = clamp(player.lane + d, -1, +1);
  player.targetX = LANE_X(player.lane);
}

function doJump(){
  if (state!=='play') return;
  if (player.onGround){
    player.vy = jumpV;
    player.onGround = false;
    snd.jump();
  }
}

function spawn(){
  const r = Math.random();
  if (r < 0.65){
    // falling obstacle or star in a lane
    const lane = pick(LANES);
    const type = Math.random()<0.78 ? 'obs' : 'star';
    objs.push({
      kind: type, lane, x:LANE_X(lane), y:-40,
      vy: rand(240, 340), r: 28
    });
  } else {
    // crossing cat
    const dir = Math.random()<0.5 ? -1 : 1;
    objs.push({
      kind:'cat', x: dir===-1? (W+60):(-60), y: H-96,
      vx: dir * rand(120, 160), w: 100, h:50, dir
    });
  }
}

// drawing helpers (flat shapes -> clean look, easy to reskin later)
function drawBG(){
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#0a1222'); g.addColorStop(1,'#152238');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // road lanes
  ctx.strokeStyle='#ffffff15'; ctx.lineWidth=2;
  [-0.5,0.5].forEach(i=>{
    const x = W/2 + i*180*2;
    ctx.beginPath(); ctx.moveTo(x, H*0.15); ctx.lineTo(x, H); ctx.stroke();
  });

  // ground
  ctx.fillStyle='#0c172a'; ctx.fillRect(0, H-80, W, 80);
}

function drawPlayer(){
  // body
  const t = now()/300;
  const bob = Math.sin(t)*2;
  ctx.save();
  ctx.translate(player.x, player.y + bob);
  // shadow
  ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0,40,26,10,0,0,Math.PI*2); ctx.fill();
  // board
  ctx.fillStyle='#10b981'; ctx.fillRect(-26,20,52,8);
  // body
  ctx.fillStyle='#cbd5e1'; roundRect(-22,-36,44,56,10);
  // mask stripe
  ctx.fillStyle='#0b1220'; ctx.fillRect(-22,-18,44,12);
  // face
  ctx.fillStyle='#e2e8f0'; roundRect(-18,-32,36,20,8);
  // ears
  ctx.fillStyle='#94a3b8'; ctx.beginPath(); ctx.moveTo(-22,-36); ctx.lineTo(-6,-52); ctx.lineTo(0,-36); ctx.fill();
  ctx.beginPath(); ctx.moveTo(22,-36); ctx.lineTo(6,-52); ctx.lineTo(0,-36); ctx.fill();
  // eye glints
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-8,-22,2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(8,-22,2,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawCat(o){
  ctx.save(); ctx.translate(o.x, o.y);
  ctx.fillStyle='#f59e0b';
  roundRect(-o.w/2,-o.h/2,o.w,o.h,12);
  // ears
  ctx.fillStyle='#d97706';
  ctx.beginPath(); ctx.moveTo(-o.w/2+10,-o.h/2); ctx.lineTo(-o.w/2+30,-o.h/2-18); ctx.lineTo(-o.w/2+40,-o.h/2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(o.w/2-10,-o.h/2); ctx.lineTo(o.w/2-30,-o.h/2-18); ctx.lineTo(o.w/2-40,-o.h/2); ctx.fill();
  ctx.restore();
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  ctx.fill();
}

function drawObj(o){
  if (o.kind==='obs'){
    // crate / nes block
    ctx.save(); ctx.translate(o.x,o.y);
    ctx.fillStyle='#4b5563'; roundRect(-26,-26,52,52,8);
    ctx.strokeStyle='#9ca3af'; ctx.strokeRect(-26,-26,52,52);
    ctx.restore();
  } else if (o.kind==='star'){
    ctx.save(); ctx.translate(o.x,o.y);
    ctx.fillStyle='#ffd640'; ctx.beginPath();
    const R=20, r=9;
    for(let i=0;i<10;i++){
      const ang=-Math.PI/2 + i*Math.PI/5;
      const rad=(i%2===0)?R:r; const px=Math.cos(ang)*rad, py=Math.sin(ang)*rad;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  } else if (o.kind==='cat'){
    drawCat(o);
  }
}

// --- update loop ---
let last = 0;
function loop(ts){
  if (!last) last = ts;
  const dt = Math.min(0.033, (ts-last)/1000); last = ts;
  ctx.clearRect(0,0,W,H);
  drawBG();

  if (state==='menu'){
    drawPlayer();
    requestAnimationFrame(loop);
    return;
  }

  if (state==='play'){
    gameTime += dt;
    // ramp difficulty
    spawnMS = Math.max(420, 900 - gameTime*40);

    // move towards lane
    player.x += (player.targetX - player.x) * Math.min(1, dt*8);

    // jump physics
    if (!player.onGround){
      player.vy += grav*dt; player.y += player.vy*dt;
      if (player.y >= H-110){ player.y = H-110; player.vy=0; player.onGround=true; }
    }

    // spawn
    tSpawn += dt*1000;
    if (tSpawn > spawnMS){ spawn(); tSpawn = 0; }

    // update objs
    for (let i=objs.length-1;i>=0;i--){
      const o = objs[i];
      if (o.kind==='cat'){ o.x += o.vx*dt; if (o.x<-120 || o.x>W+120) { objs.splice(i,1); continue; } }
      else { o.y += o.vy*dt; if (o.y > H+60){ objs.splice(i,1); continue; } }

      // collision
      if (o.kind==='cat'){
        const dx = Math.abs(o.x - player.x), dy = Math.abs(o.y - player.y);
        if (dx < (o.w/2 + player.w*0.3) && dy < (o.h/2 + player.h*0.3)){
          if (player.inv<=0){ snd.hit(); return gameOver(); }
        }
      } else if (o.kind==='obs'){
        const dx = Math.abs(o.x - player.x), dy = Math.abs(o.y - player.y);
        if (dx < 36 && dy < 36){
          if (player.inv<=0){ snd.hit(); return gameOver(); }
        }
      } else if (o.kind==='star'){
        const dx = Math.abs(o.x - player.x), dy = Math.abs(o.y - player.y);
        if (dx < 36 && dy < 36){
          snd.coin(); stars++; mult = Math.min(3, 1 + stars*0.1);
          score += 50*mult; objs.splice(i,1); continue;
        }
      }
    }

    // score
    score += dt * 20 * mult;

    // invulnerability timer
    if (player.inv>0) player.inv -= dt;

    // draw
    drawPlayer();
    objs.forEach(drawObj);

    // HUD
    document.getElementById('hud-left').textContent = 'Puntos: ' + Math.floor(score);
    document.getElementById('hud-mid').textContent  = 'x' + mult.toFixed(1);
    document.getElementById('hud-right').textContent= '🏆 ' + best;

    requestAnimationFrame(loop);
    return;
  }

  if (state==='over'){
    drawPlayer();
    objs.forEach(drawObj);
    requestAnimationFrame(loop);
  }
}

// overlays
function showOverlay(title,sub){
  const ov = document.getElementById('overlay');
  ov.querySelector('#ov-title').textContent = title;
  ov.querySelector('#ov-sub').textContent = sub || '';
  ov.classList.remove('hidden');
}

function resize(){
  // make canvas CSS fill its parent with correct ratio (we already use aspect-ratio via CSS)
  // here we only ensure it redraws crisp after DPR changes.
  const dpr = Math.min(window.devicePixelRatio||1,2);
  canvas.width = W*dpr; canvas.height = H*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

window.addEventListener('resize', resize, {passive:true});

// start
resize();
state='menu';
showOverlay('Raccoon Rush','Listo para empezar');
requestAnimationFrame(loop);
