import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptationTemplates,createTemplateGroup} from '../src/adaptation-templates.mjs';
import {applyGroup,matchingGroup} from '../src/adaptation.mjs';

test('整套网站方案覆盖27个适配，智学网跨子域使用内置核验，保留自定义优先级',()=>{
  assert.equal(adaptationTemplates.length,27);
  const group=createTemplateGroup('zhixue','','z');
  const cfg=applyGroup({adaptationGroups:[group]},'https://www.zhixue.com/webmarking/new/#/marking/personal/?examId=new');
  assert.equal(cfg.platform.identityMode,'zhixue-network');assert.equal(cfg.platform.verified,true);
  assert.equal(matchingGroup([group],'https://pt-ali-bj.zhixue.com/marking/').id,'z');
  assert.equal(matchingGroup([group],'https://www.zhixue.com.attacker.test/'),null);
  const custom={id:'custom',url:'https://www.zhixue.com/webmarking/',platform:{imageSelector:'#custom'}};
  assert.equal(matchingGroup([group,custom],'https://www.zhixue.com/webmarking/new/').id,'custom');
  assert.throws(()=>createTemplateGroup('xinkao','','x'),/实际阅卷网址/);
  const local=createTemplateGroup('xinkao','http://192.0.2.1:8080/Marking/DisPlay?id=1','x');assert.equal(local.platform.verified,false);
});
