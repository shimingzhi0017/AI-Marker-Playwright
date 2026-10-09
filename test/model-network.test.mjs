import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {requestModel} from '../src/models.mjs';

test('断线有限重试、持续失败诊断、鉴权不重试及暂停取消',async t=>{
  let calls=0, mode='once';
  const server=http.createServer((req,res)=>{
    calls++;
    if(mode==='reset'||mode==='once'&&calls===1){req.socket.destroy();return;}
    if(mode==='auth'){res.writeHead(401);res.end('{}');return;}
    if(mode==='slow'){setTimeout(()=>{if(!res.destroyed)res.end('{}');},100);return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"score":2}'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const provider={endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'test'};
  const call=(signal,budget={remaining:6})=>requestModel(provider,'fixture','prompt',[],signal,budget);
  assert.equal(await call(),JSON.stringify({score:2}));assert.equal(calls,2);
  mode='reset';calls=0;await assert.rejects(call(),error=>{assert.match(error.message,/重试后仍失败/);assert.equal(error.modelRequestFailure.attempts,2);return true;});assert.equal(calls,2);
  calls=0;await assert.rejects(call(undefined,{remaining:1}),/网络连接/);assert.equal(calls,1);
  mode='auth';calls=0;await assert.rejects(call(),/HTTP 401/);assert.equal(calls,1);
  mode='reset';calls=0;const controller=new AbortController();const pending=call(controller.signal);setTimeout(()=>controller.abort(Error('用户暂停')),100);await assert.rejects(pending,/用户暂停/);assert.equal(calls,1);
  mode='slow';calls=0;await assert.rejects(requestModel({...provider,timeoutMs:20},'fixture','prompt',[]),/请求超时/);assert.equal(calls,2);
});
