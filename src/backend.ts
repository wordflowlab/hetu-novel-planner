import type {BackendContext} from '../vendor/hetu-sdk.ts';
import {Planner} from './application/planner.ts';
import {Continuity} from './continuity/application.ts';
import {ids} from './continuity/model.ts';
let planner:Planner|undefined,continuity:Continuity|undefined;
export function apply(context:BackendContext){planner=new Planner(context);continuity=new Continuity(context);context.effect(()=>{planner=undefined;continuity=undefined;});}
export async function invoke(action:string,input:unknown){if(!planner||!continuity)throw new Error('插件未激活。');return ids.has(action)?continuity.invoke(action,input):planner.invoke(action,input);}
