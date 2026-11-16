import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Planner} from '../src/application/planner.ts';
import {newPlan,newNode,newDetail,canonical,clone} from '../src/domain/model.ts';
import {memoryCore} from './support/memory-core.ts';
const fail=(code:string)=>({spec_version:'0.2.1',status:'failed',error:{code,message:code}});
const base=(r:any,key:string)=>({object_id:r.data.object.object_id,expected_revision:r.data.object.revision,expected_sha256:r.data.sha256,operation_key:key});
test('无GUI建立完整结构、保存长详情、固定接入与旧快照导出',async()=>{
 const c=memoryCore();let p=newPlan('雨港','b');p.nodes.push(newNode('volume','第一卷','v'));p.nodes[0].children=['v'];
 const created=await c.planner.invoke('put_plan',{title:'方案',content:p,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'create'});assert.equal(created.status,'succeeded');
 const planId=created.data.object.object_id,d=newDetail(planId,'v');d.goal='找到来信人';d.detailed_plot='## 详细剧情\n\n'+('暴雨中的旧邮局。'.repeat(1000));
 const saved=await c.planner.invoke('put_detail',{title:'第一卷',content:d,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'detail'});assert.equal(saved.status,'succeeded');
 const attached=await c.planner.invoke('attach_object',{...base(created,'attach'),role:'detail',node_id:'v',target:{object_id:saved.data.object.object_id,revision:1,sha256:saved.data.sha256}});assert.equal(attached.status,'succeeded');
 const changed=await c.planner.invoke('put_detail',{...base(saved,'detail-2'),title:'第一卷',content:{...d,goal:'改过的目标'},source_refs:[]});assert.equal(changed.status,'succeeded');
 const query=await c.planner.invoke('query_nodes',{object_id:planId,revision:2,query:'找到来信人'});assert.equal(query.data.nodes.length,1);
 let cursor:any;const parts=[];do{const r=await c.planner.invoke('export_plan',{object_id:planId,revision:2,format:'markdown',scope:'complete',...(cursor?{cursor}:{})});assert.equal(r.status,'succeeded');parts.push(r.data.content);cursor=r.data.next_cursor;}while(cursor);
 assert.ok(parts.join('\n').includes('找到来信人'));assert.ok(!parts.join('\n').includes('改过的目标'));
 const old=await c.planner.invoke('get_plan',{object_id:planId,revision:1});assert.equal(old.data.object.content.nodes[1].detail_ref,null);
 const replay=await c.planner.invoke('attach_object',{...base(created,'attach'),role:'detail',node_id:'v',target:{object_id:saved.data.object.object_id,revision:1,sha256:saved.data.sha256}});assert.deepEqual(replay,attached);
 assert.equal(c.writes,4);
});
test('并发CAS失败保留成果；未知查询失败不执行新save',async()=>{
 const c=memoryCore(),input={title:'方案',content:newPlan('作品','b'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'create'};
 const first=await c.planner.invoke('put_plan',input);
 const second=await c.planner.invoke('patch_node',{...base(first,'a'),node_id:'b',changes:{title:'版本二'}});assert.equal(second.status,'succeeded');
 const conflict=await c.planner.invoke('patch_node',{...base(first,'b'),node_id:'b',changes:{title:'旧输入'}});assert.equal(conflict.error.code,'revision_conflict');
 let saves=0;const planner=new Planner({work_ref:{workspace_id:'w',kind:'novel',object_id:'n'},effect:()=>{},request:async(action)=>{if(action.endsWith('operations.get'))return fail('transport_unavailable') as any;saves++;throw new Error('should not execute');}});
 const result=await planner.invoke('put_plan',input);assert.equal(result.error.code,'transport_unavailable');assert.equal(saves,0);
});
test('只读诊断不写入，坏结构与范围错误明确失败',async()=>{
 const c=memoryCore(),created=await c.planner.invoke('put_plan',{title:'方案',content:newPlan('作品','b'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'create'});
 const before=c.writes,r=await c.planner.invoke('check_plan',{object_id:created.data.object.object_id});assert.equal(r.status,'succeeded');assert.equal(c.writes,before);assert.ok(r.data.issues.length);
 const invalid=await c.planner.invoke('patch_node',{...base(created,'wrong'),node_id:'b',changes:{children:[]}});assert.equal(invalid.error.code,'planner.schema_invalid');
 const malformed=clone(created.data);malformed.object.content.nodes.push(newNode('chapter','孤点','orphan'));c.records.set(malformed.object.object_id,[malformed]);
 assert.equal((await c.planner.invoke('get_plan',{object_id:malformed.object.object_id})).status,'failed');
});

test('NPT-32 非法分页位置与不同固定端点拒绝，不返回伪造完整结果',async()=>{
 const c=memoryCore(),created=await c.planner.invoke('put_plan',{title:'方案',content:newPlan('作品','b'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'create'});
 const id=created.data.object.object_id;
 for(const cursor of ['null','[]',JSON.stringify({tag:'check',id,revision:1,sha:created.data.sha256,offset:-1}),JSON.stringify({tag:'compare',offset:0,unit:0.5})]){
  const result=await c.planner.invoke('check_plan',{object_id:id,cursor:Buffer.from(cursor).toString('base64url')});assert.equal(result.status,'failed');
 }
});

test('NPT-08/25/32 千节点分段检索完整且字节超限不截断',async t=>{
 const c=memoryCore(),p=newPlan('长篇','b');p.nodes.push(newNode('volume','卷','v'));p.nodes[0].children=['v'];for(let i=0;i<998;i++){p.nodes.push(newNode('chapter','同名章','c'+i));p.nodes[1].children.push('c'+i);}
 const started=performance.now(),saved=await c.planner.invoke('put_plan',{title:'千节点',content:p,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'large'});assert.equal(saved.status,'succeeded');
 let cursor:any,ids:string[]=[];do{const page=await c.planner.invoke('query_nodes',{object_id:saved.data.object.object_id,query:'',limit:100,...(cursor?{cursor}:{})});assert.equal(page.status,'succeeded');ids.push(...page.data.nodes.map((n:any)=>n.node.id));cursor=page.data.next_cursor;}while(cursor);assert.equal(ids.length,1000);assert.equal(new Set(ids).size,1000);t.diagnostic('1000节点创建与全量分页耗时 '+Math.round(performance.now()-started)+'ms');
 const tooLarge={...newDetail(saved.data.object.object_id,'b'),detailed_plot:'雨'.repeat(180000)};const rejected=await c.planner.invoke('put_detail',{title:'超限',content:tooLarge,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'over-budget'});assert.equal(rejected.status,'failed');assert.equal(c.writes,1);
});
