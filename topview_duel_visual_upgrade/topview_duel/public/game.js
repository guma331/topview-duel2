const socket=io(),$=id=>document.getElementById(id),screens=["lobby","select","game"];
function show(id){screens.forEach(s=>$(s).classList.toggle("active",s===id));}
const chars={
 flame:{name:"화염술사",emoji:"🔥",desc:"화상과 지속 피해로 압박하는 원거리형",color:"#ff795c",hp:300,speed:120,skills:{q:["화염구","적중 시 화상 효과",13],e:["화염 방사","주변에 지속 화염",20],r:["화염 잔상","이동 경로에 화염 잔상",16],t:["작열 지대","넓은 범위에 지속 화염",70]}},
 wind:{name:"풍술사",emoji:"🌪️",desc:"빠른 기동력과 넉백, 끌어당김",color:"#8de8d0",hp:300,speed:120,skills:{q:["질풍","유체화 상태로 이동속도 증가",20],e:["바람날","전방으로 바람날 발사",18],r:["바람 추격","상황에 따라 접근 및 후퇴",1],t:["소용돌이","적을 끌어당기는 회오리",50]}},
 earth:{name:"대지전사",emoji:"🪨",desc:"강한 한방과 방어, 범위 공격",color:"#c69b68",hp:300,speed:120,skills:{q:["땅울림","넉백을 주는 지면 공격",15],e:["산맥","전장에 벽 생성",27],r:["도약 강타","도약 후 잔상 공격",12],t:["대지진","4회에 걸친 광역 지진",70]}},
 water:{name:"수류술사",emoji:"💧",desc:"거리 비례 피해와 둔화, 함정",color:"#62bfff",hp:300,speed:120,skills:{q:["물대포","거리에 비례하는 강력한 공격",12],e:["파도","전방으로 파도 발사",13],r:["물웅덩이","밟으면 발동하는 함정",5],t:["대수포","뒤로 밀려나며 강력한 물대포",65]}}
};
let myId=null,room=null,myChar=null,selected=null,started=false,players={},projectiles=[],effects=[],keys={},mouse={x:500,y:300},lastSend=0;
let local={x:250,y:300,facing:0},cooldowns={};
const canvas=$("arena"),ctx=canvas.getContext("2d");

// Firebase Auth + Firestore (firebase-config.js에 콘솔 설정을 입력하면 활성화)
let firebaseUser=null,db=null;
let playerStats={score:0,wins:0,losses:0};
function paintStats(){ $("scoreValue").textContent=playerStats.score??0; $("winsValue").textContent=playerStats.wins??0; $("lossesValue").textContent=playerStats.losses??0; }
async function loadPlayerStats(){ if(!firebaseUser||!db){playerStats={score:0,wins:0,losses:0};paintStats();return;} try{const snap=await db.collection("players").doc(firebaseUser.uid).get();playerStats=snap.exists?{score:snap.data().score||0,wins:snap.data().wins||0,losses:snap.data().losses||0}:{score:0,wins:0,losses:0};paintStats();}catch(e){console.warn("점수 불러오기 실패",e);$("scoreValue").textContent="오류";} }
function initFirebase(){
 const cfg=window.FIREBASE_CONFIG;
 if(!cfg||!cfg.apiKey||String(cfg.apiKey).startsWith("여기에")){$("authStatus").textContent="Firebase 설정 전: 로그인 기능을 사용하려면 firebase-config.js를 설정해줘.";return;}
 try{
  firebase.initializeApp(cfg);const auth=firebase.auth();db=firebase.firestore();
  auth.onAuthStateChanged(async user=>{
   firebaseUser=user;
   await loadPlayerStats();
   $("authStatus").textContent=user?`${user.displayName||user.email} 로그인됨`:"로그인이 필요해.";
   $("loginBtn").textContent=user?"로그아웃":"Google 로그인";
   $("matchBtn").disabled=!user||!socket.connected;
  });
  $("loginBtn").onclick=async()=>{
   try{if(auth.currentUser){await auth.signOut();return;}
    const provider=new firebase.auth.GoogleAuthProvider();await auth.signInWithPopup(provider);
   }catch(e){$("authStatus").textContent="로그인 오류: "+e.message;}
  };
 }catch(e){$("authStatus").textContent="Firebase 초기화 오류: "+e.message;}
}
async function saveMatchResult(win){
 if(!firebaseUser||!db)return;
 try{
  const ref=db.collection("players").doc(firebaseUser.uid);
  await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),old=snap.exists?snap.data():{};
   const next={uid:firebaseUser.uid,nickname:firebaseUser.displayName||firebaseUser.email,
    score:Math.max(0,(old.score||0)+(win?10:-3)),wins:(old.wins||0)+(win?1:0),
    losses:(old.losses||0)+(win?0:1),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
   tx.set(ref,next,{merge:true}); playerStats={score:next.score,wins:next.wins,losses:next.losses};
  });
  paintStats();
  $("resultText").textContent += ` · 현재 점수 ${playerStats.score}점`;
 }catch(e){console.error(e);$("resultText").textContent+=" (점수 저장 실패: Firestore 규칙을 확인해줘)";}
}
initFirebase();

socket.on("connect",()=>{myId=socket.id;$("status").textContent="서버 연결 완료. 대전 상대를 찾아보자.";$("matchBtn").disabled=!!window.FIREBASE_CONFIG?.apiKey&&!firebaseUser;});
socket.on("connect_error",()=>{$("status").textContent="서버 연결 실패. 서버가 실행 중인지 확인해줘.";});
$("matchBtn").onclick=()=>{socket.emit("findMatch");$("matchBtn").disabled=true;$("cancelBtn").disabled=false;$("status").textContent="상대를 찾는 중...";};
$("cancelBtn").onclick=()=>{socket.emit("cancelMatch");$("matchBtn").disabled=false;$("cancelBtn").disabled=true;};
socket.on("queueStatus",m=>{$("status").textContent=m;$("matchBtn").disabled=false;$("cancelBtn").disabled=true;});
socket.on("matched",()=>{show("select");$("status").textContent="매칭 성공";});
function buildCards(){for(const [key,c] of Object.entries(chars)){const el=document.createElement("div");el.className="card";el.innerHTML=`<div class="avatar" style="--c:${c.color}">${c.emoji}</div><b>${c.name}</b><small>${c.desc}<br>체력 ${c.hp} · 이동속도 ${c.speed}</small>`;el.onclick=()=>{selected=key;document.querySelectorAll(".card").forEach(n=>n.classList.toggle("selected",n===el));$("confirmBtn").disabled=false;$("selectStatus").textContent=c.name+" 선택됨";};$("cards").appendChild(el);}}
buildCards();
$("confirmBtn").onclick=()=>{if(!selected)return;myChar=selected;socket.emit("chooseCharacter",selected);$("confirmBtn").disabled=true;$("selectStatus").textContent="상대의 선택을 기다리는 중...";};
socket.on("roomState",state=>{room=state;players={};state.players.forEach(p=>players[p.id]=p);const mine=players[myId],enemy=state.players.find(p=>p.id!==myId);if(mine&&mine.character){myChar=mine.character;local.x=mine.x;local.y=mine.y;}if(state.phase==="game"&&!started){started=true;show("game");$("myName").textContent=chars[myChar].name;$("enemyName").textContent=enemy?chars[enemy.character].name:"상대";makeSkills();}updateHud();});
socket.on("opponentMove",p=>{if(players[p.id])Object.assign(players[p.id],p);});
socket.on("projectile",p=>{projectiles.push({x:p.x,y:p.y,angle:p.angle,vx:Math.cos(p.angle)*p.speed,vy:Math.sin(p.angle)*p.speed,kind:p.kind,character:p.character,color:p.color,life:1.5});});
socket.on("skillEffect",e=>effects.push({...e,life:.55}));
socket.on("hitEffect",e=>effects.push({...e,life:.5,damage:e.damage,hit:true}));
socket.on("opponentLeft",()=>showResult("상대 연결 종료","상대가 게임을 나갔어."));
socket.on("gameOver",async d=>{const win=d.winner===myId;burstVictory(win);showResult(win?"승리!":"패배",win?"승점 +10":"승점 -3");await saveMatchResult(win);});
function showResult(title,msg){$("resultTitle").textContent=title;$("resultText").textContent=msg;$("result").className=title.includes("승리")?"win":"lose";$("result").style.display="flex";}
let celebration=[];function burstVictory(win){if(!win)return;for(let i=0;i<100;i++)celebration.push({x:canvas.width/2,y:canvas.height/2,vx:(Math.random()-.5)*650,vy:-Math.random()*550-80,life:1.8+Math.random()*1.4,color:["#ffe27a","#ff8e72","#8de8d0","#9fb2ff","#fff"][i%5],size:3+Math.random()*6});setTimeout(()=>{const box=$("result");box.animate([{filter:"brightness(1)"},{filter:"brightness(1.8)"},{filter:"brightness(1)"}],{duration:700});},80);}
function updateHud(){if(!room)return;const me=players[myId],en=room.players.find(p=>p.id!==myId);if(me){$("myBar").style.width=me.hp/me.maxHp*100+"%";$("myHp").textContent=`${me.hp} / ${me.maxHp} HP`;}if(en){$("enemyBar").style.width=en.hp/en.maxHp*100+"%";$("enemyHp").textContent=`${en.hp} / ${en.maxHp} HP`;}}
function makeSkills(){const c=chars[myChar];$("skills").dataset.character=myChar;$("skills").innerHTML="";for(const key of ["q","e","r","t"]){const [name,desc,cd]=c.skills[key],el=document.createElement("div");el.className="skill";el.dataset.key=key;el.id="skill_"+key;el.innerHTML=`<div class="key">${key.toUpperCase()}</div><div class="sname">${name}</div><div class="cd">준비 완료</div><div class="shade"></div>`;el.title=`${name} · ${desc} · 재사용 대기시간 ${cd}초`;el.onmouseenter=()=>{$("tooltip").textContent=`${name} — ${desc} (쿨타임 ${cd}초)`;};el.onmouseleave=()=>{$("tooltip").textContent="스킬 버튼에 마우스를 올리면 설명을 볼 수 있어.";};el.onclick=()=>cast(key);$("skills").appendChild(el);}}
function cast(kind){if(!started||!room)return;const now=Date.now();if((cooldowns[kind]||0)>now)return;const angle=Math.atan2(mouse.y-local.y,mouse.x-local.x);socket.emit("attack",{kind,angle});cooldowns[kind]=now+chars[myChar].skills[kind][2]*1000;}
function basic(){if(!started)return;socket.emit("attack",{kind:"basic",angle:Math.atan2(mouse.y-local.y,mouse.x-local.x)});}
window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();keys[k]=true;if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();if(!e.repeat&&["q","e","r","t"].includes(k))cast(k);});
window.addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)*canvas.width/r.width;mouse.y=(e.clientY-r.top)*canvas.height/r.height;});
canvas.addEventListener("mousedown",e=>{if(e.button===0)basic();});
function drawPlayer(p,isMe){
 const c=chars[p.character]||{color:"#fff",name:"?",emoji:"?"};ctx.save();ctx.translate(p.x,p.y);
 ctx.fillStyle="#0009";ctx.beginPath();ctx.ellipse(0,17,25,10,0,0,Math.PI*2);ctx.fill();
 // soft elemental aura
 ctx.globalAlpha=.22;ctx.fillStyle=c.color;ctx.beginPath();ctx.arc(0,0,28,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
 if(p.character==="flame"){
  ctx.fillStyle="#ff653d";ctx.beginPath();ctx.moveTo(-15,8);ctx.quadraticCurveTo(-25,-12,-7,-28);ctx.quadraticCurveTo(-5,-13,3,-20);ctx.quadraticCurveTo(23,-3,13,12);ctx.closePath();ctx.fill();
  ctx.fillStyle="#ffca66";ctx.beginPath();ctx.ellipse(0,0,12,15,0,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff0c2";ctx.beginPath();ctx.arc(0,-3,5,0,Math.PI*2);ctx.fill();
 }else if(p.character==="wind"){
  ctx.strokeStyle="#a8f5e0";ctx.lineWidth=6;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(0,0,10+i*6,i*.8,i*.8+4.3);ctx.stroke();}ctx.fillStyle="#e6fff8";ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.fill();
 }else if(p.character==="earth"){
  ctx.fillStyle="#9a7048";ctx.strokeStyle="#e0bc87";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-19,9);ctx.lineTo(-15,-13);ctx.lineTo(-5,-22);ctx.lineTo(5,-17);ctx.lineTo(17,-8);ctx.lineTo(20,11);ctx.lineTo(9,20);ctx.lineTo(-12,18);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="#e8c99c";ctx.fillRect(-7,-4,4,4);ctx.fillRect(5,-4,4,4);
 }else if(p.character==="water"){
  const g=ctx.createRadialGradient(-5,-8,2,0,0,24);g.addColorStop(0,"#e4fbff");g.addColorStop(.45,"#69cfff");g.addColorStop(1,"#1973bd");ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,-25);ctx.bezierCurveTo(25,2,20,20,0,20);ctx.bezierCurveTo(-20,20,-25,2,0,-25);ctx.fill();ctx.strokeStyle="#c9f5ff";ctx.lineWidth=2;ctx.stroke();
 }
 ctx.save();ctx.rotate(p.facing||0);ctx.strokeStyle=isMe?"#fff":"#17202e";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(30,0);ctx.stroke();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(28,0,3,0,Math.PI*2);ctx.fill();ctx.restore();ctx.restore();
 const hp=Math.max(0,p.hp/p.maxHp),w=54;ctx.fillStyle="#111722";ctx.fillRect(p.x-w/2,p.y-40,w,7);ctx.fillStyle=hp>.35?"#54db91":"#ff5b68";ctx.fillRect(p.x-w/2+1,p.y-39,w*hp-2,5);
 ctx.fillStyle="#f4f6ff";ctx.font="bold 12px Arial";ctx.textAlign="center";ctx.fillText(c.name,p.x,p.y-48);
}
function drawBackground(){
 ctx.fillStyle="#18272b";ctx.fillRect(0,0,1000,600);
 // subtle arena floor
 for(let y=0;y<600;y+=40)for(let x=0;x<1000;x+=40){ctx.fillStyle=((x/40+y/40)%2===0)?"#1c3031":"#1a2c30";ctx.fillRect(x,y,40,40);}
 // stone paths
 ctx.fillStyle="#293b40";ctx.fillRect(0,270,1000,60);ctx.fillRect(470,0,60,600);
 ctx.strokeStyle="#344a4e";ctx.lineWidth=2;for(let x=0;x<1000;x+=40){ctx.beginPath();ctx.moveTo(x,270);ctx.lineTo(x,330);ctx.stroke();}for(let y=0;y<600;y+=40){ctx.beginPath();ctx.moveTo(470,y);ctx.lineTo(530,y);ctx.stroke();}
 // decorative rune circles
 for(const [x,y] of [[150,150],[850,150],[150,450],[850,450]]){ctx.strokeStyle="#42615a";ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,42,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(x,y,30,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#315047";ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();}
 // boundary
 ctx.strokeStyle="#708c83";ctx.lineWidth=5;ctx.strokeRect(8,8,984,584);
}
function drawEffects(dt){
 for(let i=projectiles.length-1;i>=0;i--){const b=projectiles[i];b.life-=dt;b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.life<=0||b.x<0||b.x>1000||b.y<0||b.y>600){projectiles.splice(i,1);continue;}ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.angle);ctx.shadowColor=b.color;ctx.shadowBlur=22;
  if(b.character==="flame"){const g=ctx.createRadialGradient(0,0,2,0,0,18);g.addColorStop(0,"#fff5b0");g.addColorStop(.35,"#ffbd45");g.addColorStop(1,"#f04420");ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,0,b.kind==="t"?23:15,9,0,0,Math.PI*2);ctx.fill();ctx.fillStyle="#ff6a2b";ctx.beginPath();ctx.moveTo(-7,0);ctx.quadraticCurveTo(-20,-13,-24,0);ctx.quadraticCurveTo(-16,2,-7,0);ctx.fill();}
  else if(b.character==="wind"){ctx.strokeStyle="#d5fff4";ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,13,-1.1,1.1);ctx.stroke();ctx.strokeStyle="#71d9c0";ctx.lineWidth=2;ctx.beginPath();ctx.arc(-4,0,20,-.8,.8);ctx.stroke();}
  else if(b.character==="earth"){ctx.fillStyle="#b88b59";ctx.strokeStyle="#f0d0a0";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(4,-11);ctx.lineTo(-9,-8);ctx.lineTo(-14,2);ctx.lineTo(-3,11);ctx.lineTo(10,8);ctx.closePath();ctx.fill();ctx.stroke();}
  else{const g=ctx.createLinearGradient(-12,0,14,0);g.addColorStop(0,"#2a8ddc");g.addColorStop(.5,"#e5fbff");g.addColorStop(1,"#55c9ff");ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(15,0);ctx.bezierCurveTo(5,-12,-8,-10,-13,0);ctx.bezierCurveTo(-6,11,6,11,15,0);ctx.fill();ctx.strokeStyle="#dffaff";ctx.lineWidth=2;ctx.stroke();}
  ctx.restore();}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){effects.splice(i,1);continue;}const alpha=Math.min(1,e.life*2);ctx.globalAlpha=alpha;if(e.hit){ctx.strokeStyle=e.color||"#fff";ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x,e.y,18+(0.5-e.life)*55,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#fff";ctx.font="bold 16px Arial";ctx.fillText("-"+e.damage,e.x,e.y-25);}else{const r=e.range*(1-e.life/.55);ctx.strokeStyle=e.color;ctx.fillStyle=e.color+"22";ctx.lineWidth=5;ctx.beginPath();ctx.arc(e.x,e.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();if(e.character==="flame"){ctx.strokeStyle="#ffd36b";ctx.lineWidth=2;for(let n=0;n<8;n++){const a=n*Math.PI/4;ctx.beginPath();ctx.moveTo(e.x+Math.cos(a)*r*.65,e.y+Math.sin(a)*r*.65);ctx.lineTo(e.x+Math.cos(a)*r*1.12,e.y+Math.sin(a)*r*1.12);ctx.stroke();}}else if(e.character==="wind"){ctx.strokeStyle="#d4fff5";ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,r*.7,-1,2.4);ctx.stroke();}else if(e.character==="earth"){ctx.strokeStyle="#e8c79a";ctx.lineWidth=4;for(let n=0;n<6;n++){const a=n*Math.PI/3;ctx.beginPath();ctx.moveTo(e.x+Math.cos(a)*r*.5,e.y+Math.sin(a)*r*.5);ctx.lineTo(e.x+Math.cos(a)*r,e.y+Math.sin(a)*r);ctx.stroke();}}else{ctx.strokeStyle="#d8f8ff";ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,r*.5,0,Math.PI*2);ctx.stroke();}}ctx.globalAlpha=1;}
 for(let i=celebration.length-1;i>=0;i--){const p=celebration[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=520*dt;ctx.globalAlpha=Math.max(0,Math.min(1,p.life));ctx.fillStyle=p.color;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.life*8);ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*1.8);ctx.restore();if(p.life<=0)celebration.splice(i,1);}ctx.globalAlpha=1;
}
function updateCooldowns(){for(const k of ["q","e","r","t"]){const el=$("skill_"+k);if(!el)continue;const left=Math.max(0,(cooldowns[k]||0)-Date.now())/1000;el.classList.toggle("cooling",left>0);el.querySelector(".cd").textContent=left>0?left.toFixed(1)+"초": "준비 완료";}}
let prev=performance.now();
function frame(now){requestAnimationFrame(frame);if(!started)return;const dt=Math.min(.04,(now-prev)/1000);prev=now;
 const c=chars[myChar],speed=c.speed;let dx=(keys.d?1:0)-(keys.a?1:0),dy=(keys.s?1:0)-(keys.w?1:0),len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
 local.x=Math.max(28,Math.min(972,local.x+dx*speed*dt));local.y=Math.max(28,Math.min(572,local.y+dy*speed*dt));local.facing=Math.atan2(mouse.y-local.y,mouse.x-local.x);
 if(now-lastSend>45){socket.emit("move",local);lastSend=now;}
 drawBackground();for(const p of Object.values(players)){if(p.id===myId)drawPlayer({...p,...local,character:myChar},true);else drawPlayer(p,false);}drawEffects(dt);updateCooldowns();
}
requestAnimationFrame(frame);
