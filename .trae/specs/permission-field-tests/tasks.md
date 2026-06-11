# Tasks

- [ ] Task 1: 重写 `test/permissions.test.ts` 为按字段分组结构
  - [ ] 保留所有现有测试用例（不做逻辑改动）
  - [ ] 按 12 个字段分组，每组一个 `describe`
  - [ ] 每组内包含：正常值、undefined、空数组/空串、边界值测试
- [ ] Task 2: 为缺失字段补充测试
  - [ ] `paths.bash` 字段测试（当前缺失）
  - [ ] `normalizeFilePath` 测试（当前缺失，仅内部函数但可 export 测试）
  - [ ] `permissionMode` 字段边界测试（yolo 模式、非法值）
- [ ] Task 3: 验证重构后测试总数不减少
  - [ ] 运行 `npm run check` 确认无 TS 错误
  - [ ] 运行 `./test.sh` 确认 648+ tests 全通过

# Task Dependencies

- 无（Task 1 是纯重构，Task 2 是补充，可并行）
