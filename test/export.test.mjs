import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {enrichStudents,exportHistory} from '../src/export.mjs';
test('导出按答卷匹配学生、保留零分分项、CSV文本安全及HTML依据',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'marker-export-'));
  try {
    const log=path.join(root,'events.jsonl');fs.writeFileSync(log,JSON.stringify({type:'network-response',body:{code:200,data:{topicInfo:{detail:{scanRecordId:'scan',markingPaperId:'paper',userCode:'00123',classId:'class'},item:{userId:'student'}}}}}));
    const record={id:'r',snapshot:{networkTopic:{scanRecordId:'scan',markingPaperId:'paper'}},result:{score:0,studentAnswer:'=1+1',comment:'<script>bad</script>',scoringDetails:[{label:'第一空',score:0,reason:'未作答'}],dualEval:{a:{score:2,comment:'主评依据'},b:{score:0,comment:'复评依据'}}}};
    const rows=enrichStudents([record,{...record,id:'other',snapshot:{networkTopic:{scanRecordId:'other',markingPaperId:'paper'}}}],log);
    assert.equal(rows[0].student.userCode,'00123');assert.equal(rows[1].student,null);
    const csv=path.join(root,'a.csv');exportHistory(rows,csv);const text=fs.readFileSync(csv,'utf8');assert.match(text,/第一空得分/);assert.match(text,/"0"/);assert.match(text,/"'=1\+1"/);assert.match(text,/未保存学生标识/);
    const html=path.join(root,'a.html');exportHistory(rows,html);const body=fs.readFileSync(html,'utf8');assert.match(body,/主评依据/);assert.match(body,/复评依据/);assert.ok(!body.includes('<script>bad</script>'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
