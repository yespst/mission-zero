import { randomInt, randomUUID } from 'node:crypto';

export const MISSION_ORDER = ['reactor', 'oxygen', 'navigation', 'sync', 'hull', 'launch'];
export const MISSION_META = {
  reactor: { name: 'Reactor Stabilization', short: 'REACTOR', intro: 'Reroute the unstable energy circuit. Rotate each coupler until every segment matches the solution glyph.', icon: '⌘' },
  oxygen: { name: 'Oxygen Restoration', short: 'OXYGEN', intro: 'Set the three pressure valves to the marked levels. Coordinate the sequence across the crew.', icon: '◉' },
  navigation: { name: 'Navigation Override', short: 'NAVIGATION', intro: 'Plot a safe course across the asteroid field. Move the ship to the extraction beacon without hitting debris.', icon: '⌖' },
  sync: { name: 'Core Synchronization', short: 'CORE SYNC', intro: 'Synchronize all three energy nodes. Each node requires a different crew member to hold the phase.', icon: '⌁' },
  hull: { name: 'Hull Breach', short: 'HULL BREACH', intro: 'Seal the three compromised hull sections before the ship loses pressure.', icon: '◇' },
  launch: { name: 'Emergency Launch', short: 'LAUNCH', intro: 'Enter the three launch glyphs in order, bring the engines online, then initiate escape.', icon: '⇧' }
};
const ROLE_NAMES = ['Engineer', 'Navigator', 'Systems Analyst', 'Medic', 'Pilot', 'Security'];
export const ROLE_ABILITIES = { Engineer: 'Reactor tuning: +0.5% stability per coupler turn', Navigator: 'Flight mapping: +2 safe navigation moves', 'Systems Analyst': 'Phase modeling: can hold all 3 sync nodes', Medic: 'Atmosphere care: +1% oxygen per valve turn', Pilot: 'Engine calibration: +5% power on ignition', Security: 'Hull reinforcement: +4% hull per sealed breach' };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function makeMission(kind, players = []) {
  if (kind === 'reactor') {
    const target = Array.from({ length: 5 }, () => randomInt(0, 4));
    const tiles = target.map(() => randomInt(0, 4));
    if (tiles.every((v,i) => v === target[i])) tiles[0] = (tiles[0] + 1) % 4;
    return { id:randomUUID(), kind, target, tiles, done: false };
  }
  if (kind === 'oxygen') return { id:randomUUID(), kind, target: Array.from({length:3},()=>randomInt(1,5)), valves: [0, 0, 0], done: false };
  if (kind === 'navigation') {
    const safeRoute = new Set(['0,1','0,2','0,3','0,4','1,4','2,4','3,4','4,4']);
    const candidates = Array.from({length:25},(_,i)=>[i%5,Math.floor(i/5)]).filter(([x,y])=>!(x===0&&y===0)&&!safeRoute.has(`${x},${y}`));
    const hazards = Array.from({length:6},()=>candidates.splice(randomInt(0,candidates.length),1)[0]);
    return { id:randomUUID(), kind, ship: [0, 0], goal: [4, 4], hazards, moves: 0, maxMoves: 10 + (players.some(p => p.role === 'Navigator') ? 2 : 0), done: false };
  }
  if (kind === 'sync') return { id:randomUUID(), kind, synced: [], windowEnds: Date.now() + 60000, done: false };
  if (kind === 'hull') return { id:randomUUID(), kind, sealed: [], done: false };
  return { id:randomUUID(), kind, sequence: [randomInt(1,5), randomInt(1,5), randomInt(1,5)], entered: [], engines: false, done: false };
}

export function createRoom(host, now = Date.now()) {
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(0, 32)]).join('');
  const player = { id: host.id, name: host.name, role: ROLE_NAMES[0], ready: false, connected: true, contribution: 0, joinedAt: now };
  return { code, hostId: host.id, phase: 'lobby', players: [player], createdAt: now, updatedAt: now, missionIndex: 0, mission: null, systems: { reactor: 100, oxygen: 100, hull: 100, power: 100 }, endAt: null, startedAt: null, completed: [], events: [], coordination: 0, result: null, actionTimes: {} };
}

export function addPlayer(room, player, now = Date.now()) {
  if (room.phase === 'playing') throw Error('This room is already in a mission.');
  if (room.players.length >= 6) throw Error('Crew capacity reached (6).');
  if (room.players.some(p => p.id === player.id)) throw Error('That crew member is already in this room.');
  const role = ROLE_NAMES.find(candidate => !room.players.some(p => p.role === candidate));
  room.players.push({ ...player, role, ready: false, connected: true, contribution: 0, joinedAt: now });
  room.updatedAt = now;
}

export function setReady(room, playerId, ready) {
  const p = room.players.find(x => x.id === playerId);
  if (!p || room.phase !== 'lobby') throw Error('Ready status cannot be changed now.');
  p.ready = !!ready;
  room.updatedAt = Date.now();
}

export function startMatch(room, hostId, now = Date.now()) {
  if (room.hostId !== hostId) throw Error('Only the captain can launch.');
  if (room.phase !== 'lobby' || room.players.length < 2 || !room.players.every(p => p.ready && p.connected)) throw Error('Two connected, ready crew members are required.');
  room.phase = 'playing'; room.startedAt = now; room.endAt = now + 8 * 60 * 1000; room.updatedAt = now; room.missionIndex = 0; room.mission = makeMission(MISSION_ORDER[0], room.players);
  room.events.push({ type: 'launch', at: now, text: 'CRITICAL SYSTEM FAILURE. REACTOR MELTDOWN IN 08:00. CREW ACTION REQUIRED.' });
}

function finishMission(room, now) {
  room.mission.done = true; room.completed.push(room.mission.kind); room.coordination += new Set(room.players.filter(p => p.connected).map(p => p.id)).size;
  room.events.push({ type: 'mission', at: now, text: `${MISSION_META[room.mission.kind].name} restored.` });
  room.systems.power = clamp(room.systems.power + 10, 0, 100);
  room.systems.reactor = clamp(room.systems.reactor + 12, 0, 100);
  room.systems.oxygen = clamp(room.systems.oxygen + 8, 0, 100);
  room.missionIndex++;
  if (room.missionIndex >= MISSION_ORDER.length) { room.mission = null; room.phase = 'victory'; room.result = makeResult(room, now, true); }
  else room.mission = makeMission(MISSION_ORDER[room.missionIndex], room.players);
}

function makeResult(room, now, victory) {
  const leader = [...room.players].sort((a,b) => b.contribution - a.contribution)[0];
  const rating = victory ? (room.coordination >= 10 ? 'S' : room.coordination >= 6 ? 'A' : 'B') : 'D';
  return { victory, survivalSeconds: Math.max(0, Math.floor((now - room.startedAt) / 1000)), missions: room.completed.length, coordination: room.coordination, leader: leader?.name ?? 'Crew', rating,
    narrative: victory ? `Against the odds, ${room.completed.length} critical systems came back online. ${leader?.name ?? 'The crew'} led the response as the escape pod cleared the blast radius.` : `The crew restored ${room.completed.length} systems before the ship was lost. ${room.events.at(-1)?.text ?? 'The emergency overwhelmed the ship.'}` };
}

export function tickRoom(room, now = Date.now()) {
  if (room.phase !== 'playing') return false;
  room.systems.reactor = clamp(room.systems.reactor - 0.16, 0, 100);
  // Crew must stabilize the atmosphere and ship power before reserves collapse.
  room.systems.oxygen = clamp(room.systems.oxygen - 0.22, 0, 100);
  room.systems.power = clamp(room.systems.power - 0.025, 0, 100);
  room.systems.oxygen = clamp(room.systems.oxygen - 0.22, 0, 100);
  room.systems.power = clamp(room.systems.power - 0.025, 0, 100);
  if (room.systems.oxygen <= 0 || room.systems.hull <= 0 || room.systems.reactor <= 0 || now >= room.endAt) {
    room.phase = 'defeat'; room.result = makeResult(room, now, false); room.events.push({ type: 'defeat', at: now, text: 'SHIP LOST — CREW EVACUATION FAILED.' }); return true;
  }
  return true;
}

export function applyAction(room, playerId, action, now = Date.now()) {
  if (room.phase === 'playing' && now >= room.endAt) tickRoom(room, now);
  if (room.phase !== 'playing' || !room.mission || room.mission.done) throw Error('No active mission.');
  const player = room.players.find(p => p.id === playerId && p.connected);
  if (!player) throw Error('Crew member is not connected to this room.');
  const m = room.mission;
  let success = false;
  if (m.kind === 'reactor' && action.type === 'rotate' && Number.isInteger(action.index) && action.index >= 0 && action.index < 5) {
    m.tiles[action.index] = (m.tiles[action.index] + 1) % 4; success = m.tiles.every((v,i) => v === m.target[i]);
    if (player.role === 'Engineer') room.systems.reactor = clamp(room.systems.reactor + 0.5,0,100);
    if (success) room.systems.reactor = clamp(room.systems.reactor + 12,0,100);
  } else if (m.kind === 'oxygen' && action.type === 'valve' && Number.isInteger(action.index) && action.index >= 0 && action.index < 3) {
    m.valves[action.index] = (m.valves[action.index] + 1) % 5; success = m.valves.every((v,i) => v === m.target[i]);
    if (player.role === 'Medic') room.systems.oxygen = clamp(room.systems.oxygen + 1,0,100);
    if (success) room.systems.oxygen = clamp(room.systems.oxygen + 18,0,100);
  } else if (m.kind === 'navigation' && action.type === 'move' && ['up','down','left','right'].includes(action.direction)) {
    const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[action.direction], next = [m.ship[0]+d[0],m.ship[1]+d[1]]; m.moves++;
    if (next.some(v => v < 0 || v > 4) || m.hazards.some(([x,y]) => x===next[0] && y===next[1]) || m.moves > m.maxMoves) {
      room.systems.hull = clamp(room.systems.hull - 8,0,100); room.systems.reactor = clamp(room.systems.reactor - 5,0,100); m.moves = 0; m.ship = [0,0];
    } else { m.ship = next; success = next[0]===4 && next[1]===4; }
  } else if (m.kind === 'sync' && action.type === 'sync' && Number.isInteger(action.node) && action.node >= 0 && action.node < 3) {
    if (now > m.windowEnds) { m.synced = []; m.windowEnds = now + 60000; }
    if (m.synced.some(x => x.node === action.node)) throw Error('That node is already synchronized.');
    const maxNodes = player.role === 'Systems Analyst' ? 3 : 2;
    if (m.synced.filter(x => x.playerId === playerId).length >= maxNodes) throw Error(`Your role can hold ${maxNodes} nodes; ask another crew member to help.`);
    m.synced.push({ node: action.node, playerId }); success = m.synced.length === 3;
    if (success) room.systems.reactor = clamp(room.systems.reactor + 20,0,100);
  } else if (m.kind === 'hull' && action.type === 'seal' && Number.isInteger(action.section) && action.section >= 0 && action.section < 3) {
    if (m.sealed.includes(action.section)) throw Error('That hull section is already sealed.');
    m.sealed.push(action.section); room.systems.hull = clamp(room.systems.hull + (player.role==='Security'?12:8),0,100); success = m.sealed.length === 3;
  } else if (m.kind === 'launch') {
    if (action.type === 'launchCode' && !m.engines) {
      const i = m.entered.length;
      if (action.value !== m.sequence[i]) { m.entered = []; room.systems.power = clamp(room.systems.power - 10,0,100); throw Error('Incorrect glyph. Sequence reset; power -10%.'); }
      m.entered.push(action.value);
    } else if (action.type === 'engines' && m.entered.length === 3) { m.engines = true; room.systems.power = clamp(room.systems.power + (player.role==='Pilot'?20:15),0,100); }
    else if (action.type === 'escape' && m.engines) success = true;
    else throw Error('Complete the launch sequence before that action.');
  } else throw Error('Invalid action for this mission.');
  player.contribution++;
  if (success) finishMission(room, now);
  room.updatedAt = now;
  return { success, completed: room.phase === 'victory' || room.mission?.done };
}

export function makeResultSnapshot(room) { return room.result; }
export function resetMatch(room, playerId, requireHost = true) {
  if (!['victory','defeat'].includes(room.phase)) throw Error('The mission is still in progress.');
  if (requireHost && room.hostId !== playerId) throw Error('Only the captain can reset for a rematch.');
  room.phase='lobby'; room.mission=null; room.missionIndex=0; room.systems={reactor:100,oxygen:100,hull:100,power:100}; room.endAt=null; room.startedAt=null; room.completed=[]; room.events=[]; room.result=null; room.coordination=0; room.updatedAt=Date.now();
  for (const p of room.players) { p.ready=false; p.contribution=0; }
}
export { makeMission, ROLE_NAMES };
