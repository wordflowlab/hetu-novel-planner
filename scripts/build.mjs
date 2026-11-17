await import('./generate-continuity.mjs');
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
const {createHash} = await import("node:crypto");
const sources = JSON.parse(await readFile("vendor/sources.json","utf8"));
for (const file of sources.files) {
  const digest=createHash("sha256").update(await readFile("vendor/"+file.file)).digest("hex");
  if(digest!==file.sha256)throw new Error("SDK快照不符："+file.file);
}
const manifest = JSON.parse(await readFile('contracts/plugin-manifest.json','utf8'));
await mkdir('dist',{recursive:true});
const backend=await build({entryPoints:['src/backend.ts'],outfile:'dist/backend.mjs',bundle:true,platform:'node',format:'esm',target:'node25',metafile:true,banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
const view=await build({entryPoints:['src/view/index.tsx'],outfile:'dist/view.js',bundle:true,platform:'browser',format:'iife',target:'chrome140',metafile:true,jsx:'automatic'});
await writeFile('dist/plugin.json',JSON.stringify(manifest)+'\n');
await writeFile('dist/index.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小说规划</title><link rel="stylesheet" href="view.css"><div id="root"></div><script src="view.js"></script></html>');
for (const name of ['LICENSE','CAPABILITIES.md']) await copyFile(name,'dist/'+name);
await mkdir('dist/methods',{recursive:true});
for(const name of await readdir('methods')) {
  const text=await readFile('methods/'+name,'utf8');
  await writeFile('dist/methods/'+name,name==='README.md'?text.replaceAll('../README.md','../CAPABILITIES.md'):text);
}
await mkdir('dist/licenses',{recursive:true});
await copyFile('vendor/hetu-LICENSE','dist/licenses/hetu.txt');
await copyFile('vendor/sources.json','dist/licenses/hetu-sources.json');
const packages=new Map();
for(const input of Object.keys({...backend.metafile.inputs,...view.metafile.inputs})){
  if(!input.startsWith('node_modules/'))continue;
  let directory=path.dirname(input);
  while(directory!=='.'){
    try {const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));if(pkg.name){packages.set(pkg.name,{directory,pkg});break;}}catch{}
    directory=path.dirname(directory);
  }
}
let notices='# 第三方许可\n\n仅列入实际后端及视图产物包含的依赖；宿主来源另见 licenses/hetu-sources.json。\n\n';
for(const [name,{directory,pkg}] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
  const files=(await readdir(directory)).filter(f=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(f));
  if(!files.length)throw new Error('缺少第三方许可：'+name);
  const filename=name.replaceAll('/','_').replaceAll('@','')+'.txt';
  const content=await Promise.all(files.sort().map(f=>readFile(path.join(directory,f),'utf8')));
  await writeFile('dist/licenses/'+filename,content.join('\n\n'));
  notices+=`- ${name}@${pkg.version} (${pkg.license}): licenses/${filename}\n`;
}
await writeFile('dist/THIRD_PARTY_NOTICES.md',notices);
for (const data of manifest.contributions.data) {
  const prefix=data.kind.replaceAll('_','-');
  await writeFile('docs/examples/'+prefix+'.schema.json',JSON.stringify(data.schema,null,2)+'\n');
}
await writeFile('docs/examples/plugin-manifest.design.json',JSON.stringify(manifest,null,1)+'\n');

await cp('skills','dist/skills',{recursive:true});
