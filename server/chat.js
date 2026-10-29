import { randomUUID } from 'node:crypto';

export const CHAT_LIMIT = 80;
export const CHAT_MAX_LENGTH = 250;
export const CHAT_RATE_COUNT = 8;
export const CHAT_RATE_WINDOW_MS = 10_000;

export function cleanChatText(value) {
  if(typeof value!=='string')throw Error('Enter a text message.');
  const text=value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').replace(/\s+/g,' ').trim();
  if(!text)throw Error('Message cannot be empty.');
  if(text.length>CHAT_MAX_LENGTH)throw Error(`Messages are limited to ${CHAT_MAX_LENGTH} characters.`);
  return text;
}

export function appendChat(room,{senderId=null,nickname='SHIP AI',text,kind='player',at=Date.now()}) {
  room.chat||=[];
  const entry={id:randomUUID(),senderId,nickname,text:cleanChatText(text),kind,at};
  room.chat.push(entry);
  if(room.chat.length>CHAT_LIMIT)room.chat.splice(0,room.chat.length-CHAT_LIMIT);
  return entry;
}

export function appendSystemChat(room,text,at=Date.now()) {
  return appendChat(room,{text,nickname:'SHIP AI',kind:'system',at});
}

export function checkChatRate(room,playerId,now=Date.now()) {
  room.chatRate||={};
  const prior=(room.chatRate[playerId]||[]).filter(timestamp=>now-timestamp<CHAT_RATE_WINDOW_MS);
  if(prior.length>=CHAT_RATE_COUNT)throw Error('Crew comms rate limit reached. Wait a moment before sending again.');
  prior.push(now);room.chatRate[playerId]=prior;
}
