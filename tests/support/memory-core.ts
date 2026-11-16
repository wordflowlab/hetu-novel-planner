import {createHash,randomUUID} from 'node:crypto';
import {Planner} from '../../src/application/planner.ts';
import {canonical,clone} from '../../src/domain/model.ts';
const hash=(x:any)=>createHash('sha256').update(canonical(x)).digest('hex');
const ok=(data:any)=>({spec_version:'0.2.1',status:'succeeded',data});
const fail=(code:string)=>({spec_version:'0.2.1',status:'failed',error:{code,message:code}});
export function memoryCore(){
 const records=new Map<string,any[]>(),operations=new Map<string,any>();let writes=0;
 const request=async(action:string,input:any):Promise<any>=>{
  if(action.endsWith('operations.get'))return operations.get(input.operation_key)?.result??fail('not_found');
  if(action.endsWith('objects.get')){
   const history=records.get(input.object_id);if(!history)return fail('not_found');const r=input.revision?history[input.revision-1]:history.at(-1);return r?ok(clone(r)):fail('not_found');
  }
  if(action.endsWith('objects.save')){
   const fingerprint=hash(input),existing=operations.get(input.operation_key);if(existing)return existing.fingerprint===fingerprint?existing.result:fail('idempotency_conflict');
   const list=input.object_id?records.get(input.object_id):undefined;
   if(input.object_id&&(!list||list.at(-1).object.revision!==input.expected_revision||list.at(-1).sha256!==input.expected_sha256))return fail('revision_conflict');
   const id=input.object_id??'ext_'+randomUUID(),object={...input,object_id:id,owner_plugin_id:'org.wordflowlab.novel-planner',revision:(list?.length??0)+1};
   const r={object,sha256:hash(object)},result=ok(clone(r));records.set(id,[...(list??[]),r]);operations.set(input.operation_key,{fingerprint,result});writes++;return result;
  }
  if(action.endsWith('objects.search'))return ok({objects:[...records.values()].map(x=>x.at(-1)).filter(r=>r.object.kind===input.kind).map(r=>({...r.object,sha256:r.sha256})),next_cursor:null});
  return fail('forbidden');
 };
 const planner=new Planner({work_ref:{workspace_id:'workspace_design',kind:'novel',object_id:'novel_design'},request:request as any,effect:()=>{}});
 return {planner,records,operations,request,get writes(){return writes;}};
}
