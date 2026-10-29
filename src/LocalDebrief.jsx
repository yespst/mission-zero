import React,{useEffect,useState} from 'react';

export default function LocalDebrief({result,playerId}) {
  const [record,setRecord]=useState(null);
  useEffect(()=>{
    if(!result)return;
    const key='mz-local-records-v1';let records={};
    try{records=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
    const runKey=`${result.challenge||'standard'}-${result.seed}-${result.startedAt}`;
    if(!records.runs?.includes(runKey)){
      const runs=[...(records.runs||[]),runKey].slice(-100);
      records={...records,runs,totalRuns:(records.totalRuns||0)+1,victories:(records.victories||0)+(result.victory?1:0),bestWinSeconds:result.victory?Math.min(records.bestWinSeconds||Infinity,result.survivalSeconds):records.bestWinSeconds||null,bestContributions:Math.max(records.bestContributions||0,result.contributions?.[playerId]||0)};
      localStorage.setItem(key,JSON.stringify(records));
    }
    setRecord(records);
  },[result,playerId]);
  if(!record)return null;
  const badges=[];if(result.victory)badges.push('CREW EXTRACTED');if(result.missions>=6)badges.push('SYSTEMS RESTORED');if((result.contributions?.[playerId]||0)>=8)badges.push('HIGH CONTRIBUTOR');if(result.challenge==='daily'&&result.victory)badges.push('DAILY SURVIVOR');
  return <section className="local-debrief"><div><span>YOUR LOCAL RECORD</span><b>{record.victories} VICTORIES / {record.totalRuns} RUNS</b></div><div><span>PERSONAL BEST</span><b>{record.bestWinSeconds?`${Math.floor(record.bestWinSeconds/60)}:${String(record.bestWinSeconds%60).padStart(2,'0')} SURVIVAL`: 'NO ESCAPE RECORDED'}</b></div><div><span>THIS RUN · YOU</span><b>{result.contributions?.[playerId]||0} CONTRIBUTIONS</b></div>{badges.length>0&&<div className="achievement-row">{badges.map(b=><span key={b}>✦ {b}</span>)}</div>}<small>Saved only in this browser · no global leaderboard is connected.</small></section>;
}
