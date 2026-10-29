import React,{useEffect,useRef,useState} from 'react';

const QUICK=['Repairing reactor','Need assistance','Oxygen critical','Ready to launch','I have the navigation controls','Hull team, report in'];
const time=(at)=>new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(at));

export default function ChatDock({history=[],playerId,connected,open,onToggle,unread,onSend,onQuick}) {
  const [draft,setDraft]=useState('');const endRef=useRef(null);const inputRef=useRef(null);
  useEffect(()=>{if(open)endRef.current?.scrollIntoView({behavior:'smooth',block:'end'});},[history.length,open]);
  async function submit(event){event.preventDefault();const text=draft.trim();if(!text||!connected)return;const sent=await onSend(text);if(sent){setDraft('');inputRef.current?.focus();}}
  return <section className={`chat-dock ${open?'is-open':''}`} aria-label="Crew chat">
    <button className="chat-toggle" type="button" aria-expanded={open} onClick={onToggle}><span className="chat-toggle-icon">⌁</span><span>CREW COMMS</span>{!connected&&<i className="chat-status-dot offline"/>}{connected&&<i className="chat-status-dot"/>}{unread>0&&!open&&<b className="chat-unread">{unread>99?'99+':unread}</b>}<span className="chat-chevron">{open?'⌄':'⌃'}</span></button>
    {open&&<div className="chat-panel"><div className="chat-heading"><div><b>SHIP CHANNEL</b><small>{connected?'LIVE · ROOM ONLY':'UPLINK INTERRUPTED · RECONNECTING'}</small></div><span>{history.length} / 80</span><button type="button" aria-label="Collapse crew chat" onClick={onToggle}>×</button></div>
      <div className="chat-history" role="log" aria-live="polite" aria-relevant="additions text">{history.length===0&&<div className="chat-empty">Crew channel is clear. Send a message when you are ready.</div>}{history.map(item=>{const own=item.senderId===playerId;return <article key={item.id} className={`chat-message ${own?'chat-own':''} ${item.kind==='system'?'chat-system':''}`}><div className="chat-message-meta"><b>{own?'YOU':item.nickname}</b><time dateTime={new Date(item.at).toISOString()}>{time(item.at)}</time></div><p>{item.text}</p></article>;})}<div ref={endRef}/></div>
      <div className="chat-quick-label">QUICK TRANSMISSIONS</div><div className="chat-quick">{QUICK.map(text=><button type="button" key={text} disabled={!connected} onClick={()=>onQuick(text)}>{text}</button>)}</div>
      <form className="chat-compose" onSubmit={submit}><input ref={inputRef} value={draft} maxLength={250} disabled={!connected} placeholder={connected?'Message your crew…':'Waiting for uplink…'} aria-label="Message your crew" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.stopPropagation()}/><span>{draft.length}/250</span><button type="submit" disabled={!connected||!draft.trim()} aria-label="Send message">SEND ↗</button></form>
    </div>}
  </section>;
}
