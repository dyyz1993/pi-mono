# Rollback RPC 验证报告

## 日期: 2026-04-28

## 改动文件
- `packages/coding-agent/examples/extensions/file-snapshot.ts` — session_start 时写入 baselineTreeHash; session_tree 回退无 snapshot 时使用 baselineTreeHash

## Tree 结构范本 (两轮对话)
```
[0] xxx type=model_change          parentId=null
[1] xxx type=thinking_level_change parentId=[0]
[2] xxx type=custom_message        parentId=[1]
[3] xxx type=message label=user    parentId=[2]       ← R1 user
[4] xxx type=message label=assistant parentId=[3]
[5] xxx type=message label=toolResult parentId=[4]
[6] xxx type=custom label=step-snapshot parentId=[5]
[7] xxx type=message label=assistant parentId=[6]      ← R1 最终 assistant
[8] xxx type=session_info          parentId=[7]
[9] xxx type=custom_message        parentId=[8]       ← R2 前的 custom_message
[10] xxx type=message label=user   parentId=[9]       ← R2 user
[11] xxx type=message label=assistant parentId=[10]
[12] xxx type=message label=toolResult parentId=[11]
[13] xxx type=custom label=step-snapshot parentId=[12]
[14] xxx type=message label=assistant parentId=[13]   ← R2 最终 assistant (leaf)
```

## RPC 验证结果

### 回滚消息 (R2 → R1)
```
Target: second user 的 parentId (custom_message entry)
navigateTree(targetId, { summarize: false })
→ 文件从 "round2" 恢复到 "round1" ✅
→ session_tree 事件触发 ✅
```

### 回滚全部 (→ 空)
```
Target: first user 的 parentId (custom_message entry)
Problem: 第一次 rollback 后 leaf 已在 custom_message, 第二次 no-op
→ 需要传更早的 entry (如 model_change 或 thinking_level_change)
```

### 事件范本
```
extension_ui_request, message_start, message_end, agent_start,
turn_start, message_update, tool_execution_start, tool_execution_end,
custom_entry, turn_end, session_rename, agent_end
```

### file-snapshot 事件流
```
session_start → 记录 baselineTreeHash (初始文件状态)
turn_start → 扫描 working dir, writeTree (baseline)
turn_end → 扫描 working dir, writeTree, 对比 diff, 如有变更创建 step-snapshot
session_tree → 找 target 路径上的 snapshot, 恢复文件到 snapshot 状态
```

## 前端注意事项
1. `resolveEntryId` 需要正确匹配 tree entry 位置（tree 含非 message entries）
2. 回滚消息 targetId = second user 的 parentId (即 R1 最后一个 entry)
3. 回滚全部 targetId = first user 的 parentId (即 R1 前的 entry), 但需要确保不是当前 leaf
4. navigateTree 会 no-op 如果 targetId === currentLeafId
