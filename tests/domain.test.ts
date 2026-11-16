import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newPlan,newNode,validate,transformNode,clone,effectiveArchived,validateRunChange,validateReferences,type Network,type Detail,type Run} from '../src/domain/model.ts';
const read=(name:string)=>JSON.parse(readFileSync(new URL('../docs/examples/'+name+'.example.json',import.meta.url),'utf8'));
test('树变换保留身份、同名章节与原输入，移动只产生完整结构',()=>{
  let p=newPlan('整书','b');
  p=transformNode(p,'insert_node',{parent_id:'b',node:newNode('volume','同名','v1')});
  p=transformNode(p,'insert_node',{parent_id:'b',node:newNode('volume','同名','v2')});
  p=transformNode(p,'insert_node',{parent_id:'v1',node:newNode('chapter','同名','c1')});
  p=transformNode(p,'insert_node',{parent_id:'v1',node:newNode('chapter','同名','c2'),before_id:'c1'});
  const before=clone(p),moved=transformNode(p,'move_node',{node_id:'c2',parent_id:'v2'});
  assert.deepEqual(p,before);assert.deepEqual(moved.nodes.find(n=>n.id==='v1')!.children,['c1']);
  assert.deepEqual(moved.nodes.find(n=>n.id==='v2')!.children,['c2']);
  assert.throws(()=>transformNode(p,'move_node',{node_id:'v1',parent_id:'c1'}));
  assert.throws(()=>transformNode(p,'move_node',{node_id:'b',parent_id:'v1'}));
  assert.throws(()=>transformNode(p,'insert_node',{parent_id:'v1',node:newNode('chapter','重复ID','c1')}));
});
test('Schema合法的环、多父、孤点、错误层级仍被语义校验拒绝',()=>{
  const original=read('novel-plan');
  for(const mutate of [
    (p:any)=>p.nodes[1].children.push(p.root_id),
    (p:any)=>p.nodes[1].children.push(p.nodes[2].id),
    (p:any)=>p.nodes.push(newNode('chapter','孤点','orphan')),
    (p:any)=>p.nodes[2].children.push(p.nodes[3].id),
  ]){const p=clone(original);mutate(p);assert.throws(()=>validate('novel_plan',p));}
  validate('novel_plan',original);
});
test('归档祖先与子节点独立，恢复父级不清除子节点标记',()=>{
  let p=read('novel-plan');p=transformNode(p,'archive_node',{node_id:'chapter-1',archived:true});
  p=transformNode(p,'archive_node',{node_id:'volume-1',archived:true});assert.equal(effectiveArchived(p,'chapter-2'),true);
  p=transformNode(p,'archive_node',{node_id:'volume-1',archived:false});assert.equal(effectiveArchived(p,'chapter-1'),true);assert.equal(effectiveArchived(p,'chapter-2'),false);
  assert.throws(()=>transformNode(p,'archive_node',{node_id:'book-1',archived:true}));
});
test('长篇与网络独立校验，丢失实体、伏笔和节点明确拒绝',()=>{
  const p=read('novel-plan'),d=read('novel-plan-detail') as Detail,n=read('novel-plan-story-network') as Network;
  validate('novel_plan_detail',d);validate('novel_plan_story_network',n);validateReferences(p,d,n);
  const broken=clone(n);broken.entities.shift();assert.throws(()=>validate('novel_plan_story_network',broken));
  const missing=clone(d);missing.entity_links[0].entity_id='none';assert.throws(()=>validateReferences(p,missing,n));
  const outside=clone(n);outside.clues[0].placements[0].node_id='outside';assert.throws(()=>validateReferences(p,d,outside));
  const long=clone(d);long.detailed_plot='雨'.repeat(120001);assert.throws(()=>validate('novel_plan_detail',long));
});
test('工作状态严格区分报告、未知、停止请求与外部确认',()=>{
  const run=read('novel-plan-run') as Run;validateRunChange(undefined,run);
  const handed={...run,state:'handed_off' as const};validateRunChange(run,handed);
  const running={...handed,state:'running' as const};validateRunChange(handed,running);
  const stop={...running,state:'stop_requested' as const};validateRunChange(running,stop);
  assert.throws(()=>validateRunChange(stop,{...stop,state:'stopped'}));
  const confirmed:Run=clone(stop);confirmed.state='stopped';confirmed.steps[0].evidence={kind:'external_receipt',locator:'confirmed:fixture'};validateRunChange(stop,confirmed);
  assert.throws(()=>validateRunChange(confirmed,running));
  assert.throws(()=>validateRunChange(running,{...running,state:'succeeded'}));
});
