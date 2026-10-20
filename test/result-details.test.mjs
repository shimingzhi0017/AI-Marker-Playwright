import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {launchBrowser} from '../src/browser.mjs';

test('详情显示同总分不同分项、仲裁依据、旧记录缺失和文本安全', {timeout:30000}, async t=>{
  const browser=await launchBrowser({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('https://fixture.test/**',route=>route.fulfill({contentType:route.request().url().match(/\.m?js$/)?'text/javascript':'text/html',body:route.request().url().match(/\.m?js$/)?fs.readFileSync(new URL(`../ui${new URL(route.request().url()).pathname}`,import.meta.url),'utf8'):'<!doctype html><div id="details"></div>'}));
  await page.goto('https://fixture.test/');
  await page.evaluate(async()=>{
    const {renderResultDetails}=await import('/result-details.js');window.renderResultDetails=renderResultDetails;
    const a={score:4,model:'主模型',studentAnswer:'作答A',comment:'第一项符合规则',scoringDetails:[{label:'第一空',score:4},{label:'第二空',score:0}]};
    const b={...a,model:'复模型',scoringDetails:[{label:'第一空',score:0},{label:'第二空',score:4}]};
    const verdict={score:2,model:'仲裁模型',comment:'<script>window.injected=true</script>有效数字不足扣分',scoringDetails:[{label:'第一空',score:2,reason:'有效数字不足'},{label:'第二空',score:0}]};
    renderResultDetails(document.querySelector('#details'),{mode:'unattended',presetName:'方案',state:'submitted',result:{...verdict,dualEval:{result:'arbitration',a,b,verdict}},receipt:{confirmed:true,scores:[2]}},true);
  });
  await page.evaluate(async()=>{
    const {renderFeedback}=await import('/feedback.js');const probe=document.createElement('div');probe.id='formulaProbe';document.body.append(probe);
    renderFeedback(probe,String.raw`第（1）问：速度为 $\frac{x_2}{2T}$，得2分。 第（2）问：加速度 $a^2$，得0分。 总分=2分。旧写法 x_2/(2T)。`);
  });
  assert.equal(await page.locator('#formulaProbe > p').count(),3);
  assert.equal(await page.locator('#formulaProbe math').count(),3);
  assert.equal(await page.locator('#formulaProbe mfrac').count(),2);
  assert.equal(await page.locator('#formulaProbe msub').count(),2);
  await page.locator('#formulaProbe').evaluate(el=>el.remove());
  await page.evaluate(async()=>{
    const {renderPresetPreview}=await import('/preset-preview.js');
    const probe=document.createElement('div');probe.id='presetFormulaProbe';document.body.append(probe);
    window.formulaSource=String.raw`（3）速度为：v_3=\frac{5L}{5\Delta t–\Delta t_1}=20m/s。即车速应是12.5m/s≤v≤20m/s。`;
    renderPresetPreview(probe,window.formulaSource);
  });
  assert.equal(await page.locator('#presetFormulaProbe mfrac').count(),1);
  assert.equal(await page.locator('#presetFormulaProbe msub').count(),2);
  assert.equal(await page.locator('#presetFormulaProbe math').count(),2);
  assert.doesNotMatch(await page.locator('#presetFormulaProbe').innerText(),/\\frac|\\Delta/);
  assert.ok(await page.evaluate(()=>window.formulaSource.includes('–')));
  await page.locator('#presetFormulaProbe').evaluate(el=>el.remove());
  assert.equal(await page.locator('.review-overview .review-score').count(),2);assert.equal(await page.locator('.review-score-card').count(),4);
  assert.match(await page.locator('#details').innerText(),/老师A 评分/);assert.match(await page.locator('#details').innerText(),/三评仲裁/);
  await page.locator('.review-audit > summary').click();
  const text=await page.locator('#details').innerText();assert.match(text,/无人值守/);assert.match(text,/分数不一致/);assert.match(text,/总分差 0 分/);assert.match(text,/服务器已确认保存/);
  await page.getByText('仲裁 · 仲裁模型 · 2 分',{exact:true}).click();assert.match(await page.locator('#details').innerText(),/有效数字不足扣分/);assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.evaluate(()=>window.renderResultDetails(document.querySelector('#details'),{result:{score:2,subScores:[]}},true));
  await page.locator('.review-audit > summary').click();
  assert.match(await page.locator('#details').innerText(),/未保存逐项明细/);
  await page.evaluate(()=>{
    const formulaLabel=String.raw`第（1）问：甲工程队报价的最小值第1点：正确列出\(y=3\left(150\times 2x+400\times\frac{12}{x}\right)+7200=900\left(x+\frac{16}{x}\right)+7200\)，并注明\(2\le x\le 6\)，得2分`;
    const a={score:2,scoringDetails:[{label:formulaLabel,score:2}]};
    const b={score:2,scoringDetails:[{label:formulaLabel,score:2}]};
    window.renderResultDetails(document.querySelector('#details'),{result:{score:2,scoringDetails:[{label:formulaLabel,score:2}],dualEval:{result:'consensus',a,b}}},true);
  });
  await page.locator('.review-audit > summary').click();
  assert.equal(await page.locator('tbody td:first-child math').count(),2);
  assert.doesNotMatch(await page.locator('tbody td:first-child').first().innerText(),/\\frac|\\left|\\times/);
  await page.evaluate(()=>{
    const label=String.raw`第（1）问：正确列出 y=3\left(150\times 2x+400\times\frac{12}{x}\right)+7200=900\left(x+\frac{16}{x}\right)+7200，并注明 2\le x\le 6，得2分`;
    const details={score:2,scoringDetails:[{label,score:2}]};
    window.renderResultDetails(document.querySelector('#details'),{result:{...details,dualEval:{result:'consensus',a:details,b:details}}},true);
  });
  await page.locator('.review-audit > summary').click();
  assert.ok(await page.locator('tbody td:first-child math').count()>=1);
  assert.doesNotMatch(await page.locator('tbody td:first-child').first().innerText(),/\\frac|\\left|\\times/);
  await page.evaluate(()=>{
    const a={score:0,scoringDetails:['①第（1）问','②第（2）问','③第（3）问A空箱质量','④第（3）问B空箱质量'].map(label=>({label,score:0}))};
    const b={score:2,scoringDetails:['（1）','（2）','（3）A空箱质量','（3）B空箱质量'].map((label,i)=>({label,score:i===0?2:0}))};
    window.renderResultDetails(document.querySelector('#details'),{result:{...a,dualEval:{result:'arbitration',a,b,verdict:a}}},true);
  });
  assert.equal(await page.locator('tbody tr').count(),4);
  await page.locator('.review-audit > summary').click();
  const rows=await page.locator('tbody tr').allInnerTexts();
  assert.match(rows[0],/0 分.*2 分.*0 分.*分数不一致/s);
  assert.ok(rows.slice(1).every(row=>row.includes('分数一致')));
  assert.ok(rows.every(row=>!row.includes('未提供')));
  await page.evaluate(()=>{
    const a={score:0,scoringDetails:['(1)第（1）问','(2)第（2）问','第(3)问A质量','第(3)问B质量'].map(label=>({label,score:0}))};
    const b={score:4,scoringDetails:['①第 （1） 问','②第 （2） 问','③第 （3） 问A空箱质量','④第 （3） 问B空箱质量'].map((label,i)=>({label,score:i===1?4:0}))};
    window.renderResultDetails(document.querySelector('#details'),{result:{...a,dualEval:{result:'arbitration',a,b,verdict:a}}},true);
  });
  assert.equal(await page.locator('tbody tr').count(),4);
  await page.locator('.review-audit > summary').click();
  const repeatedRows=await page.locator('tbody tr').allInnerTexts();
  assert.match(repeatedRows[1],/0 分.*4 分.*0 分.*分数不一致/s);
  assert.ok(repeatedRows.every(row=>!row.includes('未提供')));
  await page.evaluate(()=>{
    const a={score:4,scoringDetails:[{label:'（1）列式及定义域',score:1},{label:'（1）基本不等式求最小值',score:3}]};
    const b={score:6,scoringDetails:[{label:'（1）正确列出报价函数及定义域',score:3},{label:'（1）利用基本不等式得到报价下界',score:3}]};
    const result={score:5,scoringDetails:[{label:'（1）列式及定义域',score:2},{label:'（1）基本不等式求最小值',score:3}],dualEval:{result:'average',a,b}};
    window.renderResultDetails(document.querySelector('#details'),{result},true);
  });
  await page.locator('.review-audit > summary').click();
  const averageRows=await page.locator('tbody tr').allInnerTexts();
  assert.equal(averageRows.length,2);
  assert.match(averageRows[0],/分数不一致/);
  assert.match(averageRows[1],/分数一致/);
  assert.ok(averageRows.every(row=>!row.includes('明细缺失')));
  await page.evaluate(()=>window.renderResultDetails(document.querySelector('#details'),{result:{score:2,studentAnswer:'a=[无法辨认]',recognitionWarning:'书写识别存疑，请人工确认',recognition:{status:'uncertain',coverageChecked:true,notes:['旧答案划掉，替换内容位于横线上方'],issues:[{location:'图1第（1）问右侧',observed:'a=[无法辨认]',reason:'字迹与涂抹重叠'}]}}}));
  const reading=await page.locator('#details').innerText();
  assert.match(reading,/横线上方/);assert.match(reading,/图1第（1）问右侧/);assert.match(reading,/字迹与涂抹重叠/);assert.match(reading,/人工确认/);
});
