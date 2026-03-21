---
name: block-dangerous-commands
enabled: true
event: bash
action: block
pattern: rm\s+-rf\s+/|rm\s+-rf\s+~|rm\s+-rf\s+\*|mkfs|dd\s+if=|:\(\)\{\s*:\|:\s*&\s*\};\s*:
---

🚫 **禁止执行危险命令**

检测到可能导致系统损坏或数据丢失的危险命令！

**被阻止的命令类型：**

- `rm -rf /` - 删除根目录
- `rm -rf ~` - 删除用户主目录
- `rm -rf *` - 删除当前目录所有文件
- `mkfs` - 格式化磁盘
- `dd if=` - 磁盘镜像操作
- Fork 炸弹 - `:(){ :|:& };:`

**安全替代方案：**

```bash
# ❌ 危险
rm -rf /path/to/directory

# ✅ 安全 - 先确认路径
ls -la /path/to/directory
rm -rf /path/to/directory

# ✅ 更安全 - 使用 find 和 -exec
find /path/to/directory -type f -name "*.log" -exec rm {} \;
```

**如果确实需要执行危险操作：**

1. 先备份重要数据
2. 确认路径正确性
3. 在隔离环境中测试
4. 使用版本控制系统
