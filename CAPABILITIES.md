# 小说规划功能清单

本文件供作者Review与Agent导航。执行前经河图能力发现读取实际包、授权、动作 Schema 及能力摘要。可执行合同以 `contracts/plugin-manifest.json` 为源，验收状态统一见实施记录。

| 功能ID | 能力 | 动作或入口 | 效果 |
| --- | --- | --- | --- |
| NP-01 | 查找当前小说的规划方案 | `list_plans` | read，分页摘要 |
| NP-02 | 读取整书结构与节点详情 | `get_plan`、`get_node` | read，可指定固定修订 |
| NP-03 | 建立及整体更新方案 | `put_plan` | managed_write，固定完整内容与CAS |
| NP-04 | 局部修改目标、冲突与状态变化 | `put_detail`＋`attach_object`；元数据用`patch_node` | managed_write，固定详情与接入范围 |
| NP-05 | 新增卷与章 | `insert_node` | managed_write，稳定节点ID |
| NP-06 | 调整层级内顺序或移动章节 | `move_node` | managed_write，完整聚合原子保存 |
| NP-07 | 归档与恢复规划分支 | `archive_node` | managed_write，保留节点与历史 |
| NP-08 | 检查结构与预算 | `check_plan` | read，规则诊断不评判创意质量 |
| NP-09 | 比较固定修订 | `compare_revisions` | read，节点与字段差异 |
| NP-10 | 导出专业Markdown与JSON | `export_plan` | read，返回内容，不写任意路径 |
| NP-11 | 沿原操作查询与恢复 | 河图`hetu.extensions.operations.get`及原输入 | 查询先行，冲突不覆盖 |
| NP-12 | 按卷／篇章列表、整书树阅读，编辑、历史与意见交接 | 规划视图`main` | 共享上述动作，保存未完成时保留恢复稿 |
| NP-13 | 完整卷章资料：副标题、状态、概要、开局、首尾变化及目标章节数 | `get_detail`、`put_detail`及节点动作 | 规划状态不等于批准，详情独立固定 |
| NP-14 | 按标题、副标题、目标、主题及层级／状态查找；列表即时筛选 | `query_nodes` | read，固定组合快照、分页定位 |
| NP-15 | 角色、势力、地点、物品、规则的规划卡与正式来源 | `get_story_network`、`put_story_network` | 候选与正式设定分开，正式修改归宿主 |
| NP-16 | 卷内／章内实体与出场作用 | `get_node`、`get_story_network`及`put_detail` | 直接关联与包含后代可区分 |
| NP-17 | 伏笔埋设、提示、回收与未解决线索 | `get_story_network`、`put_story_network` | 稳定线索ID、节点定位与检查 |
| NP-18 | 关系图谱及等价关系表 | 关系投影与规划视图 | Agent维护关系，作者可阅读，画布非必经 |
| NP-19 | 长篇详细剧情、节拍与局部返工 | `get_detail`、`put_detail` | 每节点独立详情，不把剧情压成短备注 |
| NP-20 | 固定整书组合快照、比较和分段完整导出 | `get_plan`、`compare_revisions`、`export_plan` | 不拼接不同时间的最新头，分段有完整清单 |
| NP-21 | 工作步骤、真实成果、未知结果及继续上次工作 | `get_progress`、`put_run`、`patch_run` | Agent报告与Core回执分别标记，不伪造百分比 |
| NP-22 | 全书分卷、展开当前卷、返工与停止请求 | 宿主可信交接及`request_stop` | 停止请求不等于外部任务已取消 |
| NP-23 | 正式卷章／大纲接续、正文入口及实际统计 | 宿主类型化桥接与独立领域方案 | 首版必需集成；不复制正文或绕过作者决定 |
| NP-24 | 独立页面、中英文、浅暗、窄窗、键盘与完整异常状态 | 工作面与宿主外观／导航桥接 | 宿主左上角返回，跟随可信偏好与通知；退出先保存恢复稿 |
| NP-25 | 目标预算、规划量与正文实际量分别汇总 | 节点预算、统计读取与检查 | 未授权实际量显示不可用，不显示假0 |
| NP-26 | 独立详情／关系更新后的固定接入与中断恢复 | `attach_object`及逐步原键 | 单对象事务，跨对象分步可接续，不冒充全书原子事务 |

协作方法、来源与权限见[API合同](docs/04-API与Agent协作合同.md)，用例见[05](docs/05-用户故事与业务流程.md)，实际进度见[08](docs/08-实施计划与验收记录.md)。正式大纲应用使用宿主独立管理方案；本插件不提供正文采纳或定稿动作。

安装与动态发现由河图负责，不为本插件新建Codex插件或独立MCP服务。插件附带方法文件不表示已向Codex自动安装Skill；按需读取[包内方法](methods/README.md)，分发边界见[架构](docs/02-总体架构与技术选型.md)。

首版必须覆盖NP-01～26及[首版功能规格](docs/11-首版功能规格与发布门槛.md)。工作包分步实施不缩减首版发布范围；缺少宿主桥接时作为阻断登记。

## 剧情决策与时间线

- `list_continuities`：查找连续性方案（read）。
- `get_continuity`：读取固定连续性方案（read）。
- `save_continuity`：保存连续性方案（managed_write）。
- `put_decision`：维护剧情方向（managed_write）。
- `put_event`：维护故事事件（managed_write）。
- `put_state`：维护人物状态（managed_write）。
- `get_timeline`：读取双时间线（read）。
- `build_continuation_context`：准备固定续写上下文（read）。

方法见同包Skill的 references/continuity-v2.md。
