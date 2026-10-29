import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

async function connect(url){const socket=io(url,{timeout:2000,reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;}
async function startServer(port,dataDir,{mode='test',origin=''}={}){const child=spawn(process.execPath,[path.resolve('server/index.js')],{cwd:process.cwd(),env:{...process.env,NODE_ENV:mode,HOST:'0.0.0.0',CLIENT_ORIGIN:origin,PORT:String(port),DATA_DIR:dataDir,ROOM_TTL_MINUTES:'30'},stdio:['ignore','pipe','pipe']});child.errorLog='';child.stdout.on('data',chunk=>child.errorLog+=chunk);child.stderr.on('data',chunk=>child.errorLog+=chunk);const url=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<60&&!ready;i++){if(child.exitCode!==null)throw new Error(`Game server exited (${child.exitCode}): ${child.errorLog}`);try{ready=(await fetch(`${url}/health`)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}if(!ready){child.kill('SIGTERM');throw new Error(`Game server did not become healthy: ${child.errorLog}`);}return child;}
async function stopServer(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);}
function request(socket,event,data={}){return new Promise((resolve,reject)=>socket.emit(event,data,r=>r?.ok?resolve(r):reject(new Error(r?.error||'No acknowledgement'))));}
function stateWatcher(socket){let current=null;const waiters=[];socket.on('state',s=>{current=s;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].predicate(s)){const [w]=waiters.splice(i,1);w.resolve(s);}});return predicate=>current&&predicate(current)?Promise.resolve(current):new Promise(resolve=>waiters.push({predicate,resolve}));}

test('two Socket.IO clients share state, migrate captaincy, and reconnect without resetting the timer',{timeout:15000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT||3001),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-'));
 let child,first,second,reconnected,persisted;
 try{
  child=await startServer(port,dataDir);const url=`http://127.0.0.1:${port}`;
  first=await connect(url);second=await connect(url);const seeFirst=stateWatcher(first),seeSecond=stateWatcher(second);
  const created=await request(first,'create',{name:'Nova',playerId:'network-nova'});
  await request(second,'join',{name:'Vega',playerId:'network-vega',code:created.code});
  await request(first,'ready',{ready:true});await request(second,'ready',{ready:true});await request(first,'start');
  const playing=await seeSecond(s=>s.phase==='playing');assert.equal(playing.players.length,2);
  const current=await seeFirst(s=>s.phase==='playing');const tile=current.mission.tiles[0];
  await assert.rejects(request(first,'action',{type:'rotate',index:0,missionId:'stale'}),/Mission changed/);
  await request(first,'action',{type:'rotate',index:0,missionId:current.mission.id});
  const updated=await seeSecond(s=>s.mission?.tiles?.[0]!==tile);assert.equal(updated.mission.tiles[0],(tile+1)%4);
  const endAt=updated.endAt;first.disconnect();
  const migrated=await seeSecond(s=>s.hostId==='network-vega');assert.equal(migrated.players.find(p=>p.id==='network-nova').connected,false);
  reconnected=await connect(url);const restored=await request(reconnected,'reconnect-room',{code:created.code,playerId:'network-nova'});
  assert.equal(restored.state.phase,'playing');assert.equal(restored.state.players.length,2);assert.equal(restored.state.endAt,endAt);
  let snapshot;
  for(let i=0;i<30;i++){try{snapshot=JSON.parse(await readFile(path.join(dataDir,'rooms.json'),'utf8'));if(snapshot.find(r=>r.code===created.code)?.endAt===endAt)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(snapshot,`server did not write the persistent snapshot: ${child.errorLog}`);assert.equal(snapshot.find(r=>r.code===created.code)?.endAt,endAt,'active room and server timer are written to the persistent snapshot');
  first.disconnect();second.disconnect();reconnected.disconnect();await stopServer(child);
  child=await startServer(port,dataDir);persisted=await connect(url);let afterRestart;try{afterRestart=await request(persisted,'reconnect-room',{code:created.code,playerId:'network-vega'});}catch(error){throw new Error(`${error.message}; restart log: ${child.errorLog}`);}
  assert.equal(afterRestart.state.phase,'playing');assert.equal(afterRestart.state.endAt,endAt);assert.equal(afterRestart.state.players.length,2);
 }finally{
  first?.disconnect();second?.disconnect();reconnected?.disconnect();persisted?.disconnect();await stopServer(child);
  await rm(dataDir,{recursive:true,force:true});
 }
});

test('production CORS allows only the exact configured HTTPS frontend origin',{timeout:10000},async()=>{
 const port=Number(process.env.MISSION_ZERO_TEST_PORT||3001),dataDir=await mkdtemp(path.join(tmpdir(),'mission-zero-cors-'));let child;
 try{
  child=await startServer(port,dataDir,{mode:'production',origin:'https://mission-zero.vercel.app'});const url=`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`;
  const allowed=await fetch(url,{headers:{Origin:'https://mission-zero.vercel.app'}});assert.equal(allowed.headers.get('access-control-allow-origin'),'https://mission-zero.vercel.app');
  const denied=await fetch(url,{headers:{Origin:'https://other.example'}});assert.equal(denied.headers.get('access-control-allow-origin'),null);
 }finally{await stopServer(child);await rm(dataDir,{recursive:true,force:true});}
});
