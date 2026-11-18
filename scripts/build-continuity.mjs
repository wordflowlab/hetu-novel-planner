import {build} from 'esbuild';import {writeFile,copyFile} from 'node:fs/promises';
await build({entryPoints:['src/continuity/view.tsx'],outfile:'dist/continuity.js',bundle:true,preserveSymlinks:true,minify:true,define:{'process.env.NODE_ENV':'\"production\"'},platform:'browser',format:'iife',target:'chrome140',jsx:'automatic'});
await writeFile('dist/continuity.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剧情决策与时间线</title><link rel="stylesheet" href="continuity.css"><div id="root"></div><script src="continuity.js"></script></html>');
await copyFile('vendor/radix-colors-MIT.txt','dist/licenses/radix-colors-MIT.txt');
