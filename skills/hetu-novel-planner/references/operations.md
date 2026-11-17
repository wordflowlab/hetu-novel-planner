# 操作地图

以包内正式清单为源；执行前发现当前安装版Schema。

| 动作 | 用途 | 必填参数 | 效果 |
| --- | --- | --- | --- |
| list_plans | 查找规划方案 |  | read |
| get_plan | 读取固定规划 | object_id | read |
| get_node | 读取规划节点 | object_id, node_id | read |
| query_nodes | 搜索卷章资料 | object_id, query | read |
| put_plan | 保存方案结构 | operation_key, expected_revision, expected_sha256, title, content, source_refs | managed_write |
| patch_node | 修改节点资料 | operation_key, object_id, expected_revision, expected_sha256, node_id, changes | managed_write |
| insert_node | 新增卷章节点 | operation_key, object_id, expected_revision, expected_sha256, parent_id, node | managed_write |
| move_node | 移动规划节点 | operation_key, object_id, expected_revision, expected_sha256, node_id, parent_id | managed_write |
| archive_node | 归档或恢复节点 | operation_key, object_id, expected_revision, expected_sha256, node_id, archived | managed_write |
| get_detail | 读取固定节点详情 | object_id, revision | read |
| put_detail | 保存节点详情 | operation_key, expected_revision, expected_sha256, title, content, source_refs | managed_write |
| attach_object | 接入固定规划成果 | operation_key, object_id, expected_revision, expected_sha256, role, target | managed_write |
| get_story_network | 读取实体关系与伏笔 | object_id, revision | read |
| put_story_network | 保存故事网络 | operation_key, expected_revision, expected_sha256, title, content, source_refs | managed_write |
| check_plan | 检查规划结构与关联 | object_id | read |
| compare_revisions | 比较固定规划修订 | object_id, from_revision, to_revision | read |
| export_plan | 分段导出固定规划 | object_id, revision, format, scope | read |
| get_progress | 读取工作记录 | object_id | read |
| put_run | 保存工作记录 | operation_key, expected_revision, expected_sha256, title, content, source_refs | managed_write |
| patch_run | 更新工作步骤 | operation_key, object_id, expected_revision, expected_sha256 | managed_write |
| request_stop | 记录停止请求 | operation_key, object_id, expected_revision, expected_sha256, reason | managed_write |
| list_continuities | 查找连续性方案 |  | read |
| get_continuity | 读取固定连续性方案 | object_id | read |
| save_continuity | 保存连续性方案 | content, expected_revision, expected_sha256, operation_key | managed_write |
| put_decision | 维护剧情方向 | object_id, expected_revision, expected_sha256, operation_key, decision | managed_write |
| put_event | 维护故事事件 | object_id, expected_revision, expected_sha256, operation_key, event | managed_write |
| put_state | 维护人物状态 | object_id, expected_revision, expected_sha256, operation_key, state | managed_write |
| get_timeline | 读取双时间线 | object_id, order | read |
| build_continuation_context | 准备固定续写上下文 | object_id, goal, max_chars | read |
