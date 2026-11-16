import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settleFlow,fixedRef,mergeFields,type Pending} from '../src/application/write-flow.ts';
import {memoryCore} from './support/memory-core.ts';
import {newPlan,newDetail} from '../src/domain/model.ts';

test('NPT-12/14/39 单次编辑连续保存元数据与长详情，丢回执后重开沿原键接入',async()=>{
 const core=memoryCore();let serial=0,persisted:Pending|null=null;
 const invoke=async(action:string,input:any)=>{const r=await core.planner.invoke(action,input);if(r.status!=='succeeded')throw new Error(r.error.message);return r.data;};
 const plan=await invoke('put_plan',{title:'方案',content:newPlan('作品','book'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'new'});
 const first:Pending={action:'patch_node',input:{object_id:plan.object.object_id,expected_revision:1,expected_sha256:plan.sha256,operation_key:'meta',node_id:'book',changes:{title:'新标题'}},plan_base:fixedRef(plan),next:{action:'put_detail',input:{title:'详情',content:{...newDetail(plan.object.object_id,'book'),detailed_plot:'长剧情'.repeat(2000)},source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'detail'},attach:{role:'detail',node_id:'book'}}};
 let drop=true;
 const context={key:()=> 'attach-'+ ++serial,persist:async(p:Pending|null)=>{persisted=p?structuredClone(p):null;},invoke:async(action:string,input:any)=>{const r=await invoke(action,input);if(action==='put_detail'&&drop){drop=false;throw new Error('落盘后连接中断');}return r;}};
 await assert.rejects(settleFlow(first,context),/连接中断/);assert.equal(core.writes,3);assert.equal(persisted!.action,'put_detail');
 await settleFlow(persisted!,context);assert.equal(core.writes,4);assert.equal(persisted,null);
 const current=await invoke('get_plan',{object_id:plan.object.object_id});assert.equal(current.object.content.nodes[0].title,'新标题');assert.equal(current.object.revision,3);assert.equal(current.object.content.nodes[0].detail_ref.revision,1);
});
test('NPT-40 接入CAS冲突保留已保存详情和确切接入输入',async()=>{
 const core=memoryCore();const invoke=async(a:string,i:any)=>{const r=await core.planner.invoke(a,i);if(r.status!=='succeeded')throw Object.assign(new Error(r.error.message),{code:r.error.code});return r.data;};
 const p=await invoke('put_plan',{title:'方案',content:newPlan('作品','book'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'new'});
 await invoke('patch_node',{object_id:p.object.object_id,expected_revision:1,expected_sha256:p.sha256,operation_key:'other',node_id:'book',changes:{title:'另一个版本'}});
 let saved:Pending|null=null;
 await assert.rejects(settleFlow({action:'put_detail',plan_base:fixedRef(p),input:{title:'详情',content:newDetail(p.object.object_id,'book'),source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'detail'},attach:{role:'detail',node_id:'book'}},{invoke,key:()=> 'attach',persist:async p=>{saved=p;}}),{code:'revision_conflict'});
 assert.equal(saved!.action,'attach_object');assert.equal(saved!.input.operation_key,'attach');assert.equal(saved!.input.expected_revision,1);assert.equal(core.writes,3);
});

test('NPT-13 三方合并保留远端未编辑字段，同字段竞写只返回待决定项',()=>{
 const base={goal:'查信',theme:'记忆',turns:['旧转折']},local={...base,goal:'找人',turns:['本地转折']},remote={...base,theme:'证词',turns:['外部转折']};
 const merged=mergeFields(base,local,remote);assert.equal(merged.value.goal,'找人');assert.equal(merged.value.theme,'证词');assert.deepEqual(merged.value.turns,['外部转折']);assert.deepEqual(merged.conflicts,[{field:'turns',base:['旧转折'],local:['本地转折'],remote:['外部转折']}]);assert.equal(base.goal,'查信');
});
