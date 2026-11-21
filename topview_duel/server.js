'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 30000 });
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'TOPVIEW DUEL' }));
const PORT = process.env.PORT || 3000;
const W = 1000, H = 600, TICK = 1 / 30, PLAYER_R = 18;

// Tick-based effects use 0.4 seconds per tick unless a skill says otherwise.
const CHARS = {
 flame: { name:'화염술사', color:'#ff7048', hp:300, speed:120, basicCd:1.1, skills:{ q:{name:'화염구',cd:13},e:{name:'화염 방사',cd:20},r:{name:'화염 잔상',cd:16},t:{name:'작열 지대',cd:70} } },
 wind:  { name:'풍술사', color:'#75e0c5', hp:300, speed:120, basicCd:.5, skills:{ q:{name:'질풍',cd:20},e:{name:'바람날',cd:18},r:{name:'바람 추격',cd:1},t:{name:'소용돌이',cd:50} } },
 earth: { name:'대지전사', color:'#c69b68', hp:300, speed:120, basicCd:1.3, skills:{ q:{name:'땅울림',cd:15},e:{name:'산맥',cd:27},r:{name:'도약 강타',cd:12},t:{name:'대지진',cd:70} } },
 water: { name:'수류술사', color:'#62bfff', hp:300, speed:120, basicCd:1, skills:{ q:{name:'물대포',cd:12},e:{name:'파도',cd:13},r:{name:'물웅덩이',cd:5},t:{name:'대수포',cd:65} } }
};
let adminSdk = null, adminDb = null;
try {
  adminSdk = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    adminSdk.initializeApp({ credential: adminSdk.credential.cert(serviceAccount) });
    adminDb = adminSdk.firestore();
    console.log('Firebase Admin connected: secure score writes enabled');
  } else console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set: score writes are disabled');
} catch (e) { console.warn('Firebase Admin unavailable; score writes disabled:', e.message); }

const waiting = [];
const rooms = new Map();
const playerRoom = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const angleTo = (a,b) => Math.atan2(b.y-a.y,b.x-a.x);
const makeId = () => crypto.randomBytes(10).toString('hex');
function addShield(p, amount, seconds) { p.shield = Math.min(150, (p.shield || 0) + amount); p.shieldUntil = Math.max(p.shieldUntil || 0, Date.now() + seconds*1000); }
function damage(target, amount, source, color) {
  if (!target || target.hp <= 0 || target.invulnerableUntil > Date.now()) return 0;
  let left = Math.max(0, amount);
  const absorbed = Math.min(target.shield || 0, left); target.shield -= absorbed; left -= absorbed;
  target.hp = Math.max(0, target.hp-left);
  if (left > 0) target.lastHit = { damage: Math.round(left*10)/10, color: color || '#fff', source };
  return left;
}
function knockback(target, from, power) {
  const a = angleTo(from,target); target.knockVx = Math.cos(a)*power; target.knockVy = Math.sin(a)*power;
}
function addBurn(target, damagePerTick, ticks, interval=.4) {
  target.burns.push({ damage:damagePerTick, left:ticks, next:Date.now()+interval*1000, interval });
}
function addZone(room, zone) {
  zone.id = makeId(); zone.createdAt = Date.now(); zone.hitAt = {}; zone.hitCount = {};
  room.zones.push(zone); return zone;
}
function safePlayer(p) {
  return { id:p.id, character:p.character, x:p.x, y:p.y, hp:p.hp, maxHp:p.maxHp, shield:p.shield||0,
    facing:p.facing||0, stunUntil:p.stunUntil||0, slowUntil:p.slowUntil||0, bindUntil:p.bindUntil||0,
    invulnerableUntil:p.invulnerableUntil||0, buffUntil:p.buffUntil||0, buff:p.buff||null, burns:p.burns.length };
}
function roomState(room) {
  const now=Date.now();
  return { phase:room.phase, startedAt:room.startedAt, players:Object.values(room.players).map(safePlayer),
    projectiles:room.projectiles.map(b=>({id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,character:b.character,kind:b.kind,color:b.color,radius:b.radius})),
    zones:room.zones.map(z=>({id:z.id,type:z.type,x:z.x,y:z.y,angle:z.angle,radius:z.radius||0,maxRadius:z.maxRadius||0,expiresAt:z.expiresAt,owner:z.owner,color:z.color,points:z.points||null})),
    walls:room.walls.map(w=>({id:w.id,x:w.x,y:w.y,angle:w.angle,length:w.length,expiresAt:w.expiresAt,owner:w.owner})), serverTime:now };
}
function broadcast(room) { if(room && !room.closed) io.to(room.id).emit('roomState',roomState(room)); }
function cleanQueue() { for(let i=waiting.length-1;i>=0;i--) if(!io.sockets.sockets.has(waiting[i])) waiting.splice(i,1); }
async function saveResult(room, winnerId, reason) {
  if (room.resultSaved) return; room.resultSaved=true;
  const winner=room.players[winnerId], loser=Object.values(room.players).find(p=>p.id!==winnerId);
  if (!adminDb || !winner || !loser) {
    io.to(room.id).emit('scoreStatus', { ok:false, message:'경기는 종료됐지만 서버의 Firebase Admin 설정이 없어 점수를 저장하지 못했어. Render 환경 변수 설정이 필요해.' });
    return;
  }
  try {
    await Promise.all([[winner,true],[loser,false]].map(async ([p,win])=>{
      if (!p.uid) return;
      const ref=adminDb.collection('players').doc(p.uid);
      await adminDb.runTransaction(async tx=>{
        const snap=await tx.get(ref); const old=snap.exists?snap.data():{};
        tx.set(ref,{ uid:p.uid, nickname:p.nickname||'Player',
          score:Math.max(0,(Number(old.score)||0)+(win?10:-3)),
          wins:(Number(old.wins)||0)+(win?1:0), losses:(Number(old.losses)||0)+(win?0:1),
          updatedAt:new Date(), lastMatchId:room.id },{merge:true});
      });
    }));
    io.to(room.id).emit('scoreStatus',{ok:true,winner:winnerId,reason});
  } catch(e) {
    console.error('Score save failed:',e);
    io.to(room.id).emit('scoreStatus',{ok:false,message:'점수 저장 실패: 서버 Firebase Admin 설정과 Firestore를 확인해줘.'});
  }
}
function finish(room, winnerId, reason='normal') {
  if (!room || room.closed || room.phase==='finished') return;
  room.phase='finished'; room.finishedAt=Date.now(); room.closed=true;
  io.to(room.id).emit('gameOver',{winner:winnerId,reason,matchId:room.id});
  saveResult(room,winnerId,reason);
  broadcast(room);
  setTimeout(()=>{ for(const id of Object.keys(room.players)) playerRoom.delete(id); rooms.delete(room.id); },12000);
}
function createRoom(a,b) {
  const id='duel_'+makeId();
  const room={id,phase:'select',players:{},projectiles:[],zones:[],walls:[],closed:false,resultSaved:false};
  [a,b].forEach((s,i)=>{
    room.players[s.id]={id:s.id,uid:s.data.uid,nickname:s.data.nickname||'Player',character:null,x:i?750:250,y:300,hp:300,maxHp:300,
      shield:0,shieldUntil:0,facing:i?Math.PI:0,input:{x:0,y:0,angle:i?Math.PI:0},cooldowns:{},basicCount:0,burns:[],waveMarks:[],stunUntil:0,slowUntil:0,bindUntil:0,
      invulnerableUntil:0,buffUntil:0,buff:null,knockVx:0,knockVy:0,lastTrailAt:0,trailHits:{},lastHit:null};
    playerRoom.set(s.id,id); s.join(id); s.emit('matched');
  });
  rooms.set(id,room); broadcast(room);
}
function lineBlocked(a,b,wall) {
  const ux=Math.cos(wall.angle),uy=Math.sin(wall.angle),dx=b.x-a.x,dy=b.y-a.y;
  const wx=wall.x,wy=wall.y,den=dx*dx+dy*dy||1,t=clamp(((wx-a.x)*dx+(wy-a.y)*dy)/den,0,1);
  const px=a.x+dx*t,py=a.y+dy*t;
  const along=Math.abs((px-wx)*ux+(py-wy)*uy), across=Math.abs((px-wx)*(-uy)+(py-wy)*ux);
  return along<wall.length/2+8 && across<15;
}
function clearOfWalls(p, room) { return !room.walls.some(w=>Math.abs((p.x-w.x)*(-Math.sin(w.angle))+(p.y-w.y)*Math.cos(w.angle))<PLAYER_R+8 && Math.abs((p.x-w.x)*Math.cos(w.angle)+(p.y-w.y)*Math.sin(w.angle))<w.length/2); }
function spawnProjectile(room,p,kind,angle,opts={}) {
  const speed=opts.speed||560; room.projectiles.push({id:makeId(),owner:p.id,x:p.x+Math.cos(angle)*25,y:p.y+Math.sin(angle)*25,
    vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,speed,angle,travelled:0,maxDistance:opts.range||500,radius:opts.radius||10,
    damage:opts.damage||0,character:p.character,kind,color:opts.color||CHARS[p.character].color,effect:opts.effect||null,createdAt:Date.now(),hitCount:{}});
  io.to(room.id).emit('castEffect',{x:p.x,y:p.y,angle,character:p.character,kind,owner:p.id});
}
function castSkill(room,p,kind,angle) {
  const enemy=Object.values(room.players).find(v=>v.id!==p.id); if(!enemy)return;
  const now=Date.now(),c=p.character,dir={x:Math.cos(angle),y:Math.sin(angle)};
  const cd=kind==='basic'?CHARS[c].basicCd:CHARS[c].skills[kind].cd;
  if(now-(p.cooldowns[kind]||0)<cd*1000)return;
  p.cooldowns[kind]=now;
  io.to(p.id).emit('cooldown',{kind,ms:cd*1000});
  if(kind==='basic') {
    if(c==='flame') spawnProjectile(room,p,kind,angle,{speed:560,range:500,radius:11,damage:0,effect:{burn:{min:2,max:5,ticks:2,interval:.4}}});
    if(c==='wind') { p.basicCount++; spawnProjectile(room,p,kind,angle,{speed:620,range:480,radius:10,damage:p.basicCount%3===0?3:2,effect:{knock:38}}); }
    if(c==='earth') spawnProjectile(room,p,kind,angle,{speed:500,range:430,radius:15,damage:10,effect:{knock:85}});
    if(c==='water') spawnProjectile(room,p,kind,angle,{speed:590,range:500,radius:10,damage:5,effect:{slow:1}});
    return;
  }
  if(c==='flame') {
    if(kind==='q') spawnProjectile(room,p,kind,angle,{speed:390,range:520,radius:18,damage:30,effect:{stun:1.2,burn:{damage:4,ticks:5,interval:.4}}});
    if(kind==='e') { p.buff='flameAura';p.buffUntil=now+8000;addShield(p,10,1.2);addZone(room,{type:'flameAura',owner:p.id,x:p.x,y:p.y,angle,radius:120,duration:8,expiresAt:now+8000,color:'#ff8b35',tickEvery:200,damage:2,maxHits:24,cone:Math.PI*.72}); }
    if(kind==='r') { p.buff='flameTrail';p.buffUntil=now+10000;p.trailHits={};p.trailSkillId=makeId();p.lastTrailAt=0;p.lastTrailX=undefined;p.lastTrailY=undefined; }
    if(kind==='t') { addShield(p,30,2); if(dist(p,enemy)<230){damage(enemy,35,p.id,'#ffb347');knockback(enemy,p,180);} addZone(room,{type:'flameUlt',owner:p.id,x:p.x,y:p.y,angle,radius:230,duration:13,expiresAt:now+13000,color:'#ff542f',tickEvery:400,damage:3,maxHits:35,cone:Math.PI*2,slow:1}); }
  }
  if(c==='wind') {
    if(kind==='q') { p.buff='wind';p.buffUntil=now+15000; }
    if(kind==='e') { addShield(p,15,.8);spawnProjectile(room,p,kind,angle,{speed:520,range:420,radius:22,damage:25,effect:{knock:140,slow:1}}); }
    if(kind==='r') {
      const d=dist(p,enemy),a=angleTo(p,enemy); let move;
      if(d>125) move=65; else if(d<85) move=-65; else move=45;
      p.x=clamp(p.x+Math.cos(a)*move,28,W-28);p.y=clamp(p.y+Math.sin(a)*move,28,H-28);
      if(d<55){damage(enemy,3,p.id,'#b9fff0');addShield(p,5,.2);knockback(enemy,p,45);}
      io.to(room.id).emit('castEffect',{x:p.x,y:p.y,angle:a,character:c,kind,owner:p.id});
    }
    if(kind==='t') { addShield(p,20,2);addZone(room,{type:'vortex',owner:p.id,x:p.x,y:p.y,radius:10,maxRadius:220,duration:3.2,expiresAt:now+3200,color:'#baffef',damage:0}); }
  }
  if(c==='earth') {
    if(kind==='q') { if(dist(p,enemy)<=125){damage(enemy,40,p.id,'#d5ad7c');knockback(enemy,p,180);} addZone(room,{type:'earthBurst',owner:p.id,x:p.x,y:p.y,radius:125,duration:.45,expiresAt:now+450,color:'#c69b68'}); }
    if(kind==='e') { addShield(p,20,2);const wx=p.x+dir.x*95,wy=p.y+dir.y*95;room.walls.push({id:makeId(),owner:p.id,x:wx,y:wy,angle:angle,length:150,expiresAt:now+14000}); }
    if(kind==='r') { const old={x:p.x,y:p.y};p.invulnerableUntil=now+650;p.x=clamp(p.x+dir.x*160,28,W-28);p.y=clamp(p.y+dir.y*160,28,H-28);addShield(p,5,.8);addZone(room,{type:'earthAfterimage',owner:p.id,x:p.x,y:p.y,radius:72,duration:1.5,expiresAt:now+1500,color:'#e4c18e',damage:10,stun:1,knock:120});io.to(room.id).emit('dashTrail',{from:old,to:{x:p.x,y:p.y},character:c}); }
    if(kind==='t') addZone(room,{type:'earthquake',owner:p.id,x:p.x,y:p.y,radius:0,maxRadius:260,duration:2.5,expiresAt:now+2500,color:'#e0b77e',pulse:0,nextPulse:now+100,pulseRadii:[70,130,195,260]});
  }
  if(c==='water') {
    if(kind==='q') { p.slowSelfUntil=now+700;spawnProjectile(room,p,kind,angle,{speed:620,range:420,radius:19,damage:0,effect:{distanceScale:.25,maxDamage:100,slow:1}}); }
    if(kind==='e') spawnProjectile(room,p,kind,angle,{speed:300,range:420,radius:38,damage:0,effect:{wave:true,slow:1,maxTicks:7}});
    if(kind==='r') { const own=room.zones.filter(z=>z.type==='waterTrap'&&z.owner===p.id);if(own.length>=4)room.zones.splice(room.zones.indexOf(own[0]),1);addZone(room,{type:'waterTrap',owner:p.id,x:p.x,y:p.y,radius:24,duration:20,expiresAt:now+20000,color:'#55c7ff',damage:10}); }
    if(kind==='t') { p.x=clamp(p.x-dir.x*48,28,W-28);p.y=clamp(p.y-dir.y*48,28,H-28);addShield(p,40,2);spawnProjectile(room,p,kind,angle,{speed:680,range:560,radius:25,damage:0,effect:{distanceScale:.2,baseDamage:70,minDamage:70,maxDamage:175,slow:1}}); }
  }
}
function applyProjectileHit(room,b,target) {
  let amount=b.damage;
  if(b.effect?.distanceScale) amount=clamp((b.effect.baseDamage||0)+b.travelled*b.effect.distanceScale,b.effect.minDamage||0,b.effect.maxDamage||999);
  if(b.effect?.burn?.min) { const n=b.effect.burn.min+Math.floor(Math.random()*(b.effect.burn.max-b.effect.burn.min+1)); addBurn(target,n,b.effect.burn.ticks,b.effect.burn.interval); }
  const dealt=damage(target,amount,b.owner,b.color);
  if(b.effect?.stun)target.stunUntil=Math.max(target.stunUntil,Date.now()+b.effect.stun*1000);
  if(b.effect?.slow && !(target.buff==='wind'&&target.buffUntil>Date.now()))target.slowUntil=Math.max(target.slowUntil,Date.now()+b.effect.slow*1000);
  if(b.effect?.knock){const owner=room.players[b.owner]||target;knockback(target,owner,b.effect.knock);}
  io.to(room.id).emit('hitEffect',{x:target.x,y:target.y,damage:Math.round(dealt*10)/10,color:b.color,character:b.character});
}
function updateZones(room,now) {
  for(let i=room.zones.length-1;i>=0;i--){const z=room.zones[i];if(now>=z.expiresAt){room.zones.splice(i,1);continue;}
    const owner=room.players[z.owner]; if(z.type==='flameTrail'&&!owner)continue;
    if(z.type==='vortex'){const age=(now-z.createdAt)/1000;z.radius=Math.min(z.maxRadius,age/1.8*z.maxRadius);for(const p of Object.values(room.players)){if(p.id===z.owner||p.hp<=0)continue;const d=dist(z,p);if(d<z.radius+12){const a=angleTo(p,z);p.x=clamp(p.x+Math.cos(a)*75*TICK,28,W-28);p.y=clamp(p.y+Math.sin(a)*75*TICK,28,H-28);}if(d<24&&!z.finalHit){damage(p,age>=1.8?100:80,z.owner,z.color);knockback(p,z,220);z.finalHit=true;}}}
    if(z.type==='earthquake'&&now>=z.nextPulse){z.pulse++;z.nextPulse=now+560;const r=z.pulseRadii[z.pulse-1]||260;z.radius=r;for(const p of Object.values(room.players)){if(p.id===z.owner||p.hp<=0)continue;if(Math.abs(dist(z,p)-r)<38){damage(p,35,z.owner,z.color);knockback(p,z,180);io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:35,color:z.color,character:'earth'});}}if(z.pulse>=4)z.expiresAt=now+300;}
    if(z.type==='waterTrap'){for(const p of Object.values(room.players)){if(p.id===z.owner||p.hp<=0)continue;if(dist(z,p)<z.radius+PLAYER_R){damage(p,10,z.owner,z.color);p.bindUntil=now+2000;knockback(p,z,110);io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:10,color:z.color,character:'water'});room.zones.splice(i,1);break;}}}
    if(z.type==='earthAfterimage'){for(const p of Object.values(room.players)){if(p.id===z.owner||p.hp<=0||z.hit)continue;if(dist(z,p)<z.radius+PLAYER_R){damage(p,z.damage,z.owner,z.color);p.stunUntil=now+z.stun*1000;knockback(p,z,z.knock);addShield(owner,5,.8);z.hit=true;io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:z.damage,color:z.color,character:'earth'});}}}
    if(['flameAura','flameUlt','flameTrail'].includes(z.type)&&now>=(z.nextTick||0)){z.nextTick=now+(z.tickEvery||400);for(const p of Object.values(room.players)){if(p.id===z.owner||p.hp<=0)continue;if(z.type==='flameAura'){const a=angleTo(owner,p),delta=Math.atan2(Math.sin(a-z.angle),Math.cos(a-z.angle));if(dist(owner,p)>z.radius||Math.abs(delta)>z.cone/2)continue;}else if(dist(z,p)>z.radius)continue;
      const count=z.hitCount[p.id]||0;if(count>=(z.maxHits||999))continue;if(z.type==='flameTrail'&&owner){const shared=owner.trailHits[p.id]||0;if(shared>=25)continue;owner.trailHits[p.id]=shared+1;}z.hitCount[p.id]=count+1;damage(p,z.damage,z.owner,z.color);if(z.slow)p.slowUntil=Math.max(p.slowUntil,now+z.slow*1000);io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:z.damage,color:z.color,character:'flame'});
    }}
  }
}
function tickRoom(room,now) {
  if(room.phase!=='game')return;
  for(const p of Object.values(room.players)){
    if(p.hp<=0)continue;
    if(p.shieldUntil&&now>=p.shieldUntil){p.shield=0;p.shieldUntil=0;}
    if(p.buffUntil&&now>=p.buffUntil){p.buff=null;p.buffUntil=0;}
    for(let i=p.burns.length-1;i>=0;i--){const b=p.burns[i];if(now>=b.next){const dealt=damage(p,b.damage,'burn','#ff8148');io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:dealt,color:'#ff8148',character:'flame'});b.left--;b.next+=b.interval*1000;if(b.left<=0)p.burns.splice(i,1);}}
    for(let i=p.waveMarks.length-1;i>=0;i--){const mark=p.waveMarks[i];if(now>=mark.next){const dealt=damage(p,mark.damage,mark.owner,mark.color);io.to(room.id).emit('hitEffect',{x:p.x,y:p.y,damage:dealt,color:mark.color,character:'water'});mark.left--;mark.next+=1000;if(mark.left<=0)p.waveMarks.splice(i,1);}}
    let speed=CHARS[p.character].speed;
    if(p.buff==='wind'&&p.buffUntil>now)speed=204;
    if(p.slowSelfUntil>now)speed*=.65;
    if(p.slowUntil>now&&!(p.buff==='wind'&&p.buffUntil>now))speed*=.65;
    if(p.stunUntil<=now&&p.bindUntil<=now){let ix=p.input.x,iy=p.input.y;const len=Math.hypot(ix,iy)||1;let nx=ix/len,ny=iy/len;
      const ox=p.x,oy=p.y;p.x=clamp(p.x+nx*speed*TICK,PLAYER_R,W-PLAYER_R);p.y=clamp(p.y+ny*speed*TICK,PLAYER_R,H-PLAYER_R);
      for(const w of room.walls){if(!clearOfWalls(p,{walls:[w]})){p.x=ox;p.y=oy;break;}}
    }
    if(Math.abs(p.knockVx)+Math.abs(p.knockVy)>2){const ox=p.x,oy=p.y;p.x=clamp(p.x+p.knockVx*TICK,PLAYER_R,W-PLAYER_R);p.y=clamp(p.y+p.knockVy*TICK,PLAYER_R,H-PLAYER_R);if(!clearOfWalls(p,{walls:room.walls})){p.x=ox;p.y=oy;}p.knockVx*=.84;p.knockVy*=.84;}
    p.facing=p.input.angle;
    if(p.buff==='flameTrail'&&p.buffUntil>now&&now-p.lastTrailAt>140&&(p.lastTrailX===undefined||Math.hypot(p.x-p.lastTrailX,p.y-p.lastTrailY)>10)){addZone(room,{type:'flameTrail',owner:p.id,x:p.x,y:p.y,radius:30,duration:10,expiresAt:now+10000,color:'#ff653d',tickEvery:400,damage:2,maxHits:25,skillId:p.trailSkillId});p.lastTrailAt=now;p.lastTrailX=p.x;p.lastTrailY=p.y;}
  }
  for(let i=room.projectiles.length-1;i>=0;i--){const b=room.projectiles[i],owner=room.players[b.owner],target=Object.values(room.players).find(p=>p.id!==b.owner);if(!owner||!target){room.projectiles.splice(i,1);continue;}
    const dx=b.vx*TICK,dy=b.vy*TICK,nx=b.x+dx,ny=b.y+dy;b.x=nx;b.y=ny;b.travelled+=Math.hypot(dx,dy);
    const blocked=room.walls.some(w=>lineBlocked({x:b.x-dx,y:b.y-dy},b,w));
    if(blocked){room.projectiles.splice(i,1);continue;}
    if(b.effect?.wave&&dist(b,target)<b.radius+PLAYER_R&&!b.hitCount[target.id]){b.hitCount[target.id]=1;target.waveMarks.push({owner:b.owner,left:7,next:now,damage:5,color:b.color});if(!(target.buff==='wind'&&target.buffUntil>now))target.slowUntil=Math.max(target.slowUntil,now+1000);}
    else if(!b.effect?.wave&&dist(b,target)<b.radius+PLAYER_R){applyProjectileHit(room,b,target);room.projectiles.splice(i,1);continue;}
    if(b.travelled>=b.maxDistance||b.x<0||b.x>W||b.y<0||b.y>H)room.projectiles.splice(i,1);
  }
  updateZones(room,now);
  room.walls=room.walls.filter(w=>w.expiresAt>now);
  const dead=Object.values(room.players).find(p=>p.hp<=0);if(dead){const winner=Object.values(room.players).find(p=>p.id!==dead.id);finish(room,winner?.id,'knockout');}
}
io.on('connection',socket=>{
  socket.data.uid=null;
  socket.on('authenticate',async ({token}={})=>{
    try{if(!adminDb){ // Firebase Admin verifies Firebase ID tokens on the server.
        socket.emit('authStatus',{ok:false,message:'서버 인증 검증이 아직 설정되지 않았어. Render에 Firebase Admin 서비스 계정 환경 변수를 등록해야 해.'});return;
      }
      const decoded=await adminSdk.auth().verifyIdToken(token);socket.data.uid=decoded.uid;socket.data.nickname=decoded.name||decoded.email||'Player';
      socket.emit('authStatus',{ok:true,uid:decoded.uid});
    }catch(e){socket.data.uid=null;socket.emit('authStatus',{ok:false,message:'로그인 토큰 확인 실패. 다시 로그인해줘.'});}
  });
  socket.on('findMatch',()=>{
    if(!socket.data.uid){socket.emit('queueStatus','먼저 Google 로그인을 해줘.');return;}
    if(playerRoom.has(socket.id))return;cleanQueue();
    const i=waiting.findIndex(id=>id!==socket.id);
    if(i>=0){const other=io.sockets.sockets.get(waiting.splice(i,1)[0]);if(other)createRoom(other,socket);else waiting.push(socket.id);}
    else if(!waiting.includes(socket.id)){waiting.push(socket.id);socket.emit('queueStatus','상대를 찾는 중...');}
  });
  socket.on('cancelMatch',()=>{const i=waiting.indexOf(socket.id);if(i>=0)waiting.splice(i,1);socket.emit('queueStatus','매칭이 취소됐어.');});
  socket.on('chooseCharacter',key=>{const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=='select'||!CHARS[key])return;const p=room.players[socket.id];p.character=key;p.hp=p.maxHp=300;if(Object.values(room.players).every(v=>v.character)){room.phase='game';room.startedAt=Date.now();room.players[Object.keys(room.players)[0]].x=250;room.players[Object.keys(room.players)[1]].x=750;}broadcast(room);});
  socket.on('input',d=>{const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=='game'||!d)return;const p=room.players[socket.id];if(!p)return;p.input={x:clamp(Number(d.x)||0,-1,1),y:clamp(Number(d.y)||0,-1,1),angle:Number.isFinite(d.angle)?d.angle:0};});
  socket.on('attack',d=>{const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=='game'||!d)return;const p=room.players[socket.id];if(!p||p.hp<=0||p.stunUntil>Date.now()||p.bindUntil>Date.now())return;const kind=['basic','q','e','r','t'].includes(d.kind)?d.kind:null;if(!kind)return;const angle=clamp(Number(d.angle)||0,-Math.PI*4,Math.PI*4);castSkill(room,p,kind,angle);broadcast(room);});
  socket.on('disconnect',()=>{const i=waiting.indexOf(socket.id);if(i>=0)waiting.splice(i,1);const rid=playerRoom.get(socket.id);if(!rid)return;const room=rooms.get(rid);if(room&&!room.closed){const other=Object.values(room.players).find(p=>p.id!==socket.id);if(room.phase==='game'&&other)finish(room,other.id,'disconnect');else{room.closed=true;io.to(rid).emit('opponentLeft');rooms.delete(rid);}}playerRoom.delete(socket.id);});
});
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){if(room.phase==='game'&&!room.closed)tickRoom(room,now);if(room.phase==='game'&&!room.closed&&now-(room.lastBroadcastAt||0)>=100){room.lastBroadcastAt=now;broadcast(room);}}},1000/30);
server.listen(PORT,()=>console.log(`TOPVIEW DUEL listening on ${PORT}`));
