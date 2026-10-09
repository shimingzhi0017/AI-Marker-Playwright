import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

test('自选导出目录、取消不写文件、保留自动文件名及格式校验', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-folder-'));
  const selected=path.join(root,"用户选择 ' 中文目录");fs.mkdirSync(selected);
  let choice=selected,calls=0;
  const app=await createApp({root,exportDirectoryPicker:async initial=>{assert.ok(path.isAbsolute(initial));calls++;return choice;}});
  t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const response=await fetch(app.url);const cookie=response.headers.get('set-cookie').split(';')[0];
  const request=async format=>{
    const res=await fetch(app.url+'/api/export-file',{method:'POST',headers:{cookie,origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({format,chooseDirectory:true,openFolder:false})});
    return {status:res.status,value:await res.json()};
  };
  for(const format of ['json','csv','html']){
    const result=await request(format);assert.equal(result.status,200);
    assert.equal(path.dirname(result.value.path),selected);assert.equal(path.extname(result.value.path),'.'+format);assert.ok(fs.existsSync(result.value.path));
  }
  choice=null;assert.equal((await request('json')).value.cancelled,true);
  assert.equal(fs.readdirSync(selected).length,3);assert.ok(!fs.existsSync(path.join(root,'data','exports')));
  const before=calls;assert.equal((await request('invalid')).status,400);assert.equal(calls,before);
});
