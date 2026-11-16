> 本文属于[小说规划文档](README.md)，拥有专业动作及公开宿主SDK接入合同。

# API与Agent协作合同

## 1. 调用链与核心服务

Codex→河图稳定CLI/MCP→活动插件后端→Core。GUI调用同一专业动作。安装启用后无需独立插件授权，复用原作品management_ref发现`hetu.plugins.capabilities`，通过`hetu.plugins.invoke`调用；不要求另装Codex插件或新建MCP连接。

能力发现固定WorkRef、plugin_id及package_sha256，返回专业动作、data_actions、core_actions和capabilities_sha256。实际调用携带相同引用、能力摘要、action和arguments。包更新或停用后重新发现，旧能力不可据此继续运行。

专业动作及输入Schema以`contracts/plugin-manifest.json`为唯一来源。当前21项专业动作由CAPABILITIES导航，本文不复制参数表。公共SDK的`request(action,input)`可使用当前执行身份的全部核心动作；`createHostClient`封装核心发现及`novels.snapshot`，不依赖Electron或Cordis内部类型。

## 2. 核心与专业对象的组合

| 需求 | 调用 |
| --- | --- |
| 资料、正式卷章、正文及大纲 | Core的novels、documents、outlines动作；以实际Schema为准 |
| 实际字数及固定正文 | `hetu.novels.snapshot`，不使用规划目标替代实际值 |
| 正典与素材来源 | `hetu.blueprints.*`、`hetu.assets.*`及固定sources.inspect |
| 专业规划数据 | extensions.objects；四类专业content由本包Schema和语义校验共同约束 |
| 原操作恢复 | 按回执recover_action及原键查询；不换键重复写 |
| 工作面导航 | `host('open_work',{target})`或固定`open_document`；导航不替代领域API |
| 交接、导出、偏好及恢复稿 | 宿主公共界面服务；机器业务不依赖窗口 |

## 3. 写入与恢复

Core校验WorkRef、所有者、类型、Schema、来源、修订及原键；专业动作声明effect，read不能写，managed_write保留本次operation_key。Core分别绑定原始专业输入与最终保存输入，不能用相同结果掩盖不同原请求。

跨专业对象的详情保存和接入是连续两步，各自保留原操作，第二步失败不重写第一步。冲突保留本地输入，比较后重新准备；未知先回读，明确not_found才执行相同输入。作者决定、正文采纳、定稿和外部费用沿宿主原业务用例，不由规划对象保存冒充。

## 4. Skills、发现及退出

Skills负责规划方法、范围检查与可恢复编排；真实Schema从当前河图入口发现。停用及卸载保留作品成果；缺少兼容包仍可通过宿主通用读取导出。专业功能只在本包CAPABILITIES维护，宿主地图只导航发现入口。

分层、兼容与核心领域语义分别见[02](02-总体架构与技术选型.md)、宿主插件27及主28；执行证据归[08](08-实施计划与验收记录.md)。
