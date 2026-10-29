import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { addPlayer, applyAction, createRoom, setReady, startMatch, tickRoom, resetMatch, MISSION_META, ROLE_ABILITIES } from './game.js';

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
function publicRoom(room) {
  const mission = room.mission && { ...room.mission };
  // Puzzle clues are public; every state change and completion is still validated here.
  return { code: room.code, hostId: room.hostId, phase: room.phase, players: room.players.map(({id,name,role,ready,connected,contribution}) => ({id,name,role,ability:ROLE_ABILITIES[role],ready,connected,contribution})), missionIndex: room.missionIndex, mission, missionMeta: room.mission && MISSION_META[room.mission.kind], systems: room.systems, endAt: room.endAt, startedAt: room.startedAt, completed: room.completed, events: room.events.slice(-10), coordination: room.coordination, result: room.result };
}
function snapshot(code) { const room = rooms.get(code); return room ? publicRoom(room) : null; }
function broadcast(room, save = true) { io.to(room.code).emit('state', snapshot(room.code)); if (save) persist(); }
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

io.on('connection', socket => {
  socket.on('create', ack(async ({ name, playerId }) => {
    rateLimit(socket); name = clean(name); playerId = clean(playerId);
    if (name.length < 2) throw Error('Choose a nickname with at least 2 characters.');
    if (!playerId || playerId.length > 64) throw Error('Player session is invalid. Refresh and try again.');
    let room, tries = 0;
    do { room = createRoom({ id: playerId, name }); tries++; } while (rooms.has(room.code) && tries < 20);
    if (rooms.has(room.code)) throw Error('Could not reserve a room code. Try again.');
    rooms.set(room.code, room); joinSocket(socket, room, playerId); broadcast(room);
    return { state: snapshot(room.code), playerId, code: room.code };
  }));
  socket.on('join', ack(async ({ code, name, playerId }) => {
    rateLimit(socket); code = codeOf(code); name = clean(name); playerId = clean(playerId);
    if (name.length < 2) throw Error('Choose a nickname with at least 2 characters.');
    if (!playerId || playerId.length > 64) throw Error('Player session is invalid. Refresh and try again.');
    const room = getRoom(code);
    const existing = room.players.find(p => p.id === playerId);
    if (existing) { existing.name = name; existing.connected = true; room.updatedAt=Date.now(); }
    else addPlayer(room, { id: playerId, name });
    joinSocket(socket, room, playerId); broadcast(room); return { state: snapshot(code), playerId, code };
  }));
  socket.on('reconnect-room', ack(async ({ code, playerId }) => {
    rateLimit(socket); const room = getRoom(code); const player = room.players.find(p => p.id === clean(playerId));
    if (!player) throw Error('This saved player session is no longer in the room.');
    player.connected = true; room.updatedAt=Date.now();
    if (!room.players.some(p => p.id === room.hostId && p.connected)) room.hostId = player.id;
    joinSocket(socket, room, player.id); broadcast(room); return { state: snapshot(room.code), playerId: player.id, code: room.code };
  }));
  socket.on('ready', ack(async ({ ready }) => { rateLimit(socket); const room = getRoom(socket.data.room); setReady(room,socket.data.playerId,ready); broadcast(room); return {}; }));
  socket.on('start', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); startMatch(room,socket.data.playerId); broadcast(room); return {}; }));
  socket.on('action', ack(async action => { rateLimit(socket); const room = getRoom(socket.data.room); if (action?.missionId !== room.mission?.id) throw Error('Mission changed. Refresh the task panel and try again.'); const result = applyAction(room,socket.data.playerId,action); broadcast(room); return result; }));
  socket.on('message', ack(async ({ text }) => { rateLimit(socket); const room = getRoom(socket.data.room); const player = room.players.find(p => p.id===socket.data.playerId); if (!player || !['lobby','playing'].includes(room.phase)) throw Error('Messages are unavailable.'); const allowed = ['Repairing reactor','Need assistance','Oxygen critical','Ready to launch','I have the navigation controls','Hull team, report in']; if (!allowed.includes(text)) throw Error('Choose a crew message from the list.'); room.events.push({type:'chat',at:Date.now(),player:player.name,text}); room.events=room.events.slice(-30); broadcast(room); return {}; }));
  socket.on('rematch', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); resetMatch(room,socket.data.playerId,true); broadcast(room); return {}; }));
  socket.on('return-lobby', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); resetMatch(room,socket.data.playerId,false); broadcast(room); return {}; }));
  socket.on('leave', ack(async () => { rateLimit(socket); const room = getRoom(socket.data.room); removePlayer(room,socket.data.playerId); socket.leave(room.code); socket.data.room=null; socket.data.playerId=null; broadcast(room); return {}; }));
  socket.on('disconnect', () => { lastActions.delete(socket.id); const code=socket.data.room, id=socket.data.playerId; if (!code || !id) return; const set=roomSockets.get(code); set?.delete(socket.id); if (set?.size===0) roomSockets.delete(code); const room=rooms.get(code); if (!room) return; const still=io.sockets.sockets; const other=[...still.values()].some(s=>s.data.room===code&&s.data.playerId===id); if (!other) { const p=room.players.find(x=>x.id===id); if (p) p.connected=false; if (room.hostId===id) room.hostId=room.players.find(p=>p.connected)?.id || null; if (room.phase==='playing') room.systems.oxygen=Math.max(0,room.systems.oxygen-1); room.updatedAt=Date.now(); broadcast(room); } });
});
function removePlayer(room,id) { room.players=room.players.filter(p=>p.id!==id); if(room.hostId===id) room.hostId=room.players.find(p=>p.connected)?.id||null; room.updatedAt=Date.now(); if(!room.players.length) rooms.delete(room.code); }

let saveChain = Promise.resolve();
function persist() { const serial=[...rooms.values()].map(r=>({ ...r, actionTimes:undefined })); saveChain=saveChain.then(async()=>{ await mkdir(dataDir,{recursive:true}); const file=path.join(dataDir,'rooms.json'); const temp=`${file}.tmp`; await writeFile(temp,JSON.stringify(serial)); try { await rename(temp,file); } catch(error) { if(!['EPERM','EACCES','EXDEV','EEXIST'].includes(error.code)) throw error; await copyFile(temp,file); await unlink(temp); } }).catch(e=>console.error(JSON.stringify({level:'error',event:'persist_failed',message:e.message}))); }
async function restore() { try { const content=await readFile(path.join(dataDir,'rooms.json'),'utf8'); for(const r of JSON.parse(content)) { if(Date.now()-r.updatedAt<TTL && r.players?.length) { for(const p of r.players) p.connected=false; r.hostId=null; rooms.set(r.code,r); } } } catch(e) { if(e.code!=='ENOENT') console.error(JSON.stringify({level:'error',event:'restore_failed',message:e.message})); } }
setInterval(()=>{ const now=Date.now(); for(const room of rooms.values()) { if(room.phase==='playing') { tickRoom(room,now); broadcast(room,false); } else if(now-room.updatedAt>TTL&&!room.players.some(p=>p.connected)) rooms.delete(room.code); } persist(); },1000).unref();
await restore();
httpServer.listen(PORT,HOST,()=>console.log(JSON.stringify({level:'info',event:'server_listening',host:HOST,port:PORT,roomCount:rooms.size})));
process.on('SIGTERM',()=>{ httpServer.close(async()=>{ await saveChain; process.exit(0); }); });
