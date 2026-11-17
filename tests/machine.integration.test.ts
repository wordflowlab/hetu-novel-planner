import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import manifest from '../contracts/plugin-manifest.json' with {type:'json'};
import {newPlan,newNode,newDetail,clone} from '../src/domain/model.ts';

const host=path.resolve(process.env.HETU_SOURCE??'../../limecloud/hetu');
const resolveHost=createRequire(path.join(host,'apps/desktop/package.json'));
const {Client}=await import(pathToFileURL(resolveHost.resolve('@modelcontextprotocol/client')).href);
const {StdioClientTransport}=await import(pathToFileURL(resolveHost.resolve('@modelcontextprotocol/client/stdio')).href);
const fixed=(r:any)=>({object_id:r.object.object_id,revision:r.object.revision,sha256:r.sha256});
let serial=0;
const base=(r:any)=>({object_id:r.object.object_id,expected_revision:r.object.revision,expected_sha256:r.sha256,operation_key:'test-'+ ++serial});

test('标准小说规划包通过稳定MCP完成四类对象、全部专业动作、开放核心与恢复',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'novel-planner-machine-'));
 const bin=path.join(host,'target/debug');
 const env={...process.env,HETU_PLUGIN_STATE_DIR:path.join(directory,'plugins'),HETU_PLUGIN_ACCESS_DIR:path.join(directory,'access'),HETU_PLUGIN_NODE:process.execPath,HETU_PLUGIN_CLI:path.join(bin,'hetu-plugin'),HETU_PLUGIN_MANAGER:path.join(host,'apps/desktop/dist/plugin-manager.mjs')};
 const client=new Client({name:'novel-planner-acceptance',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
 await client.connect(new StdioClientTransport({command:path.join(bin,'hetu-mcp'),args:['--client','codex','--collaboration-dir',path.join(directory,'hub')],env,stderr:'pipe'}));
 const call=async(name:string,args:any={})=>(await client.callTool({name,arguments:args})).structuredContent as any;
 const ok=async(name:string,args:any={})=>{const r=await call(name,args);assert.equal(r.status,'succeeded',JSON.stringify(r));return r.data;};
 const actions=new Set<string>();let binding:any,cap:any,pkg:any,plan:any,detail:any,network:any,run:any,work:any,management:any;
 const invoke=async(action:string,args:any,success=true)=>{
  const outer=await call('hetu_plugins_invoke',{...binding,capabilities_sha256:cap.capabilities_sha256,action,arguments:args});
  if(!success)return outer;
  assert.equal(outer.status,'succeeded',JSON.stringify(outer));const result=outer.data.result;assert.equal(result.status,'succeeded',JSON.stringify(result));actions.add(action);return result.data;
 };
 const apply=async(action:string)=>ok('hetu_plugins_apply',{action,plugin_id:manifest.id,package_directory:path.resolve('dist'),package_sha256:pkg.package_sha256,expected_sha256:(await ok('hetu_plugins_inspect')).state_sha256,authorization_note:'隔离验收明确选择此固定包。',operation_key:'installation-'+ ++serial});
 const discover=async()=>{
  binding={management_ref:management,work_ref:work,plugin_id:manifest.id,package_sha256:pkg.package_sha256};
  cap=await ok('hetu_plugins_capabilities',binding);
 };
 try{
  await t.test('NPT-01/02 安装前已有连接，安装后发现实际21动作，闭桌面创建小说与方案',async()=>{
   const tools=(await client.listTools()).tools.map((x:any)=>x.name);
   const start=await ok('hetu_begin_creation',{brief:'雨港来信的隔离规划验收',locale:'zh-CN',operation_key:'begin'});
   const created=await ok('hetu_create_novel_from_project',{management_ref:start.management_ref,project_id:start.project.project_id,expected:{revision:start.revision,sha256:start.sha256},target_path:start.target_path,metadata:{title:'雨港来信',author_name:'验收作者',synopsis:'旧邮局的来信。',genre:'悬疑',language_tag:'zh-CN',status:'writing'},operation_key:'create'});
   management=created.workspace_management_ref;work={workspace_id:management.scope_ref.id,kind:'novel',object_id:created.novel.novel_id};
   pkg=await ok('hetu_plugins_inspect_package',{package_directory:path.resolve('dist')});await apply('install');await discover();
   assert.equal(cap.actions.length,manifest.contributions.actions.length);assert.ok(cap.core_actions.some((a:any)=>a.name==='hetu.novels.snapshot'));assert.deepEqual((await client.listTools()).tools.map((x:any)=>x.name),tools);
   const content=newPlan('雨港来信','book');content.nodes.push(newNode('volume','第一卷','volume-a'),newNode('volume','第二卷','volume-b'));content.nodes[0].children=['volume-a','volume-b'];content.author_constraints='保留开放结局。';
   plan=await invoke('put_plan',{title:'雨港方案',content,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'create-plan'});
   assert.equal((await invoke('get_plan',{object_id:plan.object.object_id,revision:1})).sha256,plan.sha256);
   assert.equal((await invoke('list_plans',{limit:1})).objects[0].object_id,plan.object.object_id);
  });
  await t.test('NPT-04/05/06/07/16 稳定ID、同名章、移动归档、CAS及专业输入指纹',async()=>{
   const input={...base(plan),parent_id:'volume-a',node:newNode('chapter','来信','chapter-a')};plan=await invoke('insert_node',input);assert.equal((await invoke('insert_node',input)).sha256,plan.sha256);
   const sameSave=await invoke('put_plan',{object_id:input.object_id,expected_revision:input.expected_revision,expected_sha256:input.expected_sha256,operation_key:input.operation_key,title:plan.object.title,content:plan.object.content,source_refs:plan.object.source_refs??[]},false);assert.equal(sameSave.data?.result?.error?.code??sameSave.error?.code,'idempotency_conflict');
   const changed=await invoke('insert_node',{...input,node:{...input.node,title:'不同输入'}},false);assert.notEqual(changed.data?.result?.status,'succeeded');
   plan=await invoke('insert_node',{...base(plan),parent_id:'volume-a',node:newNode('chapter','来信','chapter-b')});
   plan=await invoke('move_node',{...base(plan),node_id:'chapter-b',parent_id:'volume-b'});
   const old=plan;plan=await invoke('patch_node',{...base(plan),node_id:'volume-b',changes:{target_chapters:8,target_words:30000}});
   const stale=await invoke('patch_node',{...base(old),node_id:'volume-b',changes:{title:'并发旧输入'}},false);assert.notEqual(stale.data?.result?.status,'succeeded');
   plan=await invoke('archive_node',{...base(plan),node_id:'chapter-b',archived:true});plan=await invoke('archive_node',{...base(plan),node_id:'volume-b',archived:true});plan=await invoke('archive_node',{...base(plan),node_id:'volume-b',archived:false});
   assert.equal((await invoke('get_node',{object_id:plan.object.object_id,node_id:'chapter-b'})).effective_archived,true);
  });
  await t.test('NPT-31/34/36/38/41 网络、长详情、伏笔、精确范围与固定附件',async()=>{
   const content={format_version:1,plan_id:plan.object.object_id,entities:[{id:'person',type:'character',name:'江岚',summary:'收到旧信的调查者。',notes:'候选设定',archived:false,canonical_ref:null}],relations:[],clues:[{id:'letter',title:'信封日期',description:'日期早于邮局开业。',status:'open',placements:[{node_id:'chapter-a',stage:'plant',notes:''}],notes:'',archived:false}]};
   network=await invoke('put_story_network',{title:'人物与线索',content,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'network'});
   plan=await invoke('attach_object',{...base(plan),role:'story',target:fixed(network)});
   const d=newDetail(plan.object.object_id,'chapter-a');Object.assign(d,{goal:'找到寄信人',theme:'记忆与证词',summary:'雨夜来信',detailed_plot:'# 雨夜\n\n'+('江岚在旧邮局核对信件。'.repeat(1500)),entity_links:[{entity_id:'person',role:'调查者',notes:'在此出场'}],beats:[{id:'beat-a',title:'发现日期矛盾',summary:'日期使证词失效。',entity_ids:['person'],clue_ids:['letter']}]});
   detail=await invoke('put_detail',{title:'来信详情',content:d,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'detail'});
   plan=await invoke('attach_object',{...base(plan),role:'detail',node_id:'chapter-a',target:fixed(detail)});
   assert.equal((await invoke('get_detail',{object_id:detail.object.object_id,revision:1})).object.content.detailed_plot,d.detailed_plot);
   const scoped=await invoke('get_story_network',{object_id:network.object.object_id,revision:1,plan_ref:fixed(plan),node_id:'volume-a',projection:'entities'});assert.equal(scoped.projection.entities.length,1);assert.equal(scoped.projection.associations[0].node_id,'chapter-a');
   const direct=await invoke('get_story_network',{object_id:network.object.object_id,revision:1,plan_ref:fixed(plan),node_id:'volume-a',scope:'direct'});assert.equal(direct.projection.entities.length,0);
   assert.equal((await invoke('query_nodes',{object_id:plan.object.object_id,query:'找到寄信人'})).nodes[0].node.id,'chapter-a');
   const old=plan;detail=await invoke('put_detail',{...base(detail),title:'来信详情',content:{...d,goal:'找回信件',detailed_plot:d.detailed_plot+'\n新发现'},source_refs:[]});
   assert.equal((await invoke('query_nodes',{object_id:plan.object.object_id,revision:old.object.revision,query:'找到寄信人'})).nodes.length,1);
   plan=await invoke('attach_object',{...base(plan),role:'detail',node_id:'chapter-a',target:fixed(detail)});
   let cursor:any,diffs:any[]=[];do{const r=await invoke('compare_revisions',{object_id:plan.object.object_id,from_revision:old.object.revision,to_revision:plan.object.revision,...(cursor?{cursor}:{})});diffs.push(...r.changes);cursor=r.next_cursor;}while(cursor);assert.ok(diffs.some(d=>d.path==='/details/chapter-a/goal'));assert.ok(diffs.some(d=>d.path==='/details/chapter-a/detailed_plot'&&d.after.truncated));
   const check=await invoke('check_plan',{object_id:plan.object.object_id});assert.ok(check.issues.some((i:any)=>i.code==='unresolved_clue'));
  });
  await t.test('NPT-43/44 真实工作步骤、回执核验、停止请求与确认分离',async()=>{
   const content={format_version:1,plan_ref:fixed(plan),target_node_ids:['chapter-a'],goal:'局部返工',state:'prepared',steps:[{id:'step',title:'详情保存',status:'pending',message:'',operation_key:null,result_ref:null,evidence:{kind:'agent_report',locator:''}}],continuation:'沿当前固定节点继续。'};
   run=await invoke('put_run',{title:'本次返工',content,source_refs:[],expected_revision:0,expected_sha256:'',operation_key:'run'});
   plan=await invoke('attach_object',{...base(plan),role:'run',target:fixed(run)});
   run=await invoke('patch_run',{...base(run),state:'handed_off'});run=await invoke('patch_run',{...base(run),state:'running'});
   const originalDetail=await invoke('get_detail',{object_id:detail.object.object_id,revision:1});
   const step={...content.steps[0],status:'succeeded',operation_key:'detail',result_ref:fixed(originalDetail),evidence:{kind:'core_receipt',locator:'detail'}};
   const forged=await invoke('patch_run',{...base(run),steps:[{...step,result_ref:fixed(detail)}]},false);assert.notEqual(forged.data?.result?.status,'succeeded');
   run=await invoke('patch_run',{...base(run),steps:[step]});
   run=await invoke('request_stop',{...base(run),reason:'作者需要先审阅。'});assert.equal(run.object.content.state,'stop_requested');
   const bad=await invoke('patch_run',{...base(run),state:'stopped'},false);assert.notEqual(bad.data?.result?.status,'succeeded');
   assert.equal((await invoke('get_progress',{object_id:plan.object.object_id})).runs[0].object.content.state,'stop_requested');
  });
  await t.test('NPT-20/22/42 全量固定导出、摘要、拒绝任意路径，CLI读取MCP成果',async()=>{
   let cursor:any,parts:any[]=[];do{const r=await invoke('export_plan',{object_id:plan.object.object_id,revision:plan.object.revision,format:'json',scope:'complete',...(cursor?{cursor}:{})});parts.push(r);cursor=r.next_cursor;}while(cursor);
   assert.equal(parts.length,parts[0].manifest.length);assert.ok(parts.some(p=>JSON.parse(p.content).object.kind==='novel_plan_detail'));
   const invalid=await invoke('export_plan',{object_id:plan.object.object_id,revision:plan.object.revision,format:'json',scope:'complete',file_path:'/tmp/forbidden'},false);assert.notEqual(invalid.status,'succeeded');
   const registry=await ok('hetu_plugins_inspect');
   const cli=spawnSync(path.join(bin,'hetu'),['--client','codex','--collaboration-dir',path.join(directory,'hub'),'call','hetu.plugins.invoke','--input','-'],{env,input:JSON.stringify({...binding,capabilities_sha256:cap.capabilities_sha256,action:'get_plan',arguments:{object_id:plan.object.object_id,revision:plan.object.revision}}),encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
   assert.equal(cli.status,0,cli.stderr);const read=JSON.parse(cli.stdout);assert.equal(read.data.result.data.sha256,plan.sha256);
   await writeFile(path.join(directory,'machine-context.json'),JSON.stringify({binding,capabilities_sha256:cap.capabilities_sha256,plan_ref:fixed(plan),work_ref:work,registry_sha256:registry.state_sha256},null,2));
  });
  await t.test('NPT-17/18/33/55 开放核心目录统计、停用热插拔及同一连接恢复',async()=>{
   const identity=await invoke('hetu.capabilities.get',{});assert.equal(identity.entry_mode,'agent');
   assert.ok(!cap.core_actions.some((a:any)=>a.name==='hetu.documents.finalize'));
   const snapshot=await invoke('hetu.novels.snapshot',{});assert.equal(snapshot.word_count,0);assert.equal(snapshot.document_count,0);
   await apply('disable');assert.notEqual((await invoke('get_plan',{object_id:plan.object.object_id},false)).status,'succeeded');
   await apply('enable');await discover();assert.equal((await invoke('get_plan',{object_id:plan.object.object_id})).sha256,plan.sha256);
   assert.equal(cap.access_mode,'open');assert.equal(binding.grant_id,undefined);
  });
  assert.deepEqual([...actions].filter(x=>!x.startsWith('hetu.')).sort(),manifest.contributions.actions.filter(a=>!["list_continuities", "get_continuity", "save_continuity", "put_decision", "put_event", "put_state", "get_timeline", "build_continuation_context"].includes(a.id)).map(a=>a.id).sort());
  await mkdir('output',{recursive:true});await writeFile('output/machine-acceptance.json',JSON.stringify({recorded_at:new Date().toISOString(),platform:process.platform,package_sha256:pkg.package_sha256,actions:[...actions],directory,plan_ref:fixed(plan),status:'passed',boundaries:['真实稳定MCP与Core；桌面未启动','未证明Windows运行或GUI完整验收']},null,2));
 }finally{await client.close();}
});
