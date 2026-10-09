import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {endpoint,modelListEndpoint,listModels,requestModel,extractResponse} from '../src/models.mjs';
import {importSettings} from '../src/store.mjs';
import {suiteAdapters} from '../src/suite-adapters.mjs';

test('模型接口保留自定义版本路径、按协议切换终点，支持独立目录地址',()=>{
  for(const base of ['https://fixture.test/v1','https://fixture.test/api/v3']){
    assert.equal(endpoint({endpoint:base}),base+'/chat/completions');
    assert.equal(modelListEndpoint({endpoint:base+'/chat/completions'}),base+'/models');
    assert.equal(endpoint({endpoint:base+'/chat/completions',protocol:'responses'}),base+'/responses');
  }
  assert.equal(endpoint({endpoint:'https://fixture.test'}),'https://fixture.test/v1/chat/completions');
  assert.equal(modelListEndpoint({endpoint:'https://fixture.test/v1beta/models',protocol:'gemini'}),'https://fixture.test/v1beta/models');
  assert.equal(modelListEndpoint({endpoint:'https://fixture.test',modelsEndpoint:'https://fixture.test/catalog'}),'https://fixture.test/catalog');
});

test('原插件对象型模型目录导入后保留ID、名称和标签',()=>{
  const imported=importSettings({presets:{active:'p',list:{p:{}}},providers:{providers:{a:{models:{m:{label:'模型名',tags:['轻量']}}}}},workflows:{workflows:{}}});
  assert.deepEqual(imported.providers.a.models,['m']);assert.equal(imported.providers.a.modelMetadata.m.label,'模型名');assert.equal(imported.providers.a.protocol,'chat');
});

test('27个迁入适配器都有取图、评分框、填分、提交及下一份接口',()=>{
  const provenance=JSON.parse(fs.readFileSync(new URL('../vendor/adapters/upstream.json',import.meta.url),'utf8'));
  assert.equal(provenance.version,'1.21.14.0');assert.equal(Object.keys(provenance.files).length,54);
  for(const a of suiteAdapters){
    const source=fs.readFileSync(new URL('../vendor/adapters/'+a.id+'/adapter.js',import.meta.url),'utf8');
    for(const method of ['gatherAnswerImages','getScoreInputs','fillScores','submitGrade','waitForNextPaper'])assert.match(source,new RegExp('\\b'+method+'\\s*\\('),a.id+': '+method);
  }
});

test('模型目录分页、去重、错误格式不当作空列表；截断仅升级一次',async t=>{
  for(const [protocol,json] of [['responses',{incomplete_details:{reason:'max_output_tokens'}}],['gemini',{candidates:[{finishReason:'MAX_TOKENS'}]}]])assert.throws(()=>extractResponse(json,protocol),error=>error.code==='OUTPUT_TRUNCATED');
  let mode='catalog',calls=0,bodies=[];
  const server=http.createServer(async(req,res)=>{
    calls++;res.setHeader('Content-Type','application/json');
    if(mode==='catalog'){assert.equal(req.headers['x-goog-api-key'],'fixture');res.end(JSON.stringify(req.url.includes('pageToken')?{models:[{name:'models/b'},{name:'models/a'}]}:{models:[{name:'models/a'}],nextPageToken:'page2'}));return;}
    if(mode==='invalid'){res.end('{"message":"not a list"}');return;}
    let body='';for await(const chunk of req)body+=chunk;bodies.push(JSON.parse(body));
    res.end(JSON.stringify({choices:[{finish_reason:mode==='always'||calls===1?'length':'stop',message:{content:'ok'}}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const provider={endpoint:`http://127.0.0.1:${server.address().port}/api/v3`,apiKey:'fixture'};
  assert.deepEqual(await listModels({...provider,protocol:'gemini'}),['a','b']);assert.equal(calls,2);
  mode='invalid';await assert.rejects(listModels(provider),/保留原目录/);
  mode='once';calls=0;assert.equal(await requestModel({...provider,maxOutputTokens:50},'m','prompt',[]),'ok');assert.equal(calls,2);assert.equal(bodies[0].max_tokens,50);assert.ok(!Object.hasOwn(bodies[1],'max_tokens'));
  mode='always';calls=0;await assert.rejects(requestModel({...provider,maxOutputTokens:50},'m','prompt',[]),/截断/);assert.equal(calls,2);
});
