import React, { useEffect, useState } from 'react';

const RECORD_KEY = 'mz-local-records-v1';

function readRecords() {
  try { return JSON.parse(localStorage.getItem(RECORD_KEY) || '{}') || {}; }
  catch { return {}; }
}

function UserIcon({ className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.25"/><circle cx="12" cy="9" r="3.1"/><path d="M5.5 18.3c.9-2.55 3.25-4.05 6.5-4.05s5.6 1.5 6.5 4.05"/></svg>;
}

export function ProfileButton({ name, onClick }) {
  return <button className="home-profile" type="button" onClick={onClick} aria-label="Open player profile" aria-haspopup="dialog">
    <span className="profile-avatar"><UserIcon/>{name.trim() ? <b>{name.trim().charAt(0).toUpperCase()}</b> : null}</span>
    <span className="profile-button-copy"><b>{name.trim() || 'PLAYER PROFILE'}</b><small>CALLSIGN & RECORD</small></span>
  </button>;
}

export default function PlayerProfile({ open, onClose, name, onNameSaved }) {
  const [draft, setDraft] = useState(name);
  const [records, setRecords] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(name);
    setRecords(readRecords());
    setError('');
    setSaved(false);
  }, [open, name]);

  useEffect(() => {
    if (!open) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  const total = Number(records.totalRuns) || 0;
  const victories = Number(records.victories) || 0;
  const defeats = Math.max(0, total - victories);
  const earned = new Set(Array.isArray(records.achievements) ? records.achievements : []);
  if (victories > 0) earned.add('CREW EXTRACTED');
  if ((Number(records.bestContributions) || 0) >= 8) earned.add('HIGH CONTRIBUTOR');
  const achievements = [...earned];
  const recent = Array.isArray(records.recentResults) ? [...records.recentResults].reverse() : [];

  function save(event) {
    event.preventDefault();
    const value = draft.trim().replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > 18) { setError('Callsign must be 2–18 characters.'); return; }
    localStorage.setItem('mz-name', value);
    onNameSaved(value);
    setSaved(true);
    setError('');
  }

  return <div className="profile-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-panel" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header className="profile-panel-head"><div><span className="profile-eyebrow">CREW IDENTIFICATION</span><h2 id="profile-title">Player Profile</h2></div><button type="button" className="profile-close" onClick={onClose} aria-label="Close profile">×</button></header>
      <div className="profile-identity"><span className="profile-large-avatar"><UserIcon/>{name.trim() ? <b>{name.trim().charAt(0).toUpperCase()}</b> : null}</span><div><strong>{name.trim() || 'UNASSIGNED CALLSIGN'}</strong><small>LOCAL CREW RECORD · THIS BROWSER</small></div></div>
      <form className="profile-edit" onSubmit={save}>
        <label htmlFor="profile-callsign">CALLSIGN</label><input id="profile-callsign" value={draft} maxLength={18} autoComplete="nickname" onChange={event => { setDraft(event.target.value); setSaved(false); }}/>
        {error && <p className="profile-error" role="alert">{error}</p>}
        {saved && <p className="profile-saved" role="status">Callsign updated. Your room forms now use {draft.trim()}.</p>}
        <div className="profile-edit-actions"><button type="button" className="profile-cancel" onClick={onClose}>CANCEL</button><button type="submit" className="profile-save">SAVE CALLSIGN</button></div>
      </form>
      <div className="profile-record-heading"><span>PERSONAL RECORD</span><small>RECORDED MATCHES</small></div>
      <div className="profile-stats"><div><b>{total}</b><span>MATCHES</span></div><div><b>{victories}</b><span>VICTORIES</span></div><div><b>{defeats}</b><span>DEFEATS</span></div><div><b>{Number.isFinite(records.totalMissionsCompleted) ? records.totalMissionsCompleted : '—'}</b><span>MISSIONS</span></div></div>
      {!Number.isFinite(records.totalMissionsCompleted) && <p className="profile-data-note">Older matches did not store mission totals, so this lifetime count is unavailable for this save.</p>}
      <section className="profile-achievements"><div className="profile-section-title">EARNED ACHIEVEMENTS <span>{achievements.length}</span></div>{achievements.length ? <div className="profile-achievement-list">{achievements.map(item => <span key={item}><i>✦</i>{item}</span>)}</div> : <p>No achievements recorded yet. Complete a run to earn your first.</p>}</section>
      <section className="profile-recent"><div className="profile-section-title">RECENT MATCHES <span>{recent.length}</span></div>{recent.length ? <div className="profile-recent-list">{recent.slice(0, 5).map((item, index) => <div key={`${item.at || index}-${index}`}><i className={item.victory ? 'result-win' : 'result-loss'}/><b>{item.victory ? 'VICTORY' : 'DEFEAT'}</b><span>{item.missions} MISSIONS</span><small>{item.difficulty || 'NORMAL'} · {item.at ? new Date(item.at).toLocaleDateString() : 'RECORDED'}</small></div>)}</div> : <p>No recent matches recorded.</p>}</section>
      <footer className="profile-footnote">Records and callsign are stored locally in this browser.</footer>
    </section>
  </div>;
}
