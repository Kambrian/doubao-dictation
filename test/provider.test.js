import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildProvider,frame,parseFrame,decodeAudio} from '../provider.js';
test('binary response parsing tolerates empty results, identifies final and rejects truncation',()=>{
 assert.deepEqual(parseFrame(frame(0x90,Buffer.from('{"result":null}'))),{body:{result:null},final:false});
 assert.equal(parseFrame(frame(0x92,Buffer.from('{"result":{"text":"你好"}}'))).final,true);
 assert.throws(()=>parseFrame(Buffer.from([0x11])));
 const b=frame(0x90,Buffer.from('{}'));assert.throws(()=>parseFrame(b.subarray(0,b.length-1)));
});
test('mu-law silence and full-scale samples decode into valid duplicated PCM16',()=>{
 const b=decodeAudio(Buffer.from([255,127,0,128]));
 assert.deepEqual([...Array(8)].map((_,i)=>b.readInt16LE(i*2)),[0,0,0,0,-32124,-32124,32124,32124]);
});
test('Stop during connecting waits for queued audio, commits final once; cancel discards',async()=>{
 const previousKey = process.env.DOUBAO_ASR_API_KEY;
 process.env.DOUBAO_ASR_API_KEY='test-key';
 // This fixture is not a real credential.
 test.after(() => { if (previousKey === undefined) delete process.env.DOUBAO_ASR_API_KEY; else process.env.DOUBAO_ASR_API_KEY = previousKey; });
 let options,open,closeCount=0,finals=[],partials=[];
 const t={sendBinary(){},closeNow(){}};
 const context={createRealtimeTranscriptionWebSocketSession(o){options=o;return {
  connect:()=>new Promise(r=>{open=()=>{o.onOpen(t);r()}}),sendAudio(){},
  close(){closeCount++;o.onClose(t);queueMicrotask(()=>o.onMessage({body:{result:{text:'你好'}},final:true},t))},isConnected:()=>true
 }}};
 const s=buildProvider(context).createSession({onPartial:t=>partials.push(t),onTranscript:t=>finals.push(t)});
 const connection=s.connect();let stopped=false;const finish=s.finish().then(()=>{stopped=true});
 await Promise.resolve();assert.equal(closeCount,0);assert.equal(stopped,false);
 open();await connection;await finish;assert.equal(closeCount,1);assert.deepEqual(partials,['你好']);assert.deepEqual(finals,['你好']);s.close();
 const a=buildProvider(context).createSession({onTranscript:()=>assert.fail('cancelled transcript')});
 const c=a.connect();open();await c;a.close();await Promise.resolve();
});

test('sequence-bearing terminal response and numeric-only provider errors', () => {
 const payload = frame(0x93, Buffer.from('{"result":{"text":"final"}}'));
 const seq = Buffer.alloc(4); seq.writeInt32BE(-1);
 const response = Buffer.concat([payload.subarray(0,4), seq, payload.subarray(4)]);
 assert.deepEqual(parseFrame(response), {body:{result:{text:'final'}},final:true});
 const error = Buffer.alloc(12);error.set([0x11,0xf0,0x10,0]);error.writeUInt32BE(45000030,4);
 assert.throws(() => parseFrame(error), {message:'Doubao ASR error 45000030'});
});

test('catalog construction requires no credential and blank keys are unconfigured', () => {
 const previousKey = process.env.DOUBAO_ASR_API_KEY;
 try {
  delete process.env.DOUBAO_ASR_API_KEY;
  const provider = buildProvider({});
  assert.equal(provider.isConfigured(), false);
  assert.throws(() => provider.createSession({}), /DOUBAO_ASR_API_KEY is missing/);
  process.env.DOUBAO_ASR_API_KEY = '   ';
  assert.equal(provider.isConfigured(), false);
 } finally {
  if (previousKey === undefined) delete process.env.DOUBAO_ASR_API_KEY;
  else process.env.DOUBAO_ASR_API_KEY = previousKey;
 }
});

test('failure reports once, rejects finish, and ignores late results', async () => {
 const previousKey = process.env.DOUBAO_ASR_API_KEY;
 process.env.DOUBAO_ASR_API_KEY = 'test-key';
 try {
  let options, failures = 0, finals = 0;
  const transport = {sendBinary(){}, closeNow(){}};
  const provider = buildProvider({createRealtimeTranscriptionWebSocketSession(o){
   options=o;return {async connect(){o.onOpen(transport)},sendAudio(){},close(){o.onClose(transport)},isConnected:()=>true};
  }});
  const session = provider.createSession({onError(){failures++},onTranscript(){finals++}});
  await session.connect();
  options.callbacks.onError(new Error('connection lost'));
  options.callbacks.onError(new Error('duplicate error'));
  options.onMessage({body:{result:{text:'late'}},final:true},transport);
  await assert.rejects(session.finish(), /connection lost/);
  assert.equal(failures,1);assert.equal(finals,0);session.close();
 } finally {
  if(previousKey===undefined)delete process.env.DOUBAO_ASR_API_KEY;
  else process.env.DOUBAO_ASR_API_KEY=previousKey;
 }
});
