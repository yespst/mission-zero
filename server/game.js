import { randomInt, randomUUID } from 'node:crypto';

export const MISSION_ORDER = ['reactor', 'oxygen', 'navigation', 'sync', 'hull', 'launch'];
export const MISSION_TYPES = ['reactor','oxygen','navigation','sync','hull','coolant','signal','shields','powergrid','drone','datacore','launch'];
const REPAIR_POOL = MISSION_TYPES.filter(kind => kind !== 'launch');
export const MISSION_META = {
  reactor: { name: 'Reactor Stabilization', short: 'REACTOR', intro: 'Reroute the unstable energy circuit. Rotate each coupler until every segment matches the solution glyph.', icon: '⌘' },
  oxygen: { name: 'Oxygen Restoration', short: 'OXYGEN', intro: 'Set the three pressure valves to the marked levels. Coordinate the sequence across the crew.', icon: '◉' },
  navigation: { name: 'Navigation Override', short: 'NAVIGATION', intro: 'Plot a safe course across the asteroid field. Move the ship to the extraction beacon without hitting debris.', icon: '⌖' },
  sync: { name: 'Core Synchronization', short: 'CORE SYNC', intro: 'Synchronize all three energy nodes. Each node requires a different crew member to hold the phase.', icon: '⌁' },
  hull: { name: 'Hull Breach', short: 'HULL BREACH', intro: 'Seal the three compromised hull sections before the ship loses pressure.', icon: '◇' },
  launch: { name: 'Emergency Launch', short: 'LAUNCH', intro: 'Enter the three launch glyphs in order, bring the engines online, then initiate escape.', icon: '⇧' },
  coolant: { name:'Coolant Purge', short:'COOLANT', intro:'Route coolant through the safe junctions to stop the thermal cascade.', icon:'❋' },
  signal: { name:'Signal Decryption', short:'SIGNAL', intro:'Combine distributed crew clues to transmit the correct rescue code.', icon:'⌁' },
  shields: { name:'Shield Calibration', short:'SHIELDS', intro:'Match the pulse sequence before the shield window closes.', icon:'⬡' },
  powergrid: { name:'Power Grid Reroute', short:'POWER GRID', intro:'Spend shared energy cells to re-energize oxygen, shield, and comms relays.', icon:'⌗' },
  drone: { name:'Repair Drone', short:'DRONE', intro:'Use the diagnostic report and repair order together to service the drone.', icon:'⌖' },
  datacore: { name:'Data Core Recovery', short:'DATA CORE', intro:'Reconstruct the corrupted access sequence before the archive locks.', icon:'▦' }
};
const ROLE_NAMES = ['Engineer', 'Navigator', 'Systems Analyst', 'Medic', 'Pilot', 'Security'];
export const ROLE_ABILITIES = { Engineer: 'Emergency override: spend a material to restore reactor and power', Navigator: 'Route boost: add moves or restore a grid energy cell', 'Systems Analyst': 'Deep scan: reveal a signal or archive fragment', Medic: 'Atmosphere reserve: spend a canister to restore oxygen', Pilot: 'Power surge: spend an energy cell to boost power', Security: 'Hull patch: spend a material to restore hull integrity' };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function seeded(seed) { let s = (Number(seed) >>> 0) || 1; return () => { s += 0x6D2B79F5; let t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }
function pick(rng, max) { return Math.floor(rng()*max); }
function shuffled(items,rng){ const a=[...items]; for(let i=a.length-1;i>0;i--){const j=pick(rng,i+1);[a[i],a[j]]=[a[j],a[i]];} return a; }
export function dailySeed(date = new Date()) { return Number(`${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}${String(date.getUTCDate()).padStart(2,'0')}`); }
export const DIFFICULTY = {
  normal:{missionCount:5,minutes:8,reactorTiles:4,valves:3,valveLevels:4,hazards:5,navMoves:11,syncNodes:3,syncSeconds:60,hullSections:3,coolantJunctions:3,signalFragments:4,shieldPulses:4,shieldSeconds:45,powerRelays:3,droneSteps:4,dataFragments:4,dataAttempts:5,launchGlyphs:3,startingEnergy:5,emergencySeconds:25,emergencyCooldown:55},
  hard:{missionCount:6,minutes:7,reactorTiles:6,valves:4,valveLevels:5,hazards:8,navMoves:9,syncNodes:4,syncSeconds:42,hullSections:4,coolantJunctions:4,signalFragments:5,shieldPulses:5,shieldSeconds:32,powerRelays:4,droneSteps:5,dataFragments:5,dataAttempts:4,launchGlyphs:4,startingEnergy:6,emergencySeconds:22,emergencyCooldown:48},
  nightmare:{missionCount:7,minutes:6,reactorTiles:8,valves:5,valveLevels:6,hazards:11,navMoves:8,syncNodes:5,syncSeconds:30,hullSections:5,coolantJunctions:5,signalFragments:6,shieldPulses:6,shieldSeconds:23,powerRelays:5,droneSteps:6,dataFragments:6,dataAttempts:3,launchGlyphs:5,startingEnergy:7,emergencySeconds:19,emergencyCooldown:42}
};
export function buildMissionQueue(seed, difficulty='normal') { const rng=seeded(seed); const count=DIFFICULTY[difficulty]?.missionCount??DIFFICULTY.normal.missionCount; return [...shuffled(REPAIR_POOL,rng).slice(0,count),'launch']; }

function makeMission(kind, players = [], rng = Math.random, now = Date.now(), difficulty='normal') {
  const config=DIFFICULTY[difficulty]||DIFFICULTY.normal;
  if (kind === 'reactor') {
    const target = Array.from({ length: config.reactorTiles }, () => pick(rng,4));
    const tiles = target.map(() => (pick(rng,3)+1));
    tiles.forEach((v,i)=>{tiles[i]=(target[i]+v)%4;});
    if (tiles.every((v,i) => v === target[i])) tiles[0] = (tiles[0] + 1) % 4;
    const requiredMoves=tiles.reduce((n,v,i)=>n+(target[i]-v+4)%4,0);
    return { id:randomUUID(), kind, target, tiles,initialTiles:[...tiles],requiredMoves,moveLimit:requiredMoves+config.reactorTiles*(difficulty==='normal'?2:difficulty==='hard'?1:0),moves:0,done: false };
  }
  if (kind === 'oxygen') return { id:randomUUID(), kind, target: Array.from({length:config.valves},()=>1+pick(rng,config.valveLevels-1)), valves: Array(config.valves).fill(0),valveLevels:config.valveLevels,done: false };
  if (kind === 'navigation') {
    const safeRoute = new Set(['0,1','0,2','0,3','0,4','1,4','2,4','3,4','4,4']);
    const candidates = Array.from({length:25},(_,i)=>[i%5,Math.floor(i/5)]).filter(([x,y])=>!(x===0&&y===0)&&!safeRoute.has(`${x},${y}`));
    const hazards = Array.from({length:config.hazards},()=>candidates.splice(pick(rng,candidates.length),1)[0]);
    return { id:randomUUID(), kind, ship: [0, 0], goal: [4, 4], hazards, moves: 0, maxMoves: config.navMoves + (players.some(p => p.role === 'Navigator') ? 2 : 0), done: false };
  }
  if (kind === 'sync') return { id:randomUUID(), kind, nodeCount:config.syncNodes,synced: [], windowEnds: now + config.syncSeconds*1000, done: false };
  if (kind === 'hull') return { id:randomUUID(), kind, sectionCount:config.hullSections,sealed: [], done: false };
  if (kind === 'coolant') { const count=config.coolantJunctions;const safe=[0,1,2,3]; const route=Array.from({length:count},()=>pick(rng,4)); return {id:randomUUID(),kind,route,steps:[],mistakes:0,mistakeLimit:difficulty==='nightmare'?2:difficulty==='hard'?3:5,junctions:Array.from({length:count},(_,i)=>({id:i,ports:shuffled(safe,rng)})),done:false}; }
  if (kind === 'signal') { const sequence=Array.from({length:config.signalFragments},()=>1+pick(rng,5)); const ids=players.filter(p=>p.connected).map(p=>p.id); const clues=Object.fromEntries(ids.map((id,i)=>[id,Array.from({length:sequence.length},(_,position)=>({position,value:sequence[position]})).filter(c=>c.position%Math.max(1,ids.length)===i)])); return {id:randomUUID(),kind,sequence,clues,entered:[],done:false}; }
  if (kind === 'shields') return {id:randomUUID(),kind,sequence:Array.from({length:config.shieldPulses},()=>pick(rng,4)),entered:[],windowEnds:now+config.shieldSeconds*1000,done:false};
  if (kind === 'powergrid') return {id:randomUUID(),kind,relayCount:config.powerRelays,entered:[],done:false};
  if (kind === 'drone') { const ids=players.filter(p=>p.connected).map(p=>p.id); const tools=['gyro','coolant','optic','servo','thruster','relay']; const count=config.droneSteps; const order=shuffled(tools,rng).slice(0,count); const fault=order[pick(rng,order.length)]; return {id:randomUUID(),kind,tools,fault,diagnosticOwner:ids[0],repairOwner:ids[1]||ids[0],diagnosedBy:null,repairOrder:order,repairStep:0,done:false}; }
  if (kind === 'datacore') {const sequence=Array.from({length:config.dataFragments},()=>1+pick(rng,5));const ids=players.filter(p=>p.connected).map(p=>p.id);const clues=Object.fromEntries(ids.map((id,i)=>[id,Array.from({length:sequence.length},(_,position)=>({position,value:sequence[position]})).filter(c=>c.position%Math.max(1,ids.length)===i)]));return {id:randomUUID(),kind,sequence,clues,entered:[],attempts:0,maxAttempts:config.dataAttempts,done:false};}
  return { id:randomUUID(), kind, sequence: Array.from({length:config.launchGlyphs},()=>1+pick(rng,5)), entered: [], engines: false, done: false };
}

export function createRoom(host, now = Date.now()) {
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(0, 32)]).join('');
  const player = { id: host.id, name: host.name, role: ROLE_NAMES[0], ready: false, connected: true, contribution: 0, abilityUsedAt:null, joinedAt: now };
  return { code, hostId: host.id, phase: 'lobby', players: [player], createdAt: now, updatedAt: now, missionIndex: 0, missionQueue: [], runSeed:null,replaySeed:null,difficulty:'normal',challenge:'standard', mission: null, systems: { reactor: 100, oxygen: 100, hull: 100, power: 100 }, resources:{energy:5,materials:5,oxygen:3},endAt: null, startedAt: null, completed: [], events: [],chat:[],chatRate:{}, coordination: 0, result: null, actionTimes: {}, nextEmergencyAt:null };
}

export function addPlayer(room, player, now = Date.now()) {
  if (room.phase === 'playing') throw Error('This room is already in a mission.');
  if (room.players.filter(p => p.connected).length >= 6) throw Error('Crew capacity reached (6).');
  if (room.players.some(p => p.id === player.id)) throw Error('That crew member is already in this room.');
  // Offline sessions remain available for reconnects, but must not occupy a
  // crew berth forever. Evict the oldest offline session only when the roster
  // is full and a new connected player is taking that berth.
  if (room.players.length >= 6) {
    const oldestOffline = room.players.filter(p => !p.connected).sort((a,b) => a.joinedAt - b.joinedAt)[0];
    if (!oldestOffline) throw Error('Crew capacity reached (6).');
    room.players = room.players.filter(p => p.id !== oldestOffline.id);
    if (room.hostId === oldestOffline.id) room.hostId = room.players.find(p => p.connected)?.id || null;
  }
  const role = ROLE_NAMES.find(candidate => !room.players.some(p => p.role === candidate));
  room.players.push({ ...player, role, ready: false, connected: true, contribution: 0, abilityUsedAt:null, joinedAt: now });
  room.updatedAt = now;
}

export function setReady(room, playerId, ready) {
  const p = room.players.find(x => x.id === playerId && x.connected);
  if (!p || room.phase !== 'lobby') throw Error('Ready status cannot be changed now.');
  if (typeof ready !== 'boolean') throw Error('Ready status must be true or false.');
  p.ready = ready;
  room.updatedAt = Date.now();
}

export function canStartMatch(room) {
  const connected = room.players.filter(p => p.connected);
  return room.phase === 'lobby' && connected.length >= 2 &&
    connected.some(p => p.id === room.hostId) && connected.every(p => p.ready);
}

export function setDifficulty(room,playerId,difficulty){if(room.phase!=='lobby'||room.hostId!==playerId)throw Error('Only the captain can change mission settings in the lobby.');if(!['normal','hard','nightmare'].includes(difficulty))throw Error('Unknown difficulty.');room.difficulty=difficulty;room.challenge='standard';room.updatedAt=Date.now();}
export function setChallenge(room,playerId,challenge){if(room.phase!=='lobby'||room.hostId!==playerId)throw Error('Only the captain can change mission settings in the lobby.');if(!['standard','daily'].includes(challenge))throw Error('Unknown challenge.');room.challenge=challenge;room.difficulty='normal';room.updatedAt=Date.now();}
export function startMatch(room, hostId, now = Date.now(), replaySeed = null) {
  if (room.hostId !== hostId) throw Error('Only the captain can launch.');
  if (!canStartMatch(room)) throw Error('At least two connected crew members must be ready before launch.');
  room.runSeed = replaySeed ?? room.replaySeed ?? (room.challenge==='daily'?dailySeed(new Date(now)):randomInt(1,0x7fffffff));room.replaySeed=null;
  room.missionQueue=buildMissionQueue(room.runSeed,room.difficulty);
  const config=DIFFICULTY[room.difficulty]||DIFFICULTY.normal;
  room.phase = 'playing'; room.startedAt = now; room.endAt = now + config.minutes * 60 * 1000; room.updatedAt = now; room.missionIndex = 0; room.resources={energy:config.startingEnergy,materials:5,oxygen:3}; room.nextEmergencyAt=now+30000; room.mission = makeMission(room.missionQueue[0], room.players, seeded(room.runSeed ^ 0x51f15e),now,room.difficulty);
  room.events.push({ type: 'launch', at: now, text: `CRITICAL SYSTEM FAILURE. REACTOR MELTDOWN IN ${String(config.minutes).padStart(2,'0')}:00. CREW ACTION REQUIRED.` });
}

function finishMission(room, now) {
  room.mission.done = true; room.completed.push(room.mission.kind); room.coordination += new Set(room.players.filter(p => p.connected).map(p => p.id)).size;
  room.events.push({ type: 'mission', at: now, text: `${MISSION_META[room.mission.kind].name} restored.` });
  room.systems.power = clamp(room.systems.power + 10, 0, 100);
  room.systems.reactor = clamp(room.systems.reactor + 12, 0, 100);
  room.systems.oxygen = clamp(room.systems.oxygen + 8, 0, 100);
  room.resources.energy=clamp((room.resources.energy||0)+1,0,8); room.resources.materials=clamp((room.resources.materials||0)+1,0,8);
  room.missionIndex++;
  if (room.missionIndex >= room.missionQueue.length) { room.mission = null; room.phase = 'victory'; room.result = makeResult(room, now, true); }
  else room.mission = makeMission(room.missionQueue[room.missionIndex], room.players, seeded(room.runSeed ^ (room.missionIndex+0x51f15e)),now,room.difficulty);
}

function makeResult(room, now, victory) {
  const leader = [...room.players].sort((a,b) => b.contribution - a.contribution)[0];
  const rating = victory ? (room.coordination >= 10 ? 'S' : room.coordination >= 6 ? 'A' : 'B') : 'D';
  return { victory, survivalSeconds: Math.max(0, Math.floor((now - room.startedAt) / 1000)), startedAt:room.startedAt,missions: room.completed.length, missionQueue:room.missionQueue, seed:room.runSeed, difficulty:room.difficulty, challenge:room.challenge, contributions:Object.fromEntries(room.players.map(p=>[p.id,p.contribution])), coordination: room.coordination, leader: leader?.name ?? 'Crew', rating,
    narrative: victory ? `Against the odds, ${room.completed.length} critical systems came back online. ${leader?.name ?? 'The crew'} led the response as the escape pod cleared the blast radius.` : `The crew restored ${room.completed.length} systems before the ship was lost. ${room.events.at(-1)?.text ?? 'The emergency overwhelmed the ship.'}` };
}

export function tickRoom(room, now = Date.now()) {
  if (room.phase !== 'playing') return false;
  room.systems.reactor = clamp(room.systems.reactor - 0.12, 0, 100);
  // Crew must stabilize the atmosphere and ship power before reserves collapse.
  room.systems.oxygen = clamp(room.systems.oxygen - 0.12, 0, 100);
  room.systems.power = clamp(room.systems.power - 0.02, 0, 100);
  // One fair emergency at a time. Its penalty is applied once and is always
  // recoverable through mission rewards / crew abilities.
  const config=DIFFICULTY[room.difficulty]||DIFFICULTY.normal, severity=room.difficulty==='nightmare'?1.45:room.difficulty==='hard'?1.2:1;
  if(room.activeEmergency && !room.activeEmergency.resolved && now>=room.activeEmergency.endsAt){
    const e=room.activeEmergency; e.resolved=true; e.outcome='expired';
    if(e.type==='asteroid')room.systems.hull=clamp(room.systems.hull-Math.round(9*severity),0,100);
    else if(e.type==='oxygen')room.systems.oxygen=clamp(room.systems.oxygen-Math.round(10*severity),0,100);
    else if(e.type==='surge')room.systems.power=clamp(room.systems.power-Math.round(12*severity),0,100);
    else if(e.type==='reactor')room.systems.reactor=clamp(room.systems.reactor-Math.round(10*severity),0,100);
    room.events.push({type:'emergency',at:now,text:e.type==='supply'?'OPTIONAL OBJECTIVE · Supply pod out of range; reserves unchanged.':`${e.label} expired · ship systems degraded.`}); room.activeEmergency=null;room.nextEmergencyAt=now+config.emergencyCooldown*1000;
  }
  if(!room.activeEmergency && now>=room.nextEmergencyAt){ const cards=[['asteroid','Asteroid impact','Brace and stabilize hull'],['oxygen','Oxygen leak','Two crew members close the leak'],['surge','Electrical surge','Two operators ground the surge'],['reactor','Reactor fluctuation','Two engineers hold the containment'],['supply','Supply pod in range','Two crew members can secure optional reserves']];const card=cards[Math.floor((room.runSeed+room.events.length*17)%cards.length)];room.activeEmergency={id:randomUUID(),type:card[0],label:card[1],instruction:card[2],endsAt:now+config.emergencySeconds*1000,responses:[],resolved:false,optional:card[0]==='supply'};room.events.push({type:'emergency',at:now,text:`${card[0]==='supply'?'OPTIONAL OBJECTIVE':'EMERGENCY'} · ${card[1]} — ${card[2]}`}); }
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
  const m = room.mission, config=DIFFICULTY[room.difficulty]||DIFFICULTY.normal;
  let success = false, feedback = null;
  if(action?.type==='respondEmergency'){
    const e=room.activeEmergency;if(!e||e.resolved)throw Error('No active ship emergency.');if(action.emergencyId!==e.id)throw Error('Emergency changed. Refresh the event panel.');if(now>=e.endsAt)throw Error('Emergency response window has closed.');if(e.responses.includes(playerId))throw Error('Your station has already responded.');e.responses.push(playerId);player.contribution++;
    if(e.responses.length>=2){e.resolved=true;e.outcome='contained';if(e.type==='asteroid')room.systems.hull=clamp(room.systems.hull+5,0,100);if(e.type==='oxygen')room.systems.oxygen=clamp(room.systems.oxygen+6,0,100);if(e.type==='surge')room.systems.power=clamp(room.systems.power+6,0,100);if(e.type==='reactor')room.systems.reactor=clamp(room.systems.reactor+7,0,100);if(e.type==='supply'){room.resources.materials=clamp(room.resources.materials+2,0,8);room.resources.energy=clamp(room.resources.energy+1,0,8);room.resources.oxygen=clamp(room.resources.oxygen+1,0,8);}room.events.push({type:'emergency',at:now,text:`${e.type==='supply'?'Optional supply pod secured':e.label+' contained'} by ${e.responses.length} crew members.`});room.activeEmergency=null;room.nextEmergencyAt=now+config.emergencyCooldown*1000;}feedback='Emergency response logged.';
  } else if (m.kind === 'reactor' && action.type === 'rotate' && Number.isInteger(action.index) && action.index >= 0 && action.index < m.tiles.length) {
    if(m.moves>=m.moveLimit){m.tiles=[...m.initialTiles];m.moves=0;room.systems.power=clamp(room.systems.power-(room.difficulty==='nightmare'?8:room.difficulty==='hard'?5:2),0,100);feedback='Coupler move budget exceeded. Circuit reset; power drained.';}else{m.tiles[action.index] = (m.tiles[action.index] + 1) % 4;m.moves++;success = m.tiles.every((v,i) => v === m.target[i]);}
    if (player.role === 'Engineer') room.systems.reactor = clamp(room.systems.reactor + 0.5,0,100);
    if (success) room.systems.reactor = clamp(room.systems.reactor + 12,0,100);
  } else if (m.kind === 'oxygen' && action.type === 'valve' && Number.isInteger(action.index) && action.index >= 0 && action.index < m.valves.length) {
    m.valves[action.index] = (m.valves[action.index] + 1) % m.valveLevels; success = m.valves.every((v,i) => v === m.target[i]);
    if (player.role === 'Medic') room.systems.oxygen = clamp(room.systems.oxygen + 1,0,100);
    if (success) room.systems.oxygen = clamp(room.systems.oxygen + 18,0,100);
  } else if (m.kind === 'navigation' && action.type === 'move' && ['up','down','left','right'].includes(action.direction)) {
    const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[action.direction], next = [m.ship[0]+d[0],m.ship[1]+d[1]]; m.moves++;
    if (next.some(v => v < 0 || v > 4) || m.hazards.some(([x,y]) => x===next[0] && y===next[1]) || m.moves > m.maxMoves) {
      room.systems.hull = clamp(room.systems.hull - 8,0,100); room.systems.reactor = clamp(room.systems.reactor - 5,0,100); m.moves = 0; m.ship = [0,0];
    } else { m.ship = next; success = next[0]===4 && next[1]===4; }
  } else if (m.kind === 'sync' && action.type === 'sync' && Number.isInteger(action.node) && action.node >= 0 && action.node < m.nodeCount) {
    if (now > m.windowEnds) { m.synced = []; m.windowEnds = now + config.syncSeconds*1000;room.systems.reactor=clamp(room.systems.reactor-(room.difficulty==='nightmare'?8:4),0,100); }
    if (m.synced.some(x => x.node === action.node)) throw Error('That node is already synchronized.');
    const maxNodes = player.role === 'Systems Analyst' ? m.nodeCount : Math.ceil(m.nodeCount/Math.max(2,room.players.filter(p=>p.connected).length));
    if (m.synced.filter(x => x.playerId === playerId).length >= maxNodes) throw Error(`Your role can hold ${maxNodes} nodes; ask another crew member to help.`);
    m.synced.push({ node: action.node, playerId }); success = m.synced.length === m.nodeCount;
    if (success) room.systems.reactor = clamp(room.systems.reactor + 20,0,100);
  } else if (m.kind === 'hull' && action.type === 'seal' && Number.isInteger(action.section) && action.section >= 0 && action.section < m.sectionCount) {
    if (m.sealed.includes(action.section)) throw Error('That hull section is already sealed.');
    m.sealed.push(action.section); room.systems.hull = clamp(room.systems.hull + (player.role==='Security'?12:8),0,100); success = m.sealed.length === m.sectionCount;
  } else if (m.kind === 'coolant' && action.type==='route' && Number.isInteger(action.junction) && action.junction===m.steps.length && action.junction<m.route.length && Number.isInteger(action.port) && action.port>=0 && action.port<4) {
    if(action.port!==m.route[action.junction]){m.mistakes++;room.systems.reactor=clamp(room.systems.reactor-(room.difficulty==='nightmare'?7:room.difficulty==='hard'?5:3),0,100);if(m.mistakes>=m.mistakeLimit)m.steps=[];feedback=`Incorrect junction ${m.mistakes}/${m.mistakeLimit}. Coolant pressure vented.`;}else{m.steps.push(action.port);success=m.steps.length===m.route.length;feedback=`Coolant junction ${m.steps.length} of ${m.route.length} locked.`;}
  } else if(m.kind==='signal' && action.type==='signal' && Number.isInteger(action.position) && action.position>=0 && action.position<m.sequence.length && Number.isInteger(action.value) && action.value>=1&&action.value<=5){
    const clue=m.clues?.[playerId]?.find(c=>c.position===action.position);if(!clue||clue.value!==action.value)throw Error('Use the decryption clue assigned to your crew station.');if(m.entered.some(x=>x.position===action.position))throw Error('That signal position is already transmitted.');m.entered.push({position:action.position,value:action.value,playerId});success=m.entered.length===m.sequence.length;feedback=`Signal fragment ${m.entered.length} of ${m.sequence.length} accepted.`;
  } else if(m.kind==='shields' && action.type==='pulse' && Number.isInteger(action.node)&&action.node>=0&&action.node<4){if(now>m.windowEnds){m.entered=[];m.windowEnds=now+config.shieldSeconds*1000;room.systems.hull=clamp(room.systems.hull-(room.difficulty==='nightmare'?7:room.difficulty==='hard'?4:2),0,100);}if(action.node!==m.sequence[m.entered.length]){m.entered=[];room.systems.hull=clamp(room.systems.hull-(room.difficulty==='nightmare'?5:room.difficulty==='hard'?3:1),0,100);feedback='Pulse mismatch. Sequence reset; shield integrity lost.';}else{m.entered.push(action.node);feedback=`Shield pulse ${m.entered.length} of ${m.sequence.length} synchronized.`;success=m.entered.length===m.sequence.length;}}
  else if(m.kind==='powergrid' && action.type==='relay' && Number.isInteger(action.relay)&&action.relay>=0&&action.relay<m.relayCount){if(m.entered.includes(action.relay))throw Error('That relay is already powered.');if(!room.resources.energy)throw Error('Power cells depleted. Complete a repair or use an Engineer ability.');room.resources.energy--;m.entered.push(action.relay);feedback=`Relay ${action.relay+1} of ${m.relayCount} rerouted.`;success=m.entered.length===m.relayCount;}
  else if(m.kind==='drone' && action.type==='diagnose'){if(playerId!==m.diagnosticOwner)throw Error('Only the diagnostic station has the fault report.');m.diagnosedBy=playerId;feedback='Fault identified. Repair station has the service order.';}
  else if(m.kind==='drone' && action.type==='droneRepair' && Number.isInteger(action.part)&&action.part>=0&&action.part<m.tools.length){if(playerId!==m.repairOwner)throw Error('Only the repair station can operate the drone.');if(!m.diagnosedBy)throw Error('Wait for the diagnostic station to identify the fault.');const expected=m.repairOrder[m.repairStep];if(action.part!==m.tools.indexOf(expected)){m.repairStep=0;room.systems.power=clamp(room.systems.power-(room.difficulty==='nightmare'?8:room.difficulty==='hard'?5:3),0,100);feedback='Incorrect service step; drone tool reset.';}else{m.repairStep++;feedback=`Service step ${m.repairStep} of ${m.repairOrder.length} complete.`;success=m.repairStep===m.repairOrder.length;}}
  else if(m.kind==='datacore' && action.type==='dataGlyph'&&Number.isInteger(action.position)&&action.position>=0&&action.position<m.sequence.length&&Number.isInteger(action.value)&&action.value>=1&&action.value<=5){const clue=m.clues?.[playerId]?.find(c=>c.position===action.position);if(!clue||clue.value!==action.value)throw Error('Use the archive fragment assigned to your crew station.');if(m.entered[action.position])throw Error('That archive fragment is already restored.');m.entered[action.position]=action.value;feedback=`Archive fragment ${m.entered.filter(Boolean).length} of ${m.sequence.length} restored.`;success=m.entered.filter(Boolean).length===m.sequence.length;}
  else if (m.kind === 'launch') {
    if (action.type === 'launchCode' && !m.engines) {
      if (m.entered.length >= m.sequence.length) throw Error('Authorization sequence complete. Ignite the engines.');
      const i = m.entered.length;
      if (action.value !== m.sequence[i]) { m.entered = []; room.systems.power = clamp(room.systems.power - 10,0,100); throw Error('Incorrect glyph. Sequence reset; power -10%.'); }
      m.entered.push(action.value); feedback = `Glyph ${m.entered.length} of ${m.sequence.length} accepted.`;
    } else if (action.type === 'engines' && m.entered.length === m.sequence.length) { m.engines = true; room.systems.power = clamp(room.systems.power + (player.role==='Pilot'?20:15),0,100); feedback = 'Engines ignited. Escape protocol ready.'; }
    else if (action.type === 'escape' && m.engines) { success = true; feedback = 'Escape protocol accepted.'; }
    else throw Error('Complete the launch sequence before that action.');
  } else throw Error('Invalid action for this mission.');
  player.contribution++;
  if (success) finishMission(room, now);
  room.updatedAt = now;
  return { success, completed: room.phase === 'victory' || room.mission?.done, feedback };
}

export function useAbility(room, playerId, now=Date.now()) {
  if(room.phase!=='playing')throw Error('Crew abilities are available during a mission.');
  const p=room.players.find(x=>x.id===playerId&&x.connected);if(!p)throw Error('Crew member is not connected to this room.');
  if(p.abilityUsedAt&&now-p.abilityUsedAt<60000)throw Error(`Ability recharging · ${Math.ceil((60000-(now-p.abilityUsedAt))/1000)} seconds.`);
  if(room.resources.materials<=0&&p.role==='Engineer')throw Error('No repair materials remain.');
  if(room.resources.materials<=0&&p.role==='Security')throw Error('No repair materials remain.');
  if(p.role==='Engineer'){room.resources.materials--;room.systems.reactor=clamp(room.systems.reactor+12,0,100);room.systems.power=clamp(room.systems.power+5,0,100);}
  else if(p.role==='Medic'){if(room.resources.oxygen<=0)throw Error('Oxygen reserve depleted.');room.resources.oxygen--;room.systems.oxygen=clamp(room.systems.oxygen+15,0,100);}
  else if(p.role==='Security'){room.resources.materials=Math.max(0,room.resources.materials-1);room.systems.hull=clamp(room.systems.hull+12,0,100);}
  else if(p.role==='Pilot'){if(room.resources.energy<=0)throw Error('Power cell reserve depleted.');room.resources.energy--;room.systems.power=clamp(room.systems.power+18,0,100);}
  else if(p.role==='Navigator'){if(room.mission?.kind==='navigation')room.mission.maxMoves+=2;else if(room.mission?.kind==='powergrid')room.resources.energy=clamp(room.resources.energy+1,0,8);else throw Error('Navigator boost is available during route or grid missions.');}
  else if(p.role==='Systems Analyst'){if(room.mission?.kind==='signal'){const position=room.mission.entered.length,clues=room.mission.clues[playerId]||[];if(position<room.mission.sequence.length&&!clues.some(c=>c.position===position))clues.push({position,value:room.mission.sequence[position]});room.mission.clues[playerId]=clues;}else if(room.mission?.kind==='datacore')room.mission.hint=room.mission.sequence[room.mission.entered.filter(Boolean).length];else throw Error('Analyst scan is available during signal or data missions.');}
  p.abilityUsedAt=now;p.contribution++;room.events.push({type:'ability',at:now,player:p.name,text:`${p.role} ability used.`});room.updatedAt=now;return {feedback:`${p.role} ability deployed.`};
}

export function makeResultSnapshot(room) { return room.result; }
export function resetMatch(room, playerId, requireHost = true) {
  if (!['victory','defeat'].includes(room.phase)) throw Error('The mission is still in progress.');
  if (requireHost && room.hostId !== playerId) throw Error('Only the captain can reset for a rematch.');
  room.phase='lobby'; room.mission=null; room.missionQueue=[];room.missionIndex=0;room.replaySeed=null; room.systems={reactor:100,oxygen:100,hull:100,power:100};room.resources={energy:(DIFFICULTY[room.difficulty]||DIFFICULTY.normal).startingEnergy,materials:5,oxygen:3}; room.endAt=null; room.startedAt=null; room.completed=[]; room.events=[];room.chat=[];room.chatRate={};room.activeEmergency=null;room.nextEmergencyAt=null; room.result=null; room.coordination=0; room.updatedAt=Date.now();
  for (const p of room.players) { p.ready=false; p.contribution=0;p.abilityUsedAt=null; }
}
export { makeMission, ROLE_NAMES };
