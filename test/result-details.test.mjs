import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {launchBrowser} from '../src/browser.mjs';

test('详情显示同总分不同分项、仲裁依据、旧记录缺失和文本安全', {timeout:30000}, async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('https://fixture.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?fs.readFileSync(new URL(`../ui${new URL(route.request().url()).pathname}`,import.meta.url),'utf8'):'<div id="details"></div>'}));
  await page.goto('https://fixture.test/');
  await page.evaluate(async()=>{
    const {renderResultDetails}=await import('/result-details.js');window.renderResultDetails=renderResultDetails;
    const a={score:4,model:'主模型',studentAnswer:'作答A',comment:'第一项符合规则',scoringDetails:[{label:'第一空',score:4},{label:'第二空',score:0}]};
    const b={...a,model:'复模型',scoringDetails:[{label:'第一空',score:0},{label:'第二空',score:4}]};
    const verdict={score:2,model:'仲裁模型',comment:'<script>window.injected=true</script>有效数字不足扣分',scoringDetails:[{label:'第一空',score:2,reason:'有效数字不足'},{label:'第二空',score:0}]};
    renderResultDetails(document.querySelector('#details'),{mode:'unattended',presetName:'方案',state:'submitted',result:{...verdict,dualEval:{result:'arbitration',a,b,verdict}},receipt:{confirmed:true,scores:[2]}},true);
  });
  const text=await page.locator('#details').innerText();assert.match(text,/无人值守/);assert.match(text,/分数不一致/);assert.match(text,/总分差 0 分/);assert.match(text,/服务器已确认保存/);
  await page.getByText('仲裁 · 仲裁模型 · 2 分',{exact:true}).click();assert.match(await page.locator('#details').innerText(),/有效数字不足扣分/);assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.evaluate(()=>window.renderResultDetails(document.querySelector('#details'),{result:{score:2,subScores:[]}},true));
  assert.match(await page.locator('#details').innerText(),/未保存逐项明细/);
  await page.evaluate(()=>{
    const a={score:0,scoringDetails:['①第（1）问','②第（2）问','③第（3）问A空箱质量','④第（3）问B空箱质量'].map(label=>({label,score:0}))};
    const b={score:2,scoringDetails:['（1）','（2）','（3）A空箱质量','（3）B空箱质量'].map((label,i)=>({label,score:i===0?2:0}))};
    window.renderResultDetails(document.querySelector('#details'),{result:{...a,dualEval:{result:'arbitration',a,b,verdict:a}}},true);
  });
  assert.equal(await page.locator('tbody tr').count(),4);
  const rows=await page.locator('tbody tr').allInnerTexts();
  assert.match(rows[0],/0 分.*2 分.*0 分.*分数不一致/s);
  assert.ok(rows.slice(1).every(row=>row.includes('分数一致')));
  assert.ok(rows.every(row=>!row.includes('未提供')));
  await page.evaluate(()=>{
    const a={score:0,scoringDetails:['(1)第（1）问','(2)第（2）问','(3)第（3）问A空箱质量','(3)第（3）问B空箱质量'].map(label=>({label,score:0}))};
    const b={score:4,scoringDetails:['①第 （1） 问','②第 （2） 问','③第 （3） 问A空箱质量','④第 （3） 问B空箱质量'].map((label,i)=>({label,score:i===1?4:0}))};
    window.renderResultDetails(document.querySelector('#details'),{result:{...a,dualEval:{result:'arbitration',a,b,verdict:a}}},true);
  });
  assert.equal(await page.locator('tbody tr').count(),4);
  const repeatedRows=await page.locator('tbody tr').allInnerTexts();
  assert.match(repeatedRows[1],/0 分.*4 分.*0 分.*分数不一致/s);
  assert.ok(repeatedRows.every(row=>!row.includes('未提供')));
  await page.evaluate(()=>window.renderResultDetails(document.querySelector('#details'),{result:{score:2,studentAnswer:'a=[无法辨认]',recognitionWarning:'书写识别存疑，请人工确认',recognition:{status:'uncertain',coverageChecked:true,notes:['旧答案划掉，替换内容位于横线上方'],issues:[{location:'图1第（1）问右侧',observed:'a=[无法辨认]',reason:'字迹与涂抹重叠'}]}}}));
  const reading=await page.locator('#details').innerText();
  assert.match(reading,/横线上方/);assert.match(reading,/图1第（1）问右侧/);assert.match(reading,/字迹与涂抹重叠/);assert.match(reading,/人工确认/);
});
