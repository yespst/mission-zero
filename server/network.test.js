import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

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
  await request(first,'ready',{ready:true});
  const firstReady=await seeSecond(s=>s.players.find(p=>p.id===novaId)?.ready===true);
  assert.equal(firstReady.canStart,false,'the first ready change synchronizes but does not launch');
  await request(second,'ready',{ready:true});
  const bothReady=await seeFirst(s=>s.canStart===true);
  assert.equal(bothReady.connectedCount,2);assert.ok(bothReady.players.filter(p=>p.connected).every(p=>p.ready));
  await assert.rejects(request(second,'start'),/captain/,'non-captain remains unable to launch after all crew are ready');
  await request(first,'start');
  const playing=await seeSecond(s=>s.phase==='playing');assert.equal(playing.players.length,2);
  const current=await seeFirst(s=>s.phase==='playing');const tile=current.mission.tiles[0];
  await assert.rejects(request(first,'action',{type:'rotate',index:0,missionId:'stale'}),/Mission changed/);
  await request(first,'action',{type:'rotate',index:0,missionId:current.mission.id});
  const updated=await seeSecond(s=>s.mission?.tiles?.[0]!==tile);assert.equal(updated.mission.tiles[0],(tile+1)%4);
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

test('two connected clients can enter the launch glyphs, ignite, and complete Mission 6',{timeout:30000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT)||await freePort(),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-final-launch-'));let child,first,second;
 try{
  child=await startServer(port,dataDir);const url=`http://127.0.0.1:${port}`;first=await connect(url);second=await connect(url);
  const seeFirst=stateWatcher(first),seeSecond=stateWatcher(second),hostId='final-crew-captain-uuid-1111',crewId='final-crew-pilot-uuid-2222';
  const created=await request(first,'create',{name:'Nova',playerId:hostId});await request(second,'join',{name:'Vega',playerId:crewId,code:created.code});
  await request(first,'ready',{ready:true});await request(second,'ready',{ready:true});let launched=await request(first,'start'),state=launched.state;
  const act=async(socket,payload)=>{await new Promise(resolve=>setTimeout(resolve,200));return request(socket,'action',{...payload,missionId:state.mission.id});};
  const solveCircuit=async()=>{for(let i=0;i<5&&state.mission.kind==='reactor';i++)while(state.mission.kind==='reactor'&&state.mission.tiles[i]!==state.mission.target[i])state=(await act(first,{type:'rotate',index:i})).state;};
  await solveCircuit();assert.equal(state.mission.kind,'oxygen');
  for(let i=0;i<3&&state.mission.kind==='oxygen';i++)while(state.mission.kind==='oxygen'&&state.mission.valves[i]!==state.mission.target[i])state=(await act(i%2?second:first,{type:'valve',index:i})).state;
  assert.equal(state.mission.kind,'navigation');
  const queue=[{pos:[0,0],steps:[]}],seen=new Set(['0,0']);let route=null;
  while(queue.length&&!route){const item=queue.shift();if(item.pos[0]===4&&item.pos[1]===4){route=item.steps;break;}for(const [direction,dx,dy] of [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]){const pos=[item.pos[0]+dx,item.pos[1]+dy],key=pos.join(',');if(pos.some(v=>v<0||v>4)||state.mission.hazards.some(([x,y])=>x===pos[0]&&y===pos[1])||seen.has(key))continue;seen.add(key);queue.push({pos,steps:[...item.steps,direction]});}}
  assert.ok(route&&route.length<=state.mission.maxMoves,'server generated a solvable navigation map');for(const direction of route)state=(await act(first,{type:'move',direction})).state;
  assert.equal(state.mission.kind,'sync');for(let node=0;node<3;node++)state=(await act(node===1?second:first,{type:'sync',node})).state;
  assert.equal(state.mission.kind,'hull');for(let section=0;section<3;section++)state=(await act(section%2?second:first,{type:'seal',section})).state;
  assert.equal(state.mission.kind,'launch');assert.equal(state.mission.entered.length,0);await assert.rejects(act(first,{type:'engines'}),/Complete the launch sequence/);
  const powerBefore=state.systems.power,launchMissionId=state.mission.id,wrong=state.mission.sequence[0]%5+1;
  await assert.rejects(request(first,'action',{type:'launchCode',value:wrong,missionId:launchMissionId}),/Incorrect glyph/);
  const penalizedPower=s=>s.systems.power<=powerBefore-10&&s.systems.power>powerBefore-11;
  state=await seeFirst(s=>s.mission?.id===launchMissionId&&s.mission.entered.length===0&&penalizedPower(s));
  assert.equal((await seeSecond(s=>s.mission?.id===launchMissionId&&s.mission.entered.length===0&&penalizedPower(s))).mission.entered.length,0,'wrong-glyph reset and penalty synchronize to the other client');
  for(let i=0;i<state.mission.sequence.length;i++){
   const value=state.mission.sequence[i],result=await act(i%2?second:first,{type:'launchCode',value});state=result.state;
   assert.match(result.feedback,new RegExp(`Glyph ${i+1} of 3 accepted`));
  }
  assert.equal(state.mission.entered.length,3);assert.equal(state.mission.engines,false);
  const ignition=await act(second,{type:'engines'});state=ignition.state;assert.equal(state.mission.engines,true);assert.match(ignition.feedback,/engines ignited/i);
  state=(await act(first,{type:'escape'})).state;assert.equal(state.phase,'victory');assert.equal(state.result.victory,true);assert.equal(state.result.missions,6);
  assert.equal((await seeSecond(s=>s.phase==='victory')).result.victory,true,'victory reaches both connected clients');
 }finally{first?.disconnect();second?.disconnect();await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});
