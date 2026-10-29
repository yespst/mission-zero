import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { buildMissionQueue } from './game.js';

async function connect(url){const socket=io(url,{timeout:2000,reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;}
async function freePort(){const server=createNetServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;}
async function startServer(port,dataDir,{mode='test',origin=''}={}){const child=spawn(process.execPath,[path.resolve('server/index.js')],{cwd:process.cwd(),env:{...process.env,NODE_ENV:mode,HOST:'0.0.0.0',CLIENT_ORIGIN:origin,PORT:String(port),DATA_DIR:dataDir,ROOM_TTL_MINUTES:'30'},stdio:['ignore','pipe','pipe']});child.errorLog='';child.stdout.on('data',chunk=>child.errorLog+=chunk);child.stderr.on('data',chunk=>child.errorLog+=chunk);const url=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<60&&!ready;i++){if(child.exitCode!==null)throw new Error(`Game server exited (${child.exitCode}): ${child.errorLog}`);try{ready=(await fetch(`${url}/health`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}if(!ready){child.kill('SIGTERM');throw new Error(`Game server did not become healthy: ${child.errorLog}`);}return child;}
async function stopServer(child){if(!child||child.exitCode!==null)return;const exited=new Promise(resolve=>child.once('exit',()=>resolve(true)));child.kill('SIGTERM');const graceful=await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(false),5000))]);if(!graceful&&child.exitCode===null){child.kill('SIGKILL');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1000))]);}}
function request(socket,event,data={}){return new Promise((resolve,reject)=>socket.emit(event,data,r=>r?.ok?resolve(r):reject(new Error(r?.error||'No acknowledgement'))));}
function stateWatcher(socket){let current=null;const waiters=[];socket.on('state',s=>{current=s;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(s)){const [w]=waiters.splice(i,1);w.resolve(s);}});return predicate=>current&&predicate(current)?Promise.resolve(current):new Promise(resolve=>waiters.push({predicate,resolve}));}

test('two Socket.IO clients share state, migrate captaincy, and reconnect without resetting the timer',{timeout:15000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT)||await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-'));
 let child,first,second,reconnected,persisted;
 try{
  child=await startServer(port,dataDir);const url=`http://127.0.0.1:${port}`;
  first=await connect(url);second=await connect(url);const seeFirst=stateWatcher(first),seeSecond=stateWatcher(second);
  await assert.rejects(request(first,'create',{name:'Bad ID',playerId:'short'}),/session is invalid/);
  const novaId='11111111-1111-4111-8111-111111111111',vegaId='22222222-2222-4222-8222-222222222222';
  const created=await request(first,'create',{name:'Nova',playerId:novaId});
  const joined=await request(second,'join',{name:'Vega',playerId:vegaId,code:created.code});
  assert.equal(created.state.phase,'lobby');assert.equal(created.state.endAt,null);assert.deepEqual(created.state.systems,{reactor:100,oxygen:100,hull:100,power:100});
  assert.equal(created.state.hostId,novaId,'server preserves the full client identity used for captain checks');
  assert.equal(joined.state.connectedCount,2);assert.equal(joined.state.canStart,false);
  await assert.rejects(request(second,'start'),/captain/,'a non-captain cannot start the mission');
  await request(first,'difficulty',{difficulty:'hard'});assert.equal((await seeSecond(s=>s.difficulty==='hard')).difficulty,'hard');await assert.rejects(request(second,'difficulty',{difficulty:'nightmare'}),/captain/,'non-captain cannot change the run profile');
  await request(first,'ready',{ready:true});
  const firstReady=await seeSecond(s=>s.players.find(p=>p.id===novaId)?.ready===true);
  assert.equal(firstReady.canStart,false,'the first ready change synchronizes but does not launch');
  await request(second,'ready',{ready:true});
  const bothReady=await seeFirst(s=>s.canStart===true);
  assert.equal(bothReady.connectedCount,2);assert.ok(bothReady.players.filter(p=>p.connected).every(p=>p.ready));
  await assert.rejects(request(second,'start'),/captain/,'non-captain remains unable to launch after all crew are ready');
  await request(first,'start');
  const playing=await seeSecond(s=>s.phase==='playing');assert.equal(playing.players.length,2);assert.equal(playing.endAt-playing.startedAt,7*60*1000);
  const current=await seeFirst(s=>s.phase==='playing');
  await assert.rejects(request(first,'action',{type:'rotate',index:0,missionId:'stale'}),/Mission changed/);
  const firstAction=current.mission.kind==='reactor'?{type:'rotate',index:0}:current.mission.kind==='oxygen'?{type:'valve',index:0}:current.mission.kind==='navigation'?{type:'move',direction:'right'}:current.mission.kind==='sync'?{type:'sync',node:0}:current.mission.kind==='hull'?{type:'seal',section:0}:current.mission.kind==='coolant'?{type:'route',junction:0,port:current.mission.route[0]}:current.mission.kind==='signal'?{type:'signal',position:current.mission.privateClue[0].position,value:current.mission.privateClue[0].value}:current.mission.kind==='shields'?{type:'pulse',node:current.mission.sequence[0]}:current.mission.kind==='powergrid'?{type:'relay',relay:0}:current.mission.kind==='drone'?{type:'diagnose'}:current.mission.kind==='datacore'?{type:'dataGlyph',position:current.mission.privateClue[0].position,value:current.mission.privateClue[0].value}:{type:'launchCode',value:current.mission.sequence[0]};
  const mutation=await request(first,'action',{...firstAction,missionId:current.mission.id});assert.ok(mutation.state.players.find(p=>p.id===novaId).contribution>0);
  const updated=await seeSecond(s=>s.players.find(p=>p.id===novaId)?.contribution>0);assert.equal(updated.mission?.id,current.mission.id);
  const endAt=updated.endAt;first.disconnect();
  const migrated=await seeSecond(s=>s.hostId===vegaId);assert.equal(migrated.players.find(p=>p.id===novaId).connected,false);
  reconnected=await connect(url);const restored=await request(reconnected,'reconnect-room',{code:created.code,playerId:novaId});
  assert.equal(restored.state.phase,'playing');assert.equal(restored.state.players.length,2);assert.equal(restored.state.endAt,endAt);
  let snapshot;
  for(let i=0;i<30;i++){try{snapshot=JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'));if(snapshot.find(r=>r.code===created.code)?.endAt===endAt)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(snapshot,`server did not write the persistent snapshot: ${child.errorLog}`);assert.equal(snapshot.find(r=>r.code===created.code)?.endAt,endAt,'active room and server timer are written to the persistent snapshot');
  first.disconnect();second.disconnect();reconnected.disconnect();await new Promise(r=>setTimeout(r,150));await stopServer(child);
  child=await startServer(port,dataDir);persisted=await connect(url);let afterRestart;try{afterRestart=await request(persisted,'reconnect-room',{code:created.code,playerId:vegaId});}catch(error){throw new Error(`${error.message}; restart log: ${child.errorLog}`);}
  assert.equal(afterRestart.state.phase,'playing');assert.equal(afterRestart.state.endAt,endAt);assert.equal(afterRestart.state.players.length,2);
 }finally{
  first?.disconnect();second?.disconnect();reconnected?.disconnect();persisted?.disconnect();await stopServer(child);
  await rm(dataDir,{recursive:true,force:true});
 }
});

test('crew chat is room-private, live in lobby and gameplay, bounded, validated, rate-limited, and restored once',{timeout:20000},async()=>{
 const port=await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-chat-'));let child,a,b,c,restored;
 try{
  child=await startServer(port,dataDir);const url=`http://127.0.0.1:${port}`;a=await connect(url);b=await connect(url);c=await connect(url);
  const seeA=stateWatcher(a),seeB=stateWatcher(b),seeC=stateWatcher(c);
  const idA='aaaaaaaa-1111-4111-8111-111111111111',idB='bbbbbbbb-2222-4222-8222-222222222222',idC='cccccccc-3333-4333-8333-333333333333';
  const roomA=await request(a,'create',{name:'Nova',playerId:idA});await request(b,'join',{name:'Vega',playerId:idB,code:roomA.code});
  const roomB=await request(c,'create',{name:'Comet',playerId:idC});
  const lobby=await request(a,'chat',{text:'Keep this channel private <script>alert(1)</script>'});
  const message=lobby.state.chatHistory.find(m=>m.senderId===idA);assert.equal(message.nickname,'Nova');assert.ok(message.at);assert.equal(message.text,'Keep this channel private <script>alert(1)</script>');
  assert.ok((await seeB(s=>s.chatHistory.some(m=>m.id===message.id))).chatHistory.some(m=>m.id===message.id),'second player receives lobby chat live');
  assert.ok(!(await seeC(s=>s.code===roomB.code)).chatHistory.some(m=>m.text.includes('Keep this channel')),'other room never receives the message');
  await assert.rejects(request(a,'chat',{text:'x'.repeat(251)}),/250 characters/);await assert.rejects(request(a,'chat',{text:'   '}),/empty/);
  await request(b,'message',{text:'Need assistance'});assert.ok((await seeA(s=>s.chatHistory.some(m=>m.kind==='quick'))).chatHistory.some(m=>m.kind==='quick'&&m.nickname==='Vega'));
  await assert.rejects(request(a,'join',{name:'Nova',playerId:idA,code:roomB.code}),/Leave your current room/,'a socket cannot switch rooms and receive both room broadcasts');
  await new Promise(resolve=>setTimeout(resolve,1100));
  for(let i=0;i<7;i++)await request(a,'chat',{text:`burst ${i}`});await assert.rejects(request(a,'chat',{text:'burst overflow'}),/rate limit/);
  await request(a,'ready',{ready:true});await request(b,'ready',{ready:true});const started=await request(a,'start',{seed:555123});assert.equal(started.state.phase,'playing');assert.ok(started.state.chatHistory.some(m=>m.kind==='system'&&m.text.startsWith('Mission started')));
  await request(b,'chat',{text:'We are in the mission now'});assert.ok((await seeA(s=>s.chatHistory.some(m=>m.text==='We are in the mission now'))).chatHistory.some(m=>m.text==='We are in the mission now'));
  b.disconnect();await new Promise(resolve=>setTimeout(resolve,100));restored=await connect(url);const after=await request(restored,'reconnect-room',{code:roomA.code,playerId:idB});const seen=after.state.chatHistory.filter(m=>m.text==='We are in the mission now');assert.equal(seen.length,1);assert.equal(new Set(after.state.chatHistory.map(m=>m.id)).size,after.state.chatHistory.length);
  const bounded=await seeB(s=>s.chatHistory.some(m=>m.text==='We are in the mission now'));assert.ok(bounded.chatHistory.length<=80);
  await new Promise(resolve=>setTimeout(resolve,1100));const crossRoomUpdates=[];a.on('state',s=>crossRoomUpdates.push(s));await request(a,'leave');await request(a,'join',{name:'Nova',playerId:idA,code:roomB.code});crossRoomUpdates.length=0;
  await request(c,'chat',{text:'Comet room private'});await request(restored,'chat',{text:'Vega old room private'});await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(crossRoomUpdates.some(s=>s.code===roomB.code&&s.chatHistory.some(m=>m.text==='Comet room private')));assert.ok(!crossRoomUpdates.some(s=>s.code===roomA.code),'a departed socket is removed from the old room broadcast set');
 }finally{a?.disconnect();b?.disconnect();c?.disconnect();restored?.disconnect();await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});

test('production CORS allows only the exact configured HTTPS frontend origin',{timeout:10000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT)||await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-cors-'));let child;
 try{
  child=await startServer(port,dataDir,{mode:'production',origin:'https://mission-zero.vercel.app'});const url=`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`;
  const allowed=await fetch(url,{headers:{Origin:'https://mission-zero.vercel.app'}});assert.equal(allowed.headers.get('access-control-allow-origin'),'https://mission-zero.vercel.app');
  const denied=await fetch(url,{headers:{Origin:'https://other.example'}});assert.equal(denied.headers.get('access-control-allow-origin'),null);
 }finally{await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});

test('reconnect upgrades player UUIDs truncated by the legacy nickname sanitizer',{timeout:15000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT)||await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-legacy-'));let child,socket;
 const url=`http://127.0.0.1:${port}`,playerId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 try{
  child=await startServer(port,dataDir);socket=await connect(url);
  const created=await request(socket,'create',{name:'Legacy Nova',playerId});assert.equal(created.state.hostId,playerId);
  socket.disconnect();let offlineSnapshot=false;
  for(let i=0;i<40;i++){try{const saved=JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'));offlineSnapshot=saved.find(r=>r.code===created.code)?.players?.[0]?.connected===false;if(offlineSnapshot)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(offlineSnapshot,true,'disconnect state is persisted before restart');
  await stopServer(child);child=null;
  const file=path.join(dataDir,'rooms.json'),saved=JSON.parse(await readFile(file,'utf8')),room=saved.find(r=>r.code===created.code);
  assert.ok(room);room.players[0].id=playerId.slice(0,18);await writeFile(file,JSON.stringify(saved));
  child=await startServer(port,dataDir);socket=await connect(url);
  const restored=await request(socket,'reconnect-room',{code:created.code,playerId});
  assert.equal(restored.state.players[0].id,playerId);assert.equal(restored.state.hostId,playerId);assert.equal(restored.state.players[0].connected,true);
 }finally{socket?.disconnect();await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});

test("two connected clients cooperate through a seeded run and complete Emergency Launch",{timeout:120000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT)||await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),"mission-zero-full-run-"));let child,first,second;
 try{
  child=await startServer(port,dataDir);const url="http://127.0.0.1:"+port;first=await connect(url);second=await connect(url);const seeFirst=stateWatcher(first),seeSecond=stateWatcher(second),hostId="full-run-captain-uuid-1111",crewId="full-run-pilot-uuid-2222";const testSeed=Array.from({length:2000},(_,i)=>i+1).find(seed=>['signal','datacore','drone'].every(kind=>buildMissionQueue(seed).includes(kind)));assert.ok(testSeed,"test run includes private clue, archive, and two-station missions");
  const created=await request(first,"create",{name:"Nova",playerId:hostId});await request(second,"join",{name:"Vega",playerId:crewId,code:created.code});await request(first,"ready",{ready:true});await request(second,"ready",{ready:true});let state=(await request(first,"start",{seed:testSeed})).state;
  const delay=()=>new Promise(r=>setTimeout(r,130));
  const act=async(client,payload)=>{await delay();const result=await request(client,"action",{...payload,missionId:state.mission.id});state=result.state;return result;};
  const partner=async()=>seeSecond(s=>s.mission?.id===state.mission?.id);
  while(state.phase==="playing"){
   const m=state.mission;
   if(m.kind==="reactor"){for(let i=0;i<(state.mission?.tiles?.length||0);i++)while(state.mission?.kind==="reactor"&&state.mission.tiles[i]!==state.mission.target[i])await act(first,{type:"rotate",index:i});}
   else if(m.kind==="oxygen"){for(let i=0;i<3;i++)while(state.mission?.kind==="oxygen"&&state.mission.valves[i]!==state.mission.target[i])await act(i%2?second:first,{type:"valve",index:i});}
   else if(m.kind==="navigation"){const q=[{p:[0,0],r:[]}],seen=new Set(["0,0"]);let route;while(q.length&&!route){const x=q.shift();if(x.p[0]===4&&x.p[1]===4){route=x.r;break;}for(const [d,dx,dy] of [["up",0,-1],["down",0,1],["left",-1,0],["right",1,0]]){const p=[x.p[0]+dx,x.p[1]+dy],k=p.join(",");if(p.some(v=>v<0||v>4)||m.hazards.some(([a,b])=>a===p[0]&&b===p[1])||seen.has(k))continue;seen.add(k);q.push({p,r:[...x.r,d]});}}assert.ok(route&&route.length<=m.maxMoves);for(const direction of route)await act(first,{type:"move",direction});}
   else if(m.kind==="sync"){for(let node=0;node<3;node++)await act(node%2?second:first,{type:"sync",node});}
   else if(m.kind==="hull"){for(let section=0;section<3;section++)await act(section%2?second:first,{type:"seal",section});}
   else if(m.kind==="coolant"){for(let junction=0;junction<3;junction++)await act(junction%2?second:first,{type:"route",junction,port:state.mission.route[junction]});}
   else if(m.kind==="signal"){const a=await seeFirst(s=>s.mission?.id===m.id),b=await partner();assert.equal(a.mission.sequence,undefined);assert.equal(b.mission.sequence,undefined);assert.notDeepEqual(a.mission.privateClue,b.mission.privateClue,"distributed clues differ by connected player");await request(first,"share-clue");assert.ok((await seeSecond(s=>s.events.some(e=>e.type==="clue"&&e.player==="Nova"))).events.some(e=>e.type==="clue"));for(const [client,clues] of [[first,a.mission.privateClue],[second,b.mission.privateClue]])for(const c of clues)await act(client,{type:"signal",position:c.position,value:c.value});}
   else if(m.kind==="shields"){for(const node of m.sequence)await act(first,{type:"pulse",node});}
   else if(m.kind==="powergrid"){for(let relay=0;relay<3;relay++)await act(relay%2?second:first,{type:"relay",relay});}
   else if(m.kind==="drone"){const b=await partner();await act(first,{type:"diagnose"});for(const part of b.mission.privateClue.order)await act(second,{type:"droneRepair",part:b.mission.tools.indexOf(part)});}
   else if(m.kind==="datacore"){const a=await seeFirst(s=>s.mission?.id===m.id),b=await partner();assert.equal(a.mission.sequence,undefined);assert.equal(b.mission.sequence,undefined);assert.notDeepEqual(a.mission.privateClue,b.mission.privateClue,"archive clues remain player-specific");await request(second,"share-clue");assert.ok((await seeFirst(s=>s.events.some(e=>e.type==="clue"&&e.player==="Vega"))).events.some(e=>e.type==="clue"));for(const [client,clues] of [[first,a.mission.privateClue],[second,b.mission.privateClue]])for(const c of clues)await act(client,{type:"dataGlyph",position:c.position,value:c.value});}
   else if(m.kind==="launch"){for(const value of m.sequence)await act(first,{type:"launchCode",value});await act(second,{type:"engines"});await act(first,{type:"escape"});}
   else throw Error("Unhandled generated mission: "+m.kind);
   if(state.phase==="defeat")throw Error("Generated mission run unexpectedly defeated.");
  }
  assert.equal(state.phase,"victory");assert.equal(state.result.victory,true);assert.equal(state.completed.at(-1),"launch");assert.equal(state.result.missions,state.missionQueue.length);assert.equal((await seeSecond(x=>x.phase==="victory")).result.victory,true);
 }finally{first?.disconnect();second?.disconnect();await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});
