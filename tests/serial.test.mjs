import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialTransport} from '../web/lib/transports.mjs';

test('Web Serial reader accepts split UTF-8 chunks, reports bad frames, and cancels cleanly',async()=>{
  let input,opened,closed=false,requested=0;const writes=[];
  const port={
    readable:new ReadableStream({start(c){input=c;}}),
    writable:new WritableStream({write(bytes){writes.push(new TextDecoder().decode(bytes));}}),
    async open(options){opened=options;},async close(){closed=true;}
  };
  const transport=new SerialTransport({serial:{async requestPort(){requested++;return port;}}}),messages=[],errors=[];
  transport.on('message',m=>messages.push(m));transport.on('parse_error',e=>errors.push(e));
  await transport.start();const encoder=new TextEncoder();
  input.enqueue(encoder.encode('I,BN5213,1,200,1,1023,REAL\nD,1,500'));
  input.enqueue(encoder.encode('0,75,-1,0\r\nADC:75\nD,2,10000,80,-1,0\n'));
  await new Promise(resolve=>setImmediate(resolve));await transport.send('M,7');
  assert.equal(requested,1);assert.equal(opened.baudRate,115200);
  assert.equal(messages.length,3);assert.equal(messages[1].adc[0],75);assert.equal(messages[2].seq,2);assert.equal(errors.length,1);
  assert.ok(writes.includes('I\n'));assert.ok(writes.includes('M,7\n'));
  await assert.rejects(transport.send('M,7\nI'));
  await transport.stop();assert.equal(closed,true);assert.equal(port.readable.locked,false);assert.equal(port.writable.locked,false);
});
test('Unsupported browser fails explicitly instead of using simulated data as real',async()=>{
  const transport=new SerialTransport({serial:null});await assert.rejects(transport.start(),/Web Serial/);
});
