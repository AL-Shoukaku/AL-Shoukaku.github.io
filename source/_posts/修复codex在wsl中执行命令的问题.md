---
title: Codex 桌面端在 WSL 中命令执行失败：一次辅助目录失效问题的排查与修复
date: 2026-10-06 15:00:00
tags:
  - Codex
  - WSL
categories:
  - bug修复
description: 这篇文章记录了我排查和修复 Codex 在 WSL 中命令执行失败问题的过程。
---
# Codex 桌面端在 WSL 中命令执行失败：一次辅助目录失效问题的排查与修复

## 问题背景与现象

由于大模型普遍更偏爱 linux 的终端环境，我决定将它的运行环境迁移到 WSL 中。这需要在 ChatGPT 桌面应用中将**智能体环境**设置为 WSL。

![智能体环境设置](/img/智能体环境设置.png)

设置完后，我让 Codex 执行 `pwd` 验证一下，结果报错：

```text
$ pwd
Failed to create unified exec process: No such file or directory (os error 2)
退出码 -1
```

下面记录 Codex 自己排查和修复这个问题的过程，可以直接跳转至 [解决方法](#解决方法)，或者把文章发给 AI 让它帮你解决这个问题。

## 问题原因分析

我先让 Codex 自己去解决这个问题，它发现了一个关键点：**在沙箱外可以正常执行指令**。进一步的对照结果如下：

| 执行方式 | 结果 | 能说明什么 |
| --- | --- | --- |
| 当前桌面会话的默认沙箱 | 创建进程失败 | 默认执行路径有问题 |
| 沙箱外执行同样的命令 | 成功 | Bash 和工作目录可以正常使用 |
| 使用应用自带 Codex 程序新建沙箱 | 成功 | 新建沙箱可以执行命令 |

沙箱外和新建沙箱都能成功执行命令，排查重点因此转向了**沙箱的启动过程**。

接下来，Codex 查看运行中进程的信息：通过 `/proc/<PID>/exe` 确认应用自带二进制的位置，再通过 `/proc/<PID>/fd` 检查已经打开的文件。结果发现，进程仍持有一个临时辅助目录中 `.lock` 文件的句柄，路径类似：

```text
/mnt/c/Users/username/.codex/tmp/arg0/codex-arg0XXXXXX/.lock
```

但实际访问时，`codex-arg0XXXXXX` 目录已经不存在，里面的 `codex-linux-sandbox`、`codex-bwrap` 等辅助入口也全部缺失。**父目录**下却能看到另一个临时目录，其中存放的是 Windows 使用的 `apply_patch.bat`、`applypatch.bat`。

这里要区分**文件路径和文件句柄**：路径用于寻找文件，句柄则是进程打开文件后保存的访问关系。旧句柄仍被持有，不代表文件还能通过原路径找到。因此，Codex 主进程可以继续运行，却无法通过缺失的入口启动下一条沙箱命令。

由此可以大致判断，**辅助目录失效是本次故障的直接原因**。由于 Windows 与 WSL 共用这处临时目录，Codex 怀疑 Windows 侧的清理或跨环境锁管理冲突让目录失效，因此选择**将 WSL 的辅助文件迁移到 Linux 本地目录**，隔离两边的临时文件。

因此，修复的大致思路是：

1. **分离临时目录。** 将 WSL 的辅助文件放到 Linux 本地目录，通过**绑定挂载**保留 Codex 原有的访问路径，分开 Windows 与 WSL 的辅助文件。
2. **持久化挂载。** 用 systemd 保存并启用挂载配置，让后续启动的 Codex 进程自动在 Linux 本地目录中创建和管理辅助入口。
3. **验证命令执行。** 检查默认沙箱中的命令执行和工作目录读写是否恢复。

对于辅助目录已丢失的当前后台进程，如果希望不重启 Codex 就继续使用命令行工具，还需要**补齐目录和辅助入口，并保持新 `.lock` 的文件锁**，这部分可以交给 Codex 处理。新对话也可能复用已有后台进程。

## 解决方法

适用于 **WSL2 使用 systemd，且确认存在上述辅助目录失效问题**的环境。下面的 `username` 均为占位符：`/home/` 后填写 WSL 用户名，`/mnt/c/Users/` 后填写 Windows 用户名，两者可能不同。自定义 Codex home 需要相应调整目标路径。

### 1. 确认 WSL 使用 systemd

以下操作可以在同一个 WSL 终端中完成，也可以交给 Codex 通过**沙箱外执行**完成。先检查 WSL 的 PID 1：

```bash
ps -p 1 -o comm=
```

输出应为 `systemd`。

### 2. 创建目录

准备 Linux 本地缓存和原路径对应的挂载目标：

```bash
mkdir -p /home/username/.cache/codex-wsl/arg0
mkdir -p /mnt/c/Users/username/.codex/tmp/arg0
```

### 3. 保存挂载配置

根据目标路径生成正确的[单元名](https://man7.org/linux/man-pages/man5/systemd.mount.5.html)。交给 Codex 时，让它直接创建对应的配置文件；手动操作时可以用 nano 打开：

```bash
codex_mount_unit=$(systemd-escape --path --suffix=mount \
  /mnt/c/Users/username/.codex/tmp/arg0)
sudo nano "/etc/systemd/system/$codex_mount_unit"
```

粘贴以下内容，同样替换其中的 `username`。`What` 是源目录，`Where` 是目标路径，`Options=bind` 指定绑定挂载。

```ini
[Unit]
Description=Keep Codex WSL temporary helpers on the Linux filesystem
RequiresMountsFor=/home/username/.cache/codex-wsl/arg0 /mnt/c/Users/username/.codex/tmp

[Mount]
What=/home/username/.cache/codex-wsl/arg0
Where=/mnt/c/Users/username/.codex/tmp/arg0
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
```

在 nano 中按 `Ctrl+O`、回车保存，再按 `Ctrl+X` 退出。

### 4. 校验并启用挂载

先检查配置是否有错误。Codex 分步执行时，**每个命令块都重新计算单元名**，避免前一次调用的变量丢失：

```bash
codex_mount_unit=$(systemd-escape --path --suffix=mount \
  /mnt/c/Users/username/.codex/tmp/arg0)
sudo systemd-analyze verify "/etc/systemd/system/$codex_mount_unit"
```

**校验通过后**，让 systemd 重新读取配置并立即启用挂载：

```bash
codex_mount_unit=$(systemd-escape --path --suffix=mount \
  /mnt/c/Users/username/.codex/tmp/arg0)
sudo systemctl daemon-reload
sudo systemctl enable --now "$codex_mount_unit"
systemctl is-active "$codex_mount_unit"
```

最后输出 **`active`**，表示当前挂载已生效。

### 5. 验证命令执行

可以**新开一个会话**，让 Codex **在默认沙箱中执行**以下命令，再测试工作目录内的文件读写：

```bash
pwd
```

都能成功，说明该会话已恢复正常。新会话可能复用已有后台进程；如果仍报同样的错误，或者希望直接修复当前会话，可以让 Codex 通过**沙箱外执行**完成以下补救：

1. **定位实际路径。** 找到当前会话所属的 Codex 后台进程，从 `/proc/<PID>/exe` 读取实际二进制路径，从 `/proc/<PID>/fd` 中打开的 `.lock` 句柄定位原辅助目录，例如 `/mnt/c/Users/username/.codex/tmp/arg0/codex-arg0XXXXXX`。
2. **补齐目录和入口。** 在已经挂载的 `arg0` 下重建这个同名随机目录，将 `codex-linux-sandbox`、`apply_patch` 等辅助入口恢复为指向实际 Codex 二进制的符号链接。随机目录名和入口列表以当前进程、当前版本为准。
3. **维护新目录的文件锁。** 在恢复的目录中创建 `.lock`，启动临时 Python 进程，通过 `fcntl.flock` 持有排他锁并保持文件打开。定期核对原 Codex 的 PID 和启动时间，原进程结束后退出并释放锁；仅创建空的 `.lock` 文件不等于持有锁。

完成后，在当前会话的默认沙箱中重新执行 `pwd`，确认命令执行恢复。
