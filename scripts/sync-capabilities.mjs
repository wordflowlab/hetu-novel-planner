import {readFile,writeFile} from "node:fs/promises";
const manifest=JSON.parse(await readFile("contracts/plugin-manifest.json","utf8"));
const rows=["| 动作 | 用途 | 必填参数 | 效果 |","| --- | --- | --- | --- |",...manifest.contributions.actions.map(a=>`| ${a.id} | ${a.title} | ${a.input_schema.required.join(", ")} | ${a.effect} |`)];
await writeFile("skills/hetu-novel-planner/references/operations.md","# 操作地图\n\n由包清单生成；执行前发现当前安装版Schema。\n\n"+rows.join("\n")+"\n");
const marker="\n## 实际动作地图\n",source=await readFile("CAPABILITIES.md","utf8");
await writeFile("CAPABILITIES.md",source.split(marker)[0]+marker+"\n由包清单生成；专业深化见[时间语义合同](docs/14-剧情决策与时间线设计.md)。\n\n"+rows.join("\n")+"\n");
