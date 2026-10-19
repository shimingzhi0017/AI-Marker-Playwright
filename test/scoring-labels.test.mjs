import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoringLabelKey,alignScoringItems,sameScoringItems} from '../ui/scoring-labels.js';

test('重复外层编号与空格正确对齐，保留实际分歧及歧义保护',()=>{
  const a=['(1)第（1）问','(2)第（2）问','(3)第（3）问A空箱质量','(3)第（3）问B空箱质量'].map(label=>({label,score:0}));
  const b=['①第 （1） 问','②第 （2） 问','③第 （3） 问A空箱质量','④第 （3） 问B空箱质量'].map((label,i)=>({label,score:i===1?4:0}));
  const rows=alignScoringItems(a,b);
  assert.equal(rows.length,4);assert.ok(rows.every(row=>row.items.every(Boolean)));
  assert.equal(sameScoringItems(a,b),false);
  assert.equal(sameScoringItems(a,b.map(item=>({...item,score:0}))),true);
  assert.notEqual(scoringLabelKey('(3)第（3）问A空箱质量'),scoringLabelKey('(3)第（3）问B空箱质量'));
  assert.notEqual(scoringLabelKey('(1)(2)'),scoringLabelKey('(2)'));
  assert.equal(sameScoringItems([{label:'(1)第（1）问',score:0},{label:'①第（1）问',score:0}],a.slice(0,2)),false);
});

test('同一小问的连字符编号与第N项编号可以跨模型对齐',()=>{
  const primary=[
    {label:'第(1)问-2 基本不等式得y≥14400',score:3,maxScore:3},
    {label:'第(1)问-3 等号条件x=4',score:2,maxScore:2},
    {label:'第(2)问-1 建立不等式',score:0,maxScore:4}
  ];
  const secondary=[
    {label:'第（1）问第2项：得到报价下界14400元',score:3,maxScore:3},
    {label:'第（1）问第3项：得到等号条件$x=4$',score:2,maxScore:2},
    {label:'第（2）问第1项：建立并变形恒成立不等式',score:0,maxScore:4}
  ];
  assert.equal(scoringLabelKey(primary[0].label),scoringLabelKey(secondary[0].label));
  assert.equal(scoringLabelKey(primary[1].label),scoringLabelKey(secondary[1].label));
  assert.equal(sameScoringItems(primary,secondary),true);
  assert.ok(alignScoringItems(primary,secondary).every(row=>row.items.every(Boolean)));
});
