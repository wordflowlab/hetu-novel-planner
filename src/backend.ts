import type {BackendContext} from '../vendor/hetu-sdk.ts';
import {Planner} from './application/planner.ts';
let planner:Planner|undefined;
export function apply(context:BackendContext){planner=new Planner(context);context.effect(()=>{planner=undefined;});}
export async function invoke(action:string,input:unknown){if(!planner)throw new Error('插件未激活。');return planner.invoke(action,input);}
