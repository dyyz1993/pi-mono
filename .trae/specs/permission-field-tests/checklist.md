# Checklist

## 字段分组验证
- [x] `permissionMode field` describe 组存在，覆盖 normal、yolo、undefined
- [x] `tools field` describe 组存在，覆盖 undefined、空数组、具体列表、glob 模式、通配符
- [x] `disallowedTools field` describe 组存在，覆盖 undefined、空数组、具体名称、glob 模式
- [x] `paths.write field` describe 组存在，覆盖 undefined、空数组、具体 glob、`**`
- [x] `paths.read field` describe 组存在，覆盖 undefined、空数组、具体 glob
- [x] `paths.bash field` describe 组存在，覆盖 undefined、空数组、具体 glob
- [x] `dangerous bash patterns` describe 组存在，覆盖所有 7 个内置正则
- [x] `tools vs disallowedTools conflict` describe 组存在，覆盖 blocklist 胜出
- [x] `matchToolName patterns` describe 组存在，覆盖所有 pattern 语法
- [x] `inputToRecord parsing` describe 组存在，覆盖非对象、null、数组等
- [x] `checkPathPermission` describe 组存在，覆盖 write/read/bash 路径检查
- [x] `normalizeFilePath` describe 组存在，覆盖 CWD 前缀、尾斜杠、相对路径

## 完整性验证
- [x] 测试总数 ≥ 66（总计 85，新增 19）
- [x] `npm run check` 通过
- [x] `./test.sh` 全部通过
- [x] 无 production 代码改动（只改 test 文件）
