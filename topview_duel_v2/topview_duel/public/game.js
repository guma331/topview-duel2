const socket=io(),$=id=>document.getElementById(id),screens=["lobby","select","game"];
function show(id){screens.forEach(s=>$(s).classList.toggle("active",s===id));}
const chars={
 flame:{name:"화염술사",desc:"화염구와 폭발로 적을 압박하는 원거리형",color:"#ff795c",hp:100,speed:165,skills:{q:["화염구","폭발하는 화염 투사체",3.5],e:["불꽃 돌진","조준 방향으로 돌진하며 피해",7],r:["작열","주변 넓은 범위 폭발",9],t:["태양 폭발","강력한 대형 화염구",18]}},
 blade:{name:"검사",desc:"높은 체력과 돌진으로 거리를 좁히는 근접형",color:"#dce4f2",hp:125,speed:175,skills:{q:["검기","빠른 검기를 발사",3],e:["섬광 베기","적에게 돌진해 베어낸다",6],r:["회전 베기","주변 원형 검격",8],t:["천공의 일격","거대한 장거리 검기",17]}},
 volt:{name:"전격술사",desc:"빠른 이동과 연속적인 전격 공격에 특화",color:"#f5dc62",hp:92,speed:185,skills:{q:["번개 화살","매우 빠른 전격 투사체",2.8],e:["전광석화","순간 이동하며 주변 감전",6.5],r:["전류 방출","넓은 범위에 전류 방출",9],t:["낙뢰","상대 위치에 강력한 번개",18]}},
 frost:{name:"빙결술사",desc:"안정적인 사거리와 강력한 얼음 공격",color:"#72d9ff",hp:108,speed:155,skills:{q:["얼음 파편","얼음 파편을 발사",3],e:["빙결 파동","주변에 얼음 파동",7],r:["서리 돌진","얼음 기운을 두르고 돌진",8],t:["빙하 창","느리지만 강력한 얼음 창",18]}}
};
let myId=null,room=null,myChar=null,selected=null,started=false,players={},projectiles=[],effects=[],keys={},mouse={x:500,y:300},lastSend=0;
let local={x:250,y:300,facing:0},cooldowns={};
const canvas=$("arena"),ctx=canvas.getContext("2d");
socket.on("connect",()=>{myId=socket.id;$("status").textContent="서버 연결 완료. 대전 상대를 찾아보자.";$("matchBtn").disabled=false;});
socket.on("connect_error",()=>{$("status").textContent="서버 연결 실패. 서버가 실행 중인지 확인해줘.";});
$("matchBtn").onclick=()=>{socket.emit("findMatch");$("matchBtn").disabled=true;$("cancelBtn").disabled=false;$("status").textContent="상대를 찾는 중...";};
$("cancelBtn").onclick=()=>{socket.emit("cancelMatch");$("matchBtn").disabled=false;$("cancelBtn").disabled=true;};
socket.on("queueStatus",m=>{$("status").textContent=m;$("matchBtn").disabled=false;$("cancelBtn").disabled=true;});
socket.on("matched",()=>{show("select");$("status").textContent="매칭 성공";});
function buildCards(){for(const [key,c] of Object.entries(chars)){const el=document.createElement("div");el.className="card";el.innerHTML=`<div class="avatar" style="--c:${c.color}"></div><b>${c.name}</b><small>${c.desc}<br>체력 ${c.hp} · 이동속도 ${c.speed}</small>`;el.onclick=()=>{selected=key;document.querySelectorAll(".card").forEach(n=>n.classList.toggle("selected",n===el));$("confirmBtn").disabled=false;$("selectStatus").textContent=c.name+" 선택됨";};$("cards").appendChild(el);}}
buildCards();
$("confirmBtn").onclick=()=>{if(!selected)return;myChar=selected;socket.emit("chooseCharacter",selected);$("confirmBtn").disabled=true;$("selectStatus").textContent="상대의 선택을 기다리는 중...";};
socket.on("roomState",state=>{room=state;players={};state.players.forEach(p=>players[p.id]=p);const mine=players[myId],enemy=state.players.find(p=>p.id!==myId);if(mine&&mine.character){myChar=mine.character;local.x=mine.x;local.y=mine.y;}if(state.phase==="game"&&!started){started=true;show("game");$("myName").textContent=chars[myChar].name;$("enemyName").textContent=enemy?chars[enemy.character].name:"상대";makeSkills();}updateHud();});
socket.on("opponentMove",p=>{if(players[p.id])Object.assign(players[p.id],p);});
socket.on("projectile",p=>{projectiles.push({x:p.x,y:p.y,angle:p.angle,vx:Math.cos(p.angle)*p.speed,vy:Math.sin(p.angle)*p.speed,kind:p.kind,color:p.color,life:1.5});});
socket.on("skillEffect",e=>effects.push({...e,life:.55}));
socket.on("hitEffect",e=>effects.push({...e,life:.5,damage:e.damage,hit:true}));
socket.on("opponentLeft",()=>showResult("상대 연결 종료","상대가 게임을 나갔어."));
socket.on("gameOver",d=>showResult(d.winner===myId?"승리!":"패배","대전이 종료됐어."));
function showResult(title,msg){$("resultTitle").textContent=title;$("resultText").textContent=msg;$("result").style.display="flex";}
function updateHud(){if(!room)return;const me=players[myId],en=room.players.find(p=>p.id!==myId);if(me){$("myBar").style.width=me.hp/me.maxHp*100+"%";$("myHp").textContent=`${me.hp} / ${me.maxHp} HP`;}if(en){$("enemyBar").style.width=en.hp/en.maxHp*100+"%";$("enemyHp").textContent=`${en.hp} / ${en.maxHp} HP`;}}
function makeSkills(){const c=chars[myChar];$("skills").innerHTML="";for(const key of ["q","e","r","t"]){const [name,desc,cd]=c.skills[key],el=document.createElement("div");el.className="skill";el.id="skill_"+key;el.innerHTML=`<div class="key">${key.toUpperCase()}</div><div class="sname">${name}</div><div class="cd">준비 완료</div><div class="shade"></div>`;el.title=`${name} · ${desc} · 재사용 대기시간 ${cd}초`;el.onmouseenter=()=>{$("tooltip").textContent=`${name} — ${desc} (쿨타임 ${cd}초)`;};el.onmouseleave=()=>{$("tooltip").textContent="스킬 버튼에 마우스를 올리면 설명을 볼 수 있어.";};el.onclick=()=>cast(key);$("skills").appendChild(el);}}
function cast(kind){if(!started||!room)return;const now=Date.now();if((cooldowns[kind]||0)>now)return;const angle=Math.atan2(mouse.y-local.y,mouse.x-local.x);socket.emit("attack",{kind,angle});cooldowns[kind]=now+chars[myChar].skills[kind][2]*1000;}
function basic(){if(!started)return;socket.emit("attack",{kind:"basic",angle:Math.atan2(mouse.y-local.y,mouse.x-local.x)});}
window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();keys[k]=true;if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();if(!e.repeat&&["q","e","r","t"].includes(k))cast(k);});
window.addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)*canvas.width/r.width;mouse.y=(e.clientY-r.top)*canvas.height/r.height;});
canvas.addEventListener("mousedown",e=>{if(e.button===0)basic();});
function drawPlayer(p,isMe){
 const c=chars[p.character]||{color:"#fff",name:"?"};ctx.save();ctx.translate(p.x,p.y);
 ctx.fillStyle="#0009";ctx.beginPath();ctx.ellipse(0,13,23,10,0,0,Math.PI*2);ctx.fill();
 ctx.fillStyle=c.color;ctx.strokeStyle=isMe?"#ffffff":"#20283a";ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.fill();ctx.stroke();
 ctx.rotate(p.facing||0);ctx.fillStyle="#17202e";ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(27,-6);ctx.lineTo(27,6);ctx.closePath();ctx.fill();ctx.restore();
 const hp=Math.max(0,p.hp/p.maxHp),w=52;ctx.fillStyle="#111722";ctx.fillRect(p.x-w/2,p.y-39,w,7);ctx.fillStyle=hp>.35?"#54db91":"#ff5b68";ctx.fillRect(p.x-w/2+1,p.y-38,w*hp-2,5);
 ctx.fillStyle="#f4f6ff";ctx.font="bold 12px Arial";ctx.textAlign="center";ctx.fillText(c.name,p.x,p.y-47);
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
 for(let i=projectiles.length-1;i>=0;i--){const b=projectiles[i];b.life-=dt;b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.life<=0||b.x<0||b.x>1000||b.y<0||b.y>600){projectiles.splice(i,1);continue;}ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.angle);ctx.fillStyle=b.color;ctx.shadowColor=b.color;ctx.shadowBlur=18;ctx.beginPath();ctx.ellipse(0,0,b.kind==="t"?21:11,6,0,0,Math.PI*2);ctx.fill();ctx.restore();}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){effects.splice(i,1);continue;}const alpha=Math.min(1,e.life*2);ctx.globalAlpha=alpha;if(e.hit){ctx.strokeStyle=e.color||"#fff";ctx.lineWidth=4;ctx.beginPath();ctx.arc(e.x,e.y,18+(0.5-e.life)*55,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#fff";ctx.font="bold 16px Arial";ctx.fillText("-"+e.damage,e.x,e.y-25);}else{ctx.strokeStyle=e.color;ctx.fillStyle=e.color+"33";ctx.lineWidth=5;ctx.beginPath();ctx.arc(e.x,e.y,e.range*(1-e.life/.55),0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.globalAlpha=1;}
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
