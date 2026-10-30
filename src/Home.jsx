import React from 'react';

const difficultyLabel = value => value === 'daily' ? 'DAILY' : (value || 'normal').toUpperCase();

export default function Home({ name, setName, code, setCode, busy, connected, error, rooms, stats, onCreate, onDaily, onJoin, onWatch }) {
  const dateLabel = new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  return <main className="home-launcher">
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-scene" aria-hidden="true">
        <div className="home-planet"/><div className="home-nebula"/>
        <svg className="home-ship" viewBox="0 0 1000 440" role="presentation">
          <defs><linearGradient id="shipMetal" x1="0" x2="1"><stop stopColor="#142a38"/><stop offset=".52" stopColor="#8ba8ae"/><stop offset=".72" stopColor="#213e4b"/><stop offset="1" stopColor="#0b1822"/></linearGradient><linearGradient id="shipGlow" x1="0" x2="1"><stop stopColor="#00b9e8" stopOpacity="0"/><stop offset=".52" stopColor="#7defff"/><stop offset="1" stopColor="#00a3ce" stopOpacity="0"/></linearGradient></defs>
          <path d="M87 229 245 203 331 145 382 178 619 157 838 198 952 229 822 257 620 279 383 257 326 306 241 253Z" fill="url(#shipMetal)" stroke="#94c0ca" strokeOpacity=".55" strokeWidth="2"/>
          <path d="m238 219 184-26 216-13 189 27-193 31-213 9Z" fill="#08141d" stroke="#7ca8b5" strokeOpacity=".6"/>
          <path d="m337 178 40-83 54 75m-105 87 47 93 58-74M620 159l54-76 42 91m-92 107 60 74 46-96" fill="#213d49" stroke="#8fb4bf" strokeOpacity=".55" strokeWidth="3"/>
          <path d="m89 227-78 5 79-18m-79 31 82 6" stroke="url(#shipGlow)" strokeWidth="10"/><path d="m806 201 104 18m-108 47 104-31" stroke="#58d9ef" strokeOpacity=".55" strokeWidth="3"/>
          <g fill="#7deaff"><circle cx="449" cy="218" r="5"/><circle cx="479" cy="214" r="4"/><circle cx="510" cy="210" r="4"/><circle cx="541" cy="207" r="3"/></g>
        </svg>
        <div className="home-horizon"/>
      </div>
      <div className="home-hero-copy">
        <div className="home-eyebrow"><i/> COOPERATIVE SPACE SURVIVAL · 2–6 CREW</div>
        <h1 id="home-title">ONE CREW.<br/><em>ONE SHIP.</em><br/>SURVIVE TOGETHER.</h1>
        <p>Repair a failing vessel, coordinate under pressure, and make it home before the star takes everything.</p>
        <div className="home-hero-note"><span>OATHBREAKER / DISTRESS SIGNAL</span><span>MISSION WINDOW · 6–8 MIN</span></div>
      </div>
      <div className="home-forms">
        <form className="home-action-panel create-panel" onSubmit={event => { event.preventDefault(); onCreate(); }}>
          <div className="home-panel-kicker"><span>01</span> ASSEMBLE A CREW</div>
          <h2>Create Room</h2><p>Start a new operation and invite your crew.</p>
          <label htmlFor="home-create-name">CALLSIGN</label>
          <input id="home-create-name" autoComplete="nickname" maxLength="18" placeholder="Enter your callsign" value={name} onChange={event => setName(event.target.value)}/>
          <button className="home-primary amber-action" type="submit" disabled={busy || !connected}>CREATE ROOM <b>＋</b></button>
        </form>
        <form className="home-action-panel join-panel" onSubmit={event => { event.preventDefault(); onJoin(); }}>
          <div className="home-panel-kicker"><span>02</span> JOIN AN OPERATION</div>
          <h2>Join Room</h2><p>Enter a room code or choose an open crew below.</p>
          <label htmlFor="home-join-name">CALLSIGN</label>
          <input id="home-join-name" autoComplete="nickname" maxLength="18" placeholder="Enter your callsign" value={name} onChange={event => setName(event.target.value)}/>
          <div className="home-code-row"><label className="sr-only" htmlFor="home-room-code">Room code</label><input id="home-room-code" maxLength="5" autoCapitalize="characters" placeholder="ROOM CODE" value={code} onChange={event => setCode(event.target.value.toUpperCase())}/><button type="submit" disabled={busy || !connected || code.length < 4}>JOIN →</button></div>
        </form>
      </div>
      {error&&<div className="home-error" role="alert">{error}</div>}
      <div className="home-stats" aria-label="Game statistics">
        <div><b>{stats?.missionTypes ?? '—'}</b><span>MISSION TYPES</span></div><div><b>{stats?.liveRooms ?? rooms.length}</b><span>LIVE ROOMS</span></div><div><b>{stats?.crewOnline ?? '—'}</b><span>CREW ONLINE</span></div><div><b>{stats?.difficultyModes ?? '—'}</b><span>DIFFICULTY MODES</span></div>
      </div>
    </section>

    <section className="home-content-grid">
      <section className="home-section live-directory" aria-labelledby="live-rooms-title">
        <div className="home-section-heading"><div><span className="home-section-label">OPEN CHANNELS</span><h2 id="live-rooms-title"><i/> Live Rooms</h2></div><span className="home-refresh">LIVE · AUTO REFRESH</span></div>
        <div className="room-table-head"><span>ROOM / HOST</span><span>CREW</span><span>MODE</span><span>STATUS</span><span>ACTION</span></div>
        {rooms.length ? <div className="home-room-list">{rooms.map(room=><div className="home-room-row" key={room.code}>
          <div className="home-room-identity"><b>{room.code}</b><span>{room.host}</span></div><span className="home-room-count">{room.players} / 6</span><span className={`home-difficulty ${room.difficulty}`}>{difficultyLabel(room.difficulty)}</span><span className={`home-room-status ${room.phase}`}>{room.phase==='playing'?'IN MISSION':'WAITING'}</span>
          <button className="home-room-action" onClick={()=>room.phase==='playing'?onWatch(room.code):onJoin(room.code)}>{room.phase==='playing'?'WATCH':'JOIN'}</button>
        </div>)}</div> : <div className="home-empty-rooms"><b>{connected?'No open crews right now.':'Live room feed disconnected'}</b><span>{connected?'Create a room to bring the next crew online.':'Reconnecting to the game server…'}</span></div>}
        <div className="home-directory-foot">Room names, crew counts, host and mission status update from the live game server.</div>
      </section>

      <aside className="home-side-panels">
        <section className="home-feature-panel daily-feature" id="daily-challenge">
          <div className="home-feature-kicker"><span>UTC · {dateLabel}</span><b>TODAY</b></div><h2>Daily Challenge</h2>
          <p>Every crew receives the same seeded mission run for a fair, shared challenge.</p>
          <div className="daily-details"><span>SHARED RUN SEED</span><b>ONE CHALLENGE · EVERY CREW</b></div>
          <button onClick={onDaily} disabled={busy||!connected}>CREATE TODAY’S RUN <b>→</b></button>
        </section>
        <section className="home-feature-panel how-feature" id="how-to-play">
          <div className="home-feature-kicker"><span>FIELD GUIDE</span><span>3 STEPS</span></div><h2>How to Play</h2>
          <ol><li><b>01</b><span>Create a room or join a crew with its code.</span></li><li><b>02</b><span>Ready up, then work through the mission sequence together.</span></li><li><b>03</b><span>Keep ship systems stable and launch before the timer ends.</span></li></ol>
          <a href="#game-rules">READ THE GAME RULES <b>↓</b></a>
        </section>
      </aside>
    </section>
    <section className="home-rules" id="game-rules"><div><span className="home-section-label">CREW PROTOCOL</span><h2>Game Rules</h2></div><div className="home-rule-list"><span>Cooperate to complete missions in order.</span><span>Use role abilities and crew comms to coordinate.</span><span>Protect reactor, oxygen, hull and ship power.</span><span>Survive the run and complete Emergency Launch.</span></div></section>
    <footer className="home-footer"><span>MISSION ZERO <i/> REAL-TIME CO-OP</span><span>ONE CREW. ONE SHIP. ZERO ROOM FOR ERROR.</span></footer>
  </main>;
}
