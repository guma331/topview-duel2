const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

const CHARACTERS = {
 flame:{name:"화염",hp:300,speed:2,color:"#ff795c",skills:{
 q:{name:"화염구",desc:"30 피해 + 기절 + 화상",cd:13,type:"projectile",damage:30,speed:390,radius:18,range:520,color:"#ff795c",burn:{damage:4,ticks:5}},
 e:{name:"화염 방사",desc:"8초간 화염 방사",cd:20,type:"area",damage:48,range:145,color:"#ff9a55",duration:8},
 r:{name:"화염 잔상",desc:"이동 경로에 화염 잔상",cd:16,type:"area",damage:50,range:100,color:"#ff573d",duration:10},
 t:{name:"작열 지대",desc:"35 피해 + 넉백, 지속 화염 지대",cd:70,type:"area",damage:105,range:230,color:"#ffd166",duration:13}}},
 wind:{name:"바람",hp:300,speed:2,color:"#8de8d0",skills:{
 q:{name:"질풍",desc:"15초 유체화, 이동속도 증가",cd:20,type:"dash",damage:0,range:80,color:"#8de8d0",duration:15},
 e:{name:"바람날",desc:"넉백과 25 피해",cd:18,type:"projectile",damage:25,speed:520,radius:24,range:420,color:"#a8f5e0"},
 r:{name:"바람 추격",desc:"상대에게 접근하거나 거리를 벌림",cd:1,type:"dash",damage:3,range:90,color:"#75d8c0"},
 t:{name:"소용돌이",desc:"끌어당긴 뒤 최대 100 피해",cd:50,type:"area",damage:100,range:220,color:"#d0fff4"}}},
 earth:{name:"땅",hp:300,speed:2,color:"#c69b68",skills:{
 q:{name:"땅울림",desc:"넉백과 40 피해",cd:15,type:"area",damage:40,range:125,color:"#c69b68"},
 e:{name:"산맥",desc:"벽과 보호막 생성",cd:27,type:"area",damage:0,range:115,color:"#b78a58",duration:14},
 r:{name:"도약 강타",desc:"도약 후 잔상 폭발, 10 피해와 기절",cd:12,type:"dash",damage:10,range:160,color:"#d9b27e"},
 t:{name:"대지진",desc:"4회 범위 공격, 최대 140 피해",cd:70,type:"area",damage:140,range:260,color:"#e0b77e"}}},
 water:{name:"물",hp:300,speed:2,color:"#62bfff",skills:{
 q:{name:"물대포",desc:"거리 비례 피해, 최대 100",cd:12,type:"projectile",damage:100,speed:620,radius:18,range:520,color:"#62bfff"},
 e:{name:"파도",desc:"방향으로 파도를 일으켜 최대 35 피해",cd:13,type:"projectile",damage:35,speed:310,radius:35,range:420,color:"#4d9eff"},
 r:{name:"물웅덩이",desc:"20초 지속 함정",cd:5,type:"area",damage:10,range:95,color:"#347fc9",duration:20},
 t:{name:"대수포",desc:"뒤로 밀려나며 강력한 물대포",cd:65,type:"projectile",damage:175,speed:680,radius:25,range:700,color:"#a2e4ff"}}}
};

const waiting = [];
const rooms = new Map();
const playerRoom = new Map();

function cleanQueue(){ for(let i=waiting.length-1;i>=0;i--) if(!io.sockets.sockets.has(waiting[i])) waiting.splice(i,1); }
function roomState(room){ return {phase:room.phase,players:Object.values(room.players).map(p=>({id:p.id,character:p.character,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,shield:p.shield||0,facing:p.facing}))}; }
function broadcast(room){ io.to(room.id).emit("roomState",roomState(room)); }
function leave(socket){
 const rid=playerRoom.get(socket.id); if(!rid)return;
 playerRoom.delete(socket.id); const room=rooms.get(rid);
 if(room){socket.leave(rid);io.to(rid).emit("opponentLeft");rooms.delete(rid);}
}
function createRoom(a,b){
 const id="duel_"+a.id+"_"+b.id;
 const room={id,phase:"select",players:{},projectiles:[]};
 [a,b].forEach((s,i)=>{room.players[s.id]={id:s.id,character:null,x:i?750:250,y:300,hp:300,maxHp:300,facing:i?Math.PI:0,cooldowns:{},shield:0,statusUntil:0,burnUntil:0};playerRoom.set(s.id,id);s.join(id);s.emit("matched");});
 rooms.set(id,room);broadcast(room);
}
io.on("connection",socket=>{
 socket.on("findMatch",()=>{
  if(playerRoom.has(socket.id))return;cleanQueue();
  const i=waiting.findIndex(id=>id!==socket.id);
  if(i>=0){const other=io.sockets.sockets.get(waiting.splice(i,1)[0]);if(other)createRoom(other,socket);else waiting.push(socket.id);}
  else if(!waiting.includes(socket.id)){waiting.push(socket.id);socket.emit("queueStatus","상대를 찾는 중...");}
 });
 socket.on("cancelMatch",()=>{const i=waiting.indexOf(socket.id);if(i>=0)waiting.splice(i,1);socket.emit("queueStatus","매칭이 취소됐어.");});
 socket.on("chooseCharacter",key=>{
  const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=="select"||!CHARACTERS[key])return;
  const p=room.players[socket.id],c=CHARACTERS[key];p.character=key;p.hp=p.maxHp=c.hp;
  if(Object.values(room.players).every(v=>v.character)){room.phase="game";room.players[Object.keys(room.players)[0]].x=250;room.players[Object.keys(room.players)[1]].x=750;}
  broadcast(room);
 });
 socket.on("move",d=>{
  const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=="game"||!d)return;
  const p=room.players[socket.id];if(!p)return;
  p.x=Math.max(32,Math.min(968,Number(d.x)||p.x));p.y=Math.max(32,Math.min(568,Number(d.y)||p.y));p.facing=Number(d.facing)||0;
  socket.to(room.id).emit("opponentMove",{id:socket.id,x:p.x,y:p.y,facing:p.facing});
 });
 socket.on("attack",d=>{
  const room=rooms.get(playerRoom.get(socket.id));if(!room||room.phase!=="game"||!d)return;
  const p=room.players[socket.id],target=Object.values(room.players).find(v=>v.id!==socket.id);
  if(!p||!target||p.hp<=0||target.hp<=0)return;
  const char=CHARACTERS[p.character],kind=["basic","q","e","r","t"].includes(d.kind)?d.kind:"basic";
  const now=Date.now(),skill=kind==="basic"?({cd:({flame:1.1,wind:.5,earth:1.3,water:1}[p.character]||1),damage:({flame:6,wind:2,earth:10,water:5}[p.character]||5),type:"projectile",speed:560,radius:9,range:500,color:char.color}):char.skills[kind];
  if(!skill||now-(p.cooldowns[kind]||0)<skill.cd*1000)return;
  p.cooldowns[kind]=now;
  const angle=Number(d.angle)||0;
  if(skill.type==="dash"){
    p.x=Math.max(32,Math.min(968,p.x+Math.cos(angle)*skill.range));
    p.y=Math.max(32,Math.min(568,p.y+Math.sin(angle)*skill.range));
    if(Math.hypot(target.x-p.x,target.y-p.y)<52+skill.range*.25)target.hp=Math.max(0,target.hp-skill.damage);
    io.to(room.id).emit("skillEffect",{kind,color:skill.color,x:p.x,y:p.y,angle,range:skill.range,owner:socket.id});
    broadcast(room);
  } else if(skill.type==="area"){
    if(Math.hypot(target.x-p.x,target.y-p.y)<=skill.range)target.hp=Math.max(0,target.hp-skill.damage);
    io.to(room.id).emit("skillEffect",{kind,color:skill.color,x:p.x,y:p.y,range:skill.range,owner:socket.id});
    broadcast(room);
  } else if(skill.type==="target"){
    if(Math.hypot(target.x-p.x,target.y-p.y)<=skill.range)target.hp=Math.max(0,target.hp-skill.damage);
    io.to(room.id).emit("skillEffect",{kind,color:skill.color,x:target.x,y:target.y,range:70,owner:socket.id});
    broadcast(room);
  } else {
    room.projectiles.push({owner:socket.id,x:p.x,y:p.y,vx:Math.cos(angle)*skill.speed,vy:Math.sin(angle)*skill.speed,damage:skill.damage,radius:skill.radius,remaining:skill.range,color:skill.color,kind});
    io.to(room.id).emit("projectile",{owner:socket.id,x:p.x,y:p.y,angle,kind,color:skill.color,speed:skill.speed});
  }
  if(target.hp<=0)io.to(room.id).emit("gameOver",{winner:socket.id});
 });
 socket.on("disconnect",()=>{const i=waiting.indexOf(socket.id);if(i>=0)waiting.splice(i,1);leave(socket);});
});
setInterval(()=>{
 const dt=1/30;
 for(const room of rooms.values()){
  if(room.phase!=="game")continue;let changed=false;
  for(let i=room.projectiles.length-1;i>=0;i--){
   const b=room.projectiles[i],owner=room.players[b.owner],target=Object.values(room.players).find(p=>p.id!==b.owner);
   if(!owner||!target){room.projectiles.splice(i,1);continue;}
   const dx=b.vx*dt,dy=b.vy*dt;b.x+=dx;b.y+=dy;b.remaining-=Math.hypot(dx,dy);
   if(Math.hypot(target.x-b.x,target.y-b.y)<b.radius+18){
    target.hp=Math.max(0,target.hp-b.damage);io.to(room.id).emit("hitEffect",{x:target.x,y:target.y,damage:b.damage,color:b.color});
    room.projectiles.splice(i,1);changed=true;if(target.hp<=0)io.to(room.id).emit("gameOver",{winner:owner.id});
   }else if(b.remaining<=0||b.x<0||b.x>1000||b.y<0||b.y>600)room.projectiles.splice(i,1);
  }
  if(changed)broadcast(room);
 }
},1000/30);
server.listen(PORT,()=>console.log(`TOPVIEW DUEL: http://localhost:${PORT}`));
