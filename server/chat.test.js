import test from 'node:test';
import assert from 'node:assert/strict';
import { appendChat, checkChatRate, CHAT_LIMIT, cleanChatText } from './chat.js';

test('chat sanitizes controls and whitespace while enforcing a 250 character bound',()=>{
 assert.equal(cleanChatText('  hello\n  crew\u0000  '),'hello crew');
 assert.throws(()=>cleanChatText(' '.repeat(2)),/empty/);
 assert.throws(()=>cleanChatText('x'.repeat(251)),/250 characters/);
 assert.throws(()=>cleanChatText({text:'spoof'}),/text message/);
});

test('each room retains only the newest 80 timestamped chat entries',()=>{
 const room={chat:[]};for(let i=0;i<100;i++)appendChat(room,{nickname:'Crew',senderId:'crew',text:`message ${i}`,at:1000+i});
 assert.equal(room.chat.length,CHAT_LIMIT);assert.equal(room.chat[0].text,'message 20');assert.equal(room.chat.at(-1).text,'message 99');assert.equal(new Set(room.chat.map(m=>m.id)).size,CHAT_LIMIT);assert.ok(room.chat.every(m=>typeof m.at==='number'));
});

test('room chat rate window rejects the ninth message then expires old sends',()=>{
 const room={chatRate:{}};for(let i=0;i<8;i++)checkChatRate(room,'crew',1000+i);
 assert.throws(()=>checkChatRate(room,'crew',2000),/rate limit/);
 checkChatRate(room,'crew',11_100);assert.equal(room.chatRate.crew.length,1);
});
