---
name: remind-run-tests
enabled: true
event: stop
pattern: .*
---

✅ **完成前检查清单**

在结束任务前，请确保完成以下检查：

**代码质量检查：**

- [ ] 类型检查通过：`npm run typecheck`
- [ ] 代码格式化：`npm run lint`
- [ ] 验证通过：`npm run validate:all`

**测试检查：**

- [ ] 运行智能测试：`npm run test:smart:staged`
- [ ] 或运行完整测试：`npm run test:all`
- [ ] 测试覆盖率：`npm run test:coverage` (目标 >80%)

**数据库相关（如果修改了 schema）：**

- [ ] 生成迁移文件：`npm run db:generate`
- [ ] 执行迁移：`npm run db:migrate`

**提交前检查：**

- [ ] 检查暂存区：`git status`
- [ ] 查看变更：`git diff --staged`
- [ ] 提交信息符合规范（使用 Conventional Commits）

**快速命令：**

```bash
# 一键验证
npm run validate:all

# 智能测试（仅运行相关测试）
npm run test:smart:staged

# 完整验证流程
npm run typecheck && npm run lint && npm run test:smart:staged
```

**注意：**

- E2E 测试不会在 pre-commit 中运行
- 如需运行 E2E 测试：`npm run test:e2e`
- 监听模式运行测试：`npm run test`
