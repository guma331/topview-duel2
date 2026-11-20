const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;

const CHARACTERS = {
  flame: { name:"화염술사", hp:100, speed:165, color:"#ff795c",
    skills:{
      q:{name:"화염구",desc:"마우스 방향으로 폭발하는 화염구를 발사한다.",cd:3.5,type:"projectile",damage:18,speed:390,radius:15,range:520,color:"#ff795c"},
      e:{name:"불꽃 돌진",desc:"조준 방향으로 빠르게 이동하며 주변 적에게 피해를 준다.",cd:7,type:"dash",damage:15,range:105,color:"#ff9a55"},
      r:{name:"작열",desc:"주변 넓은 범위에 화염 폭발을 일으킨다.",cd:9,type:"area",damage:22,range:125,color:"#ff573d"},
      t:{name:"태양 폭발",desc:"강력한 대형 화염구를 발사한다.",cd:18,type:"projectile",damage:42,speed:330,radius:25,range:650,color:"#ffd166"}
    }},
  blade: { name:"검사", hp:125, speed:175, color:"#dce4f2",
    skills:{
      q:{name:"검기",desc:"전방으로 빠른 검기를 날린다.",cd:3,type:"projectile",damage:17,speed:520,radius:11,range:440,color:"#e8f1ff"},
      e:{name:"섬광 베기",desc:"조준 방향으로 돌진하며 가까운 적을 베어낸다.",cd:6,type:"dash",damage:24,range:125,color:"#c7d7ff"},
      r:{name:"회전 베기",desc:"자신을 중심으로 원형 검격을 펼친다.",cd:8,type:"area",damage:25,range:115,color:"#a9c5ff"},
      t:{name:"천공의 일격",desc:"긴 사거리의 거대한 검기를 발사한다.",cd:17,type:"projectile",damage:40,speed:430,radius:23,range:620,color:"#ffffff"}
    }},
  volt: { name:"전격술사", hp:92, speed:185, color:"#f5dc62",
    skills:{
      q:{name:"번개 화살",desc:"빠르고 날카로운 전격 투사체를 발사한다.",cd:2.8,type:"projectile",damage:15,speed:610,radius:9,range:560,color:"#fff07a"},
      e:{name:"전광석화",desc:"조준 방향으로 짧게 순간 이동하고 주변을 감전시킨다.",cd:6.5,type:"dash",damage:18,range:135,color:"#ffe76b"},
      r:{name:"전류 방출",desc:"주변 적에게 전류를 방출한다.",cd:9,type:"area",damage:20,range:145,color:"#f5dc62"},
      t:{name:"낙뢰",desc:"상대 위치에 강력한 번개를 떨어뜨린다.",cd:18,type:"target",damage:43,range:620,color:"#fff4a3"}
    }},
  frost: { name:"빙결술사", hp:108, speed:155, color:"#72d9ff",
    skills:{
      q:{name:"얼음 파편",desc:"마우스 방향으로 얼음 파편을 발사한다.",cd:3,type:"projectile",damage:17,speed:440,radius:13,range:500,color:"#8be6ff"},
      e:{name:"빙결 파동",desc:"자신 주변에 얼음 파동을 일으킨다.",cd:7,type:"area",damage:16,range:135,color:"#8be6ff"},
      r:{name:"서리 돌진",desc:"조준 방향으로 미끄러지듯 돌진하며 피해를 준다.",cd:8,type:"dash",damage:21,range:145,color:"#b8f3ff"},
      t:{name:"빙하 창",desc:"느리지만 강력한 거대 얼음 창을 발사한다.",cd:18,type:"projectile",damage:44,speed:300,radius:25,range:650,color:"#d2f8ff"}
    }}
};

const waiting = [];
const rooms = new Map();
const playerRoom = new Map();

function cleanQueue(){ for(let i=waiting.length-1;i>=0;i--) if(!io.sockets.sockets.has(waiting[i])) waiting.splice(i,1); }
function roomState(room){ return {phase:room.phase,players:Object.values(room.players).map(p=>({id:p.id,character:p.character,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,facing:p.facing}))}; }
function broadcast(room){ io.to(room.id).emit("roomState",roomState(room)); }
function leave(socket){
 const rid=playerRoom.get(socket.id); if(!rid)return;
 playerRoom.delete(socket.id); const room=rooms.get(rid);
 if(room){socket.leave(rid);io.to(rid).emit("opponentLeft");rooms.delete(rid);}
}
function createRoom(a,b){
 const id="duel_"+a.id+"_"+b.id;
 const room={id,phase:"select",players:{},projectiles:[]};
 [a,b].forEach((s,i)=>{room.players[s.id]={id:s.id,character:null,x:i?750:250,y:300,hp:100,maxHp:100,facing:i?Math.PI:0,cooldowns:{}};playerRoom.set(s.id,id);s.join(id);s.emit("matched");});
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
  const now=Date.now(),skill=kind==="basic"?{cd:.42,damage:7,type:"projectile",speed:560,radius:7,range:500,color:"#f2f4ff"}:char.skills[kind];
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
