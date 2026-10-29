import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { addPlayer, applyAction, canStartMatch, createRoom, setReady, startMatch, tickRoom, resetMatch, MISSION_META, MISSION_ORDER, ROLE_ABILITIES, setDifficulty, setChallenge, useAbility } from './game.js';
import { appendChat, appendSystemChat, checkChatRate, cleanChatText } from './chat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const env = z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  HOST:z.string().default('127.0.0.1'),
  ROOM_TTL_MINUTES:z.coerce.number().int().min(5).max(10080).default(30),
  DATA_DIR:z.string().optional(),
  CLIENT_ORIGIN:z.string().optional()
}).parse(process.env);
const PORT = env.PORT;
const HOST = env.HOST;
const TTL = env.ROOM_TTL_MINUTES * 60_000;
const dataDir = path.resolve(env.DATA_DIR || path.join(root, 'data'));
const allowedOrigins = env.CLIENT_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) || [];
if (env.NODE_ENV === 'production') {
  if (!allowedOrigins.length) throw new Error('CLIENT_ORIGIN must list the exact HTTPS frontend origin(s) in production.');
  for (const allowedOrigin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(allowedOrigin); } catch { throw new Error(`Invalid CLIENT_ORIGIN: ${allowedOrigin}`); }
    if (parsed.protocol !== 'https:' || parsed.origin !== allowedOrigin) throw new Error(`CLIENT_ORIGIN must be an exact HTTPS origin without a path: ${allowedOrigin}`);
  }
}
const origin = allowedOrigins.length ? allowedOrigins : ['http://localhost:5173','http://127.0.0.1:5173'];
const rooms = new Map();
const roomSockets = new Map();
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req,res) => res.json({ ok: true, service: 'mission-zero', rooms: rooms.size }));
if (existsSync(path.join(root, 'dist'))) { app.use(express.static(path.join(root, 'dist'), { maxAge: '1h' })); app.use((_req,res) => res.sendFile(path.join(root, 'dist', 'index.html'))); }
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin, methods: ['GET','POST'] }, maxHttpBufferSize: 16_000 });

const clean = s => String(s ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
const codeOf = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,5);
const identityOf = s => String(s ?? '').trim();
function validatePlayerId(value) {
  const id = identityOf(value);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw Error('Player session is invalid. Refresh and try again.');
  return id;
}
function publicRoom(room, viewerId = null) {
  const mission = room.mission && { ...room.mission };
  if(mission?.kind==='signal'||mission?.kind==='datacore'){mission.fragmentCount=mission.sequence?.length||0;mission.privateClue=mission.clues?.[viewerId]||[];delete mission.clues;delete mission.sequence;}
  if(mission?.kind==='drone'){mission.stepCount=mission.repairOrder?.length||0;mission.privateClue=viewerId===mission.diagnosticOwner?{station:'diagnostic',fault:mission.fault}:viewerId===mission.repairOwner?{station:'repair',order:mission.repairOrder}:null;delete mission.fault;delete mission.repairOrder;}
  // Player-specific snapshots keep cooperative clues private while the server
  // remains authoritative for every answer and state transition.
  const players = room.players.map(({id,name,role,ready,connected,contribution,abilityUsedAt}) => ({id,name,role,ability:ROLE_ABILITIES[role],ready,connected,contribution,abilityReadyAt:abilityUsedAt?abilityUsedAt+60000:null}));
  players.sort((a,b) => Number(b.connected)-Number(a.connected));
  return { code: room.code, hostId: room.hostId, phase: room.phase, players, connectedCount: players.filter(p=>p.connected).length, canStart: canStartMatch(room), missionIndex: room.missionIndex, missionQueue:room.missionQueue,runSeed:room.runSeed,replaySeed:room.replaySeed,difficulty:room.difficulty,challenge:room.challenge, mission, missionMeta: room.mission && MISSION_META[room.mission.kind], systems: room.systems,resources:room.resources,activeEmergency:room.activeEmergency,endAt: room.endAt, startedAt: room.startedAt, completed: room.completed, events: room.events.slice(-10),chatHistory:(room.chat||[]).slice(-80),coordination: room.coordination, result: room.result };
}
function snapshot(code, viewerId=null) { const room = rooms.get(code); return room ? publicRoom(room,viewerId) : null; }
function broadcast(room, save = true) { for(const socketId of roomSockets.get(room.code)||[]){const s=io.sockets.sockets.get(socketId);if(s)s.emit('state',snapshot(room.code,s.data.playerId));} if (save) persist(); }
function getRoom(code) { const room = rooms.get(codeOf(code)); if (!room) throw Error('Room not found. Check the code and try again.'); return room; }
const lastActions = new Map();
function rateLimit(socket) {
  const now = Date.now(), prior = lastActions.get(socket.id) || [];
  const recent = prior.filter(t => now-t < 1000);
  if (recent.length >= 10) throw Error('Action limit reached. Give the ship a moment.');
  recent.push(now); lastActions.set(socket.id,recent);
}
function ack(fn) { return async (...args) => { const reply = typeof args.at(-1)==='function' ? args.pop() : () => {}; try { reply({ ok: true, ...(await fn(...args)) }); } catch (e) { reply({ ok: false, error: e.message || 'Request failed.' }); } }; }
function joinSocket(socket, room, playerId) {
  socket.join(room.code); socket.data.room = room.code; socket.data.playerId = playerId;
  let set = roomSockets.get(room.code); if (!set) roomSockets.set(room.code, set = new Set()); set.add(socket.id);
}
function assertNoRoom(socket){if(socket.data.room)throw Error('Leave your current room before joining another crew.');}

io.on('connection', socket => {
  socket.on('create', ack(async ({ name, playerId }) => {
    rateLimit(socket);assertNoRoom(socket); name = clean(name); playerId = validatePlayerId(playerId);
    if (name.length < 2) throw Error('Choose a nickname with at least 2 characters.');
    let room, tries = 0;
    do { room = createRoom({ id: playerId, name }); tries++; } while (rooms.has(room.code) && tries < 20);
    if (rooms.has(room.code)) throw Error('Could not reserve a room code. Try again.');
    rooms.set(room.code, room); joinSocket(socket, room, playerId);appendSystemChat(room,`${name} opened the crew channel.`); broadcast(room);
    return { state: snapshot(room.code,playerId), playerId, code: room.code };
  }));
  socket.on('join', ack(async ({ code, name, playerId }) => {
    rateLimit(socket);assertNoRoom(socket); code = codeOf(code); name = clean(name); playerId = validatePlayerId(playerId);
    if (name.length < 2) throw Error('Choose a nickname with at least 2 characters.');
    const room = getRoom(code);
    const existing = room.players.find(p => p.id === playerId);
    if (existing) { existing.name = name; existing.connected = true; room.updatedAt=Date.now();appendSystemChat(room,`${name} reconnected to the crew channel.`); }
    else {addPlayer(room, { id: playerId, name });appendSystemChat(room,`${name} joined the crew.`);}
    joinSocket(socket, room, playerId); broadcast(room); return { state: snapshot(code,playerId), playerId, code };
  }));
  socket.on('reconnect-room', ack(async ({ code, playerId }) => {
    rateLimit(socket);assertNoRoom(socket); const room = getRoom(code); const requestedId = validatePlayerId(playerId);
    let player = room.players.find(p => p.id === requestedId);
    // Earlier builds truncated UUIDs with the nickname sanitizer. Upgrade a
    // matching legacy prefix on reconnect so those saved sessions survive.
    if (!player) {
      const legacyId = clean(requestedId);
      player = legacyId !== requestedId ? room.players.find(p => p.id === legacyId) : null;
      if (player) { const previousId = player.id; player.id = requestedId; if (room.hostId === previousId) room.hostId = requestedId; }
    }
    if (!player) throw Error('This saved player session is no longer in the room.');
    const wasConnected=player.connected;player.connected = true; room.updatedAt=Date.now();if(!wasConnected)appendSystemChat(room,`${player.name} reconnected to the crew channel.`);
    if (!room.players.some(p => p.id === room.hostId && p.connected)) room.hostId = player.id;
    joinSocket(socket, room, player.id); broadcast(room); return { state: snapshot(room.code,player.id), playerId: player.id, code: room.code };
  }));
  socket.on('ready', ack(async ({ ready }) => { rateLimit(socket); const room = getRoom(socket.data.room); setReady(room,socket.data.playerId,ready); broadcast(room); return { state: snapshot(room.code,socket.data.playerId) }; }));
  socket.on('difficulty', ack(async ({difficulty})=>{rateLimit(socket);const room=getRoom(socket.data.room);setDifficulty(room,socket.data.playerId,difficulty);broadcast(room);return {state:snapshot(room.code,socket.data.playerId)};}));
  socket.on('challenge', ack(async ({challenge})=>{rateLimit(socket);const room=getRoom(socket.data.room);setChallenge(room,socket.data.playerId,challenge);broadcast(room);return {state:snapshot(room.code,socket.data.playerId)};}));
  socket.on('start', ack(async ({seed}={}) => { rateLimit(socket); const room = getRoom(socket.data.room);const testSeed=env.NODE_ENV==='test'&&Number.isSafeInteger(seed)&&seed>0&&seed<0x7fffffff?seed:null;room.chat=[];startMatch(room,socket.data.playerId,Date.now(),testSeed);appendSystemChat(room,`Mission started · ${room.difficulty.toUpperCase()} profile · reactor countdown active.`); broadcast(room); return { state: snapshot(room.code,socket.data.playerId) }; }));
  socket.on('ability',ack(async()=>{rateLimit(socket);const room=getRoom(socket.data.room);const result=useAbility(room,socket.data.playerId);broadcast(room);return {...result,state:snapshot(room.code,socket.data.playerId)};}));
  socket.on('action', ack(async action => { rateLimit(socket); const room = getRoom(socket.data.room); if (action?.missionId !== room.mission?.id) throw Error('Mission changed. Refresh the task panel and try again.'); let result; try { result = applyAction(room,socket.data.playerId,action); } catch (error) { if (room.mission?.kind === 'launch' && action?.type === 'launchCode') broadcast(room); throw error; } broadcast(room); return { ...result, state: snapshot(room.code,socket.data.playerId) }; }));
  socket.on('chat',ack(async({text})=>{rateLimit(socket);const room=getRoom(socket.data.room);const player=room.players.find(p=>p.id===socket.data.playerId&&p.connected);if(!player||!['lobby','playing'].includes(room.phase))throw Error('Crew chat is unavailable.');const safeText=cleanChatText(text);checkChatRate(room,player.id);appendChat(room,{senderId:player.id,nickname:player.name,text:safeText,kind:'player'});room.updatedAt=Date.now();broadcast(room);return {state:snapshot(room.code,player.id)};}));
  socket.on('message', ack(async ({ text }) => { rateLimit(socket); const room = getRoom(socket.data.room); const player = room.players.find(p => p.id===socket.data.playerId&&p.connected); if (!player || !['lobby','playing'].includes(room.phase)) throw Error('Messages are unavailable.'); const allowed = ['Repairing reactor','Need assistance','Oxygen critical','Ready to launch','I have the navigation controls','Hull team, report in']; if (!allowed.includes(text)) throw Error('Choose a crew message from the list.');checkChatRate(room,player.id);appendChat(room,{senderId:player.id,nickname:player.name,text,kind:'quick'});room.events.push({type:'chat',at:Date.now(),player:player.name,text});room.events=room.events.slice(-30);broadcast(room); return {}; }));
  socket.on('share-clue',ack(async()=>{rateLimit(socket);const room=getRoom(socket.data.room);const player=room.players.find(p=>p.id===socket.data.playerId&&p.connected);const m=room.mission;if(!player||room.phase!=='playing'||!m)throw Error('No active crew clue to share.');let text='';if(m.kind==='signal'||m.kind==='datacore'){const clues=m.clues?.[player.id]||[];if(!clues.length)throw Error('No private fragments are assigned to your station.');text=clues.map(c=>`POSITION ${c.position+1} = ${['◇','△','○','⬡','✦'][c.value-1]}`).join(' · ');}else if(m.kind==='drone'){if(player.id===m.diagnosticOwner)text=`DIAGNOSTIC FAULT · ${m.fault.toUpperCase()}`;else if(player.id===m.repairOwner)text=`DRONE SERVICE ORDER · ${m.repairOrder.map(x=>x.toUpperCase()).join(' → ')}`;}if(!text)throw Error('Your station has no shareable clue in this mission.');appendChat(room,{senderId:player.id,nickname:player.name,text:`SHARED · ${text}`,kind:'clue'});room.events.push({type:'clue',at:Date.now(),player:player.name,text:`SHARED · ${text}`});room.events=room.events.slice(-30);player.contribution++;broadcast(room);return {feedback:'Crew clue shared on comms.'};}));
  socket.on('rematch', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); resetMatch(room,socket.data.playerId,true); broadcast(room); return {}; }));
  socket.on('replay-seed',ack(async()=>{rateLimit(socket);const room=getRoom(socket.data.room);if(room.hostId!==socket.data.playerId)throw Error('Only the captain can replay this run.');if(!room.result||!Number.isSafeInteger(room.result.seed))throw Error('This run has no replayable seed.');const seed=room.result.seed;resetMatch(room,socket.data.playerId,true);room.replaySeed=seed;broadcast(room);return {state:snapshot(room.code,socket.data.playerId)};}));
  socket.on('return-lobby', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); resetMatch(room,socket.data.playerId,false);appendSystemChat(room,'Crew returned to the briefing room. A new run can begin when everyone is ready.'); broadcast(room); return {}; }));
  socket.on('leave', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room);const leaver=room.players.find(p=>p.id===socket.data.playerId); removePlayer(room,socket.data.playerId);if(leaver&&room.players.length)appendSystemChat(room,`${leaver.name} left the room.`);const sockets=roomSockets.get(room.code);sockets?.delete(socket.id);if(sockets?.size===0)roomSockets.delete(room.code);socket.leave(room.code); socket.data.room=null; socket.data.playerId=null; broadcast(room); return {}; }));
  socket.on('disconnect', () => { lastActions.delete(socket.id); const code=socket.data.room, id=socket.data.playerId; if (!code || !id) return; const set=roomSockets.get(code); set?.delete(socket.id); if (set?.size===0) roomSockets.delete(code); const room=rooms.get(code); if (!room) return; const still=io.sockets.sockets; const other=[...still.values()].some(s=>s.data.room===code&&s.data.playerId===id); if (!other) { const p=room.players.find(x=>x.id===id); if (p) {p.connected=false;appendSystemChat(room,`${p.name} disconnected · reconnect window open.`);} if (room.hostId===id) room.hostId=room.players.find(p=>p.connected)?.id || null; if (room.phase==='playing') room.systems.oxygen=Math.max(0,room.systems.oxygen-1); room.updatedAt=Date.now(); broadcast(room); } });
});
function removePlayer(room,id) { room.players=room.players.filter(p=>p.id!==id);delete room.chatRate?.[id]; if(room.hostId===id) room.hostId=room.players.find(p=>p.connected)?.id||null; room.updatedAt=Date.now(); if(!room.players.length) rooms.delete(room.code); }

let saveChain = Promise.resolve();
function persist() { const serial=[...rooms.values()].map(r=>({ ...r, actionTimes:undefined })); saveChain=saveChain.then(async()=>{ await mkdir(dataDir,{recursive:true}); const file=path.join(dataDir,'rooms.json'); const temp=`${file}.tmp`; await writeFile(temp,JSON.stringify(serial)); try { await rename(temp,file); } catch(error) { if(!['EPERM','EACCES','EXDEV','EEXIST'].includes(error.code)) throw error; await copyFile(temp,file); await unlink(temp); } }).catch(e=>console.error(JSON.stringify({level:'error',event:'persist_failed',message:e.message}))); }
async function restore() { try { const content=await readFile(path.join(dataDir,'rooms.json'),'utf8'); for(const r of JSON.parse(content)) { if(Date.now()-r.updatedAt<TTL && r.players?.length) { r.difficulty||='normal';r.challenge||='standard';r.missionQueue||=[...MISSION_ORDER];r.resources||={energy:5,materials:5,oxygen:3};r.chat=(r.chat||[]).slice(-80);r.chatRate||={};r.runSeed??=1;r.replaySeed??=null;r.nextEmergencyAt??=(r.phase==='playing'?(r.startedAt||Date.now())+30000:null);for(const p of r.players){p.abilityUsedAt??=null;p.connected=false;} r.hostId=null; rooms.set(r.code,r); } } } catch(e) { if(e.code!=='ENOENT') console.error(JSON.stringify({level:'error',event:'restore_failed',message:e.message})); } }
setInterval(()=>{ const now=Date.now(); for(const room of rooms.values()) { if(room.phase==='playing') {const previousEmergency=room.activeEmergency?.id;tickRoom(room,now);if(room.activeEmergency?.id&&room.activeEmergency.id!==previousEmergency){const event=room.events.at(-1);if(event?.type==='emergency')appendSystemChat(room,event.text,now);}else if(previousEmergency&&!room.activeEmergency){const event=room.events.at(-1);if(event?.type==='emergency')appendSystemChat(room,event.text,now);}broadcast(room,false); } else if(now-room.updatedAt>TTL&&!room.players.some(p=>p.connected)) rooms.delete(room.code); } persist(); },1000).unref();
await restore();
httpServer.listen(PORT,HOST,()=>console.log(JSON.stringify({level:'info',event:'server_listening',host:HOST,port:PORT,roomCount:rooms.size})));
process.on('SIGTERM',()=>{ httpServer.close(async()=>{ await saveChain; process.exit(0); }); });
