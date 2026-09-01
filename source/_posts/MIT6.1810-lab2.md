---
title: 2025 MIT 6.1810 Lab 2:Syscall
date: 2026-09-01 20:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab2 全记录，主题是系统调用
---
# 2025 MIT 6.1810 Lab 2: Syscall

---

## 实验概览

本次实验的主题是**系统调用**。实验会先介绍如何使用 GDB 调试 xv6 内核，再梳理 xv6 中系统调用的实现流程，并动手实现一个新的系统调用。最后，我们会利用 xv6 中一个刻意保留的漏洞编写攻击程序，从而体会内核漏洞可能带来的危害。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Using GDB (easy)

这一部分主要是熟悉使用 **GDB** 调试 xv6 内核的方法，并根据官方文档回答相关问题。

#### Question 1

> Looking at the backtrace output, which function called syscall?

首先在窗口 A 中运行 `make qemu-gdb`，以调试模式启动 xv6；随后在**另一个**窗口 B 中运行 `gdb-multiarch`，连接到 xv6 的调试端口。

在窗口 B 中执行以下命令，在 `syscall` 函数处**打断点并继续运行**：

```bash
b syscall # b 是 break 的缩写
c # c 是 continue 的缩写
```

接下来使用 `layout src` 显示源码，并用 `backtrace` 查看调用栈，输出如下：
```bash
#0 syscall () at kernel/syscall.c:133
#1 0x0000000080001aa6 in usertrap () at kernel/trap.c:68
#2 0x00000003fffffff09c in ?? ()
```
GDB backtrace 中调用栈的先后顺序是**自下而上**的，因此 `#0` 是当前的函数，为 `kernel/syscall.c` 中的 `syscall()` 函数。

`#1` 是 `#0` 的调用者，也就是 `kernel/trap.c` 中的 `usertrap()` 函数，由此可以回答文档的**第一个问题**。

`#2` 对应进入内核前的用户态上下文。由于这里调试的是**内核代码**，GDB 无法显示对应的用户态函数名和源码，只能显示地址。

#### Question 2

> What is the value of p->trapframe->a7 and what does that value represent? (Hint: look at user/init.c, the first user program xv6 starts, and its compiled assembly user/init.asm.)

根据官方提示，执行几次 `next`，越过 `struct proc *p = myproc()` 这一行后，再执行 `print p->trapframe->a7` 查看其值，输出如下：

```bash
$1 = 15
```

由于当前正处在 `kernel/syscall.c` 中的 `syscall()` 函数中，其部分源码如下：
```c
void
syscall(void)
{
  int num;
  struct proc *p = myproc();

  num = p->trapframe->a7;
  if(num > 0 && num < NELEM(syscalls) && syscalls[num]) {
    // Use num to lookup the system call function for num, call it,
    // and store its return value in p->trapframe->a0
    p->trapframe->a0 = syscalls[num]();
  } else {
    printf("%d %s: unknown sys call %d\n",
            p->pid, p->name, num);
    p->trapframe->a0 = -1;
  }
}
```

可以看到，`trapframe->a7` 的值被赋给了 `num`，而 `num` 的作用就是**系统调用号**，用来查找对应的系统调用处理函数，并将返回值存入 `trapframe->a0` 中。

从 `kernel/syscall.h` 中可以看到，系统调用号 15 对应 `SYS_open`，因此 `p->trapframe->a7` 的值代表**当前要进行的系统调用**是 `open()`。

根据官方提示，从 `user/init.c` 中可以看到：
```c
  int pid, wpid;

  if(open("console", O_RDWR) < 0){
    mknod("console", CONSOLE, 0);
    open("console", O_RDWR);
  }
```
这是 xv6 启动后执行的第一个用户程序。由于断点设置在 `syscall()` 中，此时捕获到的系统调用对应的就是 `init` 发起的第一次系统调用，也就是 `open("console", O_RDWR)`，这也从另一个角度印证了刚刚的结论。

#### Question 3

> What was the previous mode that the CPU was in?

根据官方指示执行 `p /x $sstatus` 来查看 CPU 的状态，输出如下：
```bash
$2 = 0x200000022
```
`sstatus` 寄存器是 RISC-V 架构中的**特权状态寄存器**。其中**第 8 位**是 **SPP（Supervisor Previous Privilege** 位，用来表示陷入前的特权模式：值为 0 表示之前处于**用户态**，值为 1 表示之前处于**内核态**。

这里 `$sstatus` 寄存器的第 8 位为 0，因此上一个特权模式是**用户态**。

#### Question 4

> Write down the assembly instruction the kernel is panicing at. Which register corresponds to the variable num?

首先将 `syscall()` 中的 `num = p->trapframe->a7;` 这一行替换为 `num = * (int *) 0`，然后执行 `make qemu`，结果如下：
```bash
xv6 kernel is booting

hart 1 starting
hart 2 starting
scause=0xd sepc=0x80001cf8 stval=0x0
panic: kerneltrap
```
这表示内核在启动过程中发生了 `panic`，并给出了 `scause`、`sepc` 和 `stval` 的值，其中 `sepc` 表示**异常发生时的指令地址**。

根据提示，我们可以在内核的**汇编代码**（`kernel/kernel.asm`）中找到 `80001cf8` 对应的汇编指令，结果如下：
```asm
80001cf8:	00002683          	lw	a3,0(zero) # 0 <_entry-0x80000000>
```
这表明引发 panic 的汇编指令是 `lw a3,0(zero)`。结合前面修改过的内核源码，这里对应的是 `num = * (int *) 0` 这一行，因此可知 `num` 对应的寄存器为 `a3`。

#### Question 5

> Why does the kernel crash? Hint: look at figure 3-3 in the text; is address 0 mapped in the kernel address space? Is that confirmed by the value in scause above? (See description of scause in RISC-V privileged instructions)

首先用 GDB 模式启动 xv6，然后在刚刚发生异常的地方设置断点，并查看对应的汇编源码：
```bash
b *0x80001cf8
layout asm
c
```
可以看到，断点处的指令与刚刚在 `kernel/kernel.asm` 中找到的指令相同。

在 xv6 中内核地址空间与物理地址的映射关系如下图所示：

![内核地址映射](/img/内核地址映射.png)

可以看到虚拟地址 0 处并没有映射到任何物理地址，因此当我们用 `lw a3,0(zero)` 来访问虚拟地址 0 时，就会触发异常，导致内核崩溃。

同时，`scause` 寄存器中记录了异常发生的原因。它的值为 0xd，根据 RISC-V 架构文档可知，0xd 对应的是**加载页面错误（load page fault）**，这也印证了前面的分析。

#### Question 6

> What is the name of the process that was running when the kernel paniced? What is its process id (pid)?

可以在断点处运行 `print p->name` 和 `print p->pid` 来查看当前进程的名字和 pid，输出如下：
```bash
(gdb) p p->name
$1 = "init", '\000' <repeats 11 times>
(gdb) p p->pid
$2 = 1
```

#### 潜在坑点

##### 使用 gdb-multiarch 而非 gdb
在窗口 A 中运行完 `make qemu-gdb` 后，官方在 Lab 2 文档中让我们在另一个窗口 B 中运行 `gdb` 来调试 xv6，但实际操作时可能会出现如下报错：

```bash
.gdbinit:2: Error in sourced command file:
Undefined item: "riscv:rv64".
```

这是因为我的电脑 CPU 是 x86_64 架构，WSL2 中的 Ubuntu 也是 x86_64 环境，直接用 `sudo apt install gdb` 安装的通常是面向本机架构的 GDB；而 xv6 运行在 **RISC-V** 之上，所以会出现目标架构不匹配的问题。

因此可以使用 `gdb-multiarch` 代替 `gdb`。它支持多种目标架构，更适合在 x86_64 主机上调试 RISC-V 版本的 xv6。（官方在 guidance 文档里有提到，但 Lab 2 文档里没有展开。）

##### 将 .gdbinit 设置为安全路径

当我们运行 `gdb-multiarch` 后，可能还会产生如下报错：
```bash
warning: File "/home/shoukaku/Projects/personal/xv6-labs-2025/.gdbinit" auto-loading has been declined by your `auto-load safe-path' set to "$debugdir:$datadir/auto-load".
To enable execution of this file add
    add-auto-load-safe-path /home/shoukaku/Projects/personal/xv6-labs-2025/.gdbinit
line to your configuration file "/home/shoukaku/.config/gdb/gdbinit".
To completely disable this security protection add
    set auto-load safe-path /
line to your configuration file "/home/shoukaku/.config/gdb/gdbinit".
For more information about this security protection see the
"Auto-loading safe path" section in the GDB manual. E.g., run from the shell:
    info "(gdb)Auto-loading safe path"
```
这是因为 GDB 启动时会尝试加载当前目录下的 `.gdbinit` 文件。出于安全策略考虑，GDB 默认不会自动加载未加入安全路径的 `.gdbinit`，因此需要根据提示在 `~/.config/gdb/gdbinit` 中将当前项目**设置为安全路径**：
```bash
add-auto-load-safe-path /home/shoukaku/Projects/personal/xv6-labs-2025/.gdbinit
```

### 2. Sandbox a command (moderate) —— 系统调用的实现

**涉及文件：`user/sandbox.c`，`user/user.h`，`user/usys.pl`，`kernel/syscall.h`，`kernel/sysproc.c`，`kernel/proc.h`，`kernel/proc.c`，`kernel/syscall.c`，`Makefile`**

这一部分主要是熟悉在 xv6 中实现一个**系统调用**的完整流程。

#### 需求分析

这一任务要求实现一个沙箱程序（**sandbox**），格式如下：
```bash
sandbox <mask> <path> <cmd> <arg1> <arg2> ...
```
其中 `<mask>` 是一个**掩码**，每一位都对应一个系统调用，为 1 则表示禁止该系统调用；`<path>` 在本题中恒为 `"-"`。程序的具体行为是执行 `cmd arg1 arg2 ...`，但在执行过程中禁止使用 `<mask>` 中指定的系统调用。

本题已经提供了 `user/sandbox.c`，我们真正要实现的是它调用的系统调用 `interpose()`，用于指定当前进程应当**禁止**哪些系统调用。
```c
// user/sandbox.c
int
main(int argc, char *argv[])
{
  int i;
  int n = 2;
  int mask = 1;
  char *nargv[MAXARG];

  if(argc < 4) {
    usage(argv[0]);
  }

  if(argv[mask][0] < '0' || argv[mask][0] > '9'){
    usage(argv[0]);
  }

  n += 1; // skip path
    
  // strip off the first n arguments to sandbox
  for(i = n; i < argc && i < MAXARG; i++){
    nargv[i-n] = argv[i];
  }
  nargv[argc-n] = 0;

  int pid = fork();
  if(pid < 0) {
    printf("%s: exec fork failed\n", argv[0]);
    exit(1);
  }
  if(pid == 0) {
    if (interpose(atoi(argv[mask]), argv[mask+1]) < 0) {
      printf("%s: interpose failed", argv[0]);
      exit(1);
    }
    exec(nargv[0], nargv);
    printf("%s: exec %s failed\n", argv[0], nargv[0]);
    exit(1);
  } else {
    wait(0);
  }
  
  return 0;
}
```
可以看到，`sandbox` 程序会先处理命令行参数，再调用 `fork()` 创建子进程。子进程通过 `interpose(int mask, char *path)` 设置需要禁止的系统调用，最后使用 `exec()` 执行指定命令。

#### 实现思路

第一步是将 `sandbox` 加入 `Makefile`。如果此时直接执行 `make qemu`，编译会报错，因为我们还没有声明过 `interpose()` 这个系统调用。

因此需要先在 `user/user.h` 中声明它：
```c
// user/user.h
int interpose(int,const char*);
```

接着根据 hint，在 `user/usys.pl` 中为这个调用建立一个**存根**，可以仿照其他系统调用的写法来完成：
```perl
// user/usys.pl
//...
entry("pause");
entry("uptime");
entry("interpose");
```

在构建 xv6 时，`Makefile` 会调用 `user/usys.pl` 生成 `user/usys.S`；用户程序执行系统调用存根时，存根会把系统调用号放入 `a7` 并执行 `ecall`。

因为 `usys.S` 中要用到系统调用号，所以还要在 `kernel/syscall.h` 中为 `interpose()` 定义一个**系统调用号**（不能重复）：

```c
// kernel/syscall.h
#define SYS_interpose 22
```

此时再使用 `make qemu` 就能通过编译，但仍然无法正常使用 `sandbox`，因为内核中还没有实现 `interpose()`。

内核侧需要在 `kernel/sysproc.c` 中实现 `sys_interpose()`。在此之前，应当先在 `kernel/syscall.c` 中引入 `sys_interpose()` 的声明，并将其加入系统调用表。系统调用表的作用是**根据系统调用号找到对应的系统调用处理函数**。

```c
// kernel/syscall.c
//...
extern uint64 sys_interpose(void);

static uint64 (*syscalls[])(void) = {
//...
[SYS_close]   sys_close,
[SYS_interpose]  sys_interpose,
};
```

因为掩码 `mask` 代表该进程禁用的系统调用，所以它应当作为进程的一个**属性**保存。这里需要在 `kernel/proc.h` 中为 `struct proc` 添加一个成员变量：
```c
struct proc {
    //...
  uint64 mask;
};
```

接下来就可以在 `kernel/sysproc.c` 中实现核心函数 `sys_interpose()`。它的主要功能是将传入的掩码 `mask` 存入当前进程的属性中：
```c
uint64 
sys_interpose(void)
{
  int mask;
  argint(0,&mask);
  myproc()->mask = mask;
  return 0;
}
```
可以用 `argint()`、`argstr()`、`argaddr()` 来**以不同形式获取系统调用参数**，它们声明在 `kernel/defs.h` 中，实现在 `kernel/syscall.c` 中。

这里 `mask` 以整数形式作为第一个参数，因此使用 `argint(0, &mask)` 获取它的值，然后用 `myproc()` 获取当前进程的 `struct proc`，并将 `mask` 字段设置为对应的值。

由于要求 `mask` 在 `fork()` 时继承给子进程，因此还需要修改 `kernel/proc.c` 中的 `kfork()` 函数，只需加入一行：
```c
int
kfork(void)
{
  //...
  //复制parent的mask
  np->mask = p->mask;

  //...
  return pid;
}
```

最后还要实现**系统调用的拦截**，也就是修改 `kernel/syscall.c` 中的 `syscall()` 函数。每次系统调用发生时，都检查该调用是否被禁用，这可以用位运算实现：

```c
void
syscall(void)
{
  int num;
  struct proc *p = myproc();

  num = p->trapframe->a7;

  // 检查当前系统调用是否被禁止
  if(((1 << num) & (p->mask)) != 0) {
    printf("sandbox:syscall not allow!\n");
    p->trapframe->a0 = -1;
    return;
  }

  //...
}
```

这样一来，如果该系统调用号对应的位为 1，位运算结果就**不为 0**，内核便会拒绝该系统调用并返回。

### 3. Sandbox with allowed pathnames (easy)

#### 需求分析

这一部分要补充 `sandbox` 中的 `path` 参数，其作用是为 `open()` 和 `exec()` 两个系统调用提供**安全路径**。

具体来讲，如果当前系统调用是 `open()` 或 `exec()`，且该系统调用被掩码 `mask` 禁止，但它的**路径参数**与 `path` 相同，则应当允许这次调用执行。

#### 实现思路

**涉及文件：`kernel/proc.h`，`kernel/sysproc.c`，`kernel/proc.c`**

整体思路是在系统调用时进行一个**特判**：如果 `open()` 或 `exec()` 的路径与 `path` 相同，则本次调用不受 `mask` 的影响。

首先，需要在 `struct proc` 中增加 `path` 字段，最大长度为 `MAXPATH`。

```c
// kernel/proc.h
struct proc {
  //...
  //sandbox
  uint64 mask;
  char path[MAXPATH];
};
```

随后修改 `sys_interpose()` 的实现逻辑，加入对 `path` 参数的处理：

```c
// kernel/sysproc.c
uint64 
sys_interpose(void)
{
  int mask;
  char path[MAXPATH];
  argint(0,&mask);
  argstr(1, path, MAXPATH); //以字符串形式获取参数
  myproc()->mask = mask;
  strncpy(myproc()->path, path, MAXPATH);
  return 0;
}
```

进行 `fork()` 操作时，子进程同样应当继承 `path` 字段，因此还要修改 `kernel/proc.c` 中的 `kfork()`：

```c
// kernel/proc.c
int
kfork(void)
{
  //...
  //复制parent的mask
  np->mask = p->mask;
  //复制parent的path
  safestrcpy(np->path, p->path, sizeof(p->path));
  //...
}
```

最后修改 `syscall()` 的逻辑，先判断当前调用是否为 `exec()` 或 `open()`，并检查路径是否相同。如果满足条件，就不拦截这次调用。这里可以使用 `argstr()` 获取路径参数：

```c
if ((num == SYS_open || num == SYS_exec)) {
    char path[MAXPATH];
    argstr(0, path, MAXPATH);
    if (strncmp(p->path, path, MAXPATH) == 0) {
        safePath = 1;
    }
}

if(((1 << num) & (p->mask)) != 0 && !safePath) {
    printf("sandbox:syscall not allow!\n");
    p->trapframe->a0 = -1;
    return;
}
```

#### 潜在坑点

内核中的函数定义在 `kernel/defs.h` 中。这里可用的字符串处理函数是 `strncpy()`、`strncmp()`，而不是 `strcpy()`、`strcmp()`，小心用错导致大量编译报错。

### 4. Attack xv6 (moderate)

**涉及文件：`user/secret.c`，`user/attack.c`**

这一部分要利用 xv6 在 Lab 2 中暴露的漏洞，构建一个 `attack` 攻击程序，读取 `secret` 程序留下的内容。

#### 需求分析

xv6 的漏洞出现在 `kernel/vm.c` 和 `kernel/kalloc.c` 中：

```c
// kernel/vm.c
uint64
uvmalloc(pagetable_t pagetable, uint64 oldsz, uint64 newsz, int xperm)
{
// ...
#ifndef LAB_SYSCALL
    memset(mem, 0, sz);
 #endif
// ...
}

//kernel/kalloc.c
void
kfree(void *pa)
{
// ...
#ifndef LAB_SYSCALL
  // Fill with junk to catch dangling refs.
  memset(pa, 1, PGSIZE);
#endif
// ...
}

// kernel/kalloc.c
void *
kalloc(void)
{
// ...
#ifndef LAB_SYSCALL
  if(r)
    memset((char*)r, 5, PGSIZE); // fill with junk
#endif
  return (void*)r;
}
```

三处代码都有 `#ifndef LAB_SYSCALL` 条件编译指令。这意味着在 Lab 2 中定义 `LAB_SYSCALL` 后，编译时会**省略**掉这几行代码。

这会导致 `uvmalloc()` 和 `kalloc()` 分配内存、以及 `kfree()` 释放内存时都**不会清空页面内容**。于是，新申请到的内存里可能残留已经释放页面中的数据，而我们要做的正是利用这一点来**打破进程间的隔离**。

官方提供了一个 `secret` 程序，它接受一个字符串参数并将其**写入内存**，随后退出并释放内存。

我们的任务是编写 `attack` 程序，输出上一次 `secret` 程序写入的字符串。测试中允许运行两次 `attack`，只要其中一次输出正确内容即可。

#### 实现思路

先观察 `secret` 程序：
```c
#define DATASIZE (8*4096)

char data[DATASIZE];

int
main(int argc, char *argv[])
{
  if(argc != 2){
    printf("Usage: secret the-secret\n");
    exit(1);
  }

  strcpy(data, "This may help.");

  strcpy(data + 16, argv[1]);

  exit(0);
}
```

可以看到，它定义了一个 `8*4096` 字节的全局缓冲区，然后将 `"This may help."` 写入缓冲区起始位置，并将传入的参数写入偏移 16 字节之后的位置，最后退出程序释放内存。

这里 `"This may help."` 起到**标志**作用，用来帮助我们定位内存中的数据位置。找到标志后，再向后移动 16 个字节，就可以得到目标字符串。

xv6 内核维护着一个空闲页面链表，新释放的物理页会**插入到链表头部**，新申请的物理页也会**从链表头部取出**。

因此，在 `attack` 程序中，可以根据提示使用 `sbrk()` 申请指定大小的内存（`8 * 4096` 字节），然后**遍历**这片内存，找到标志字符串的位置：

```c
int
main(int argc, char *argv[])
{
  // Your code here.
  char *data;
  data = sbrk(8*4096);
  for (int i = 0;i < 8*4096;i++) {
    if (strcmp(data,"This may help.") == 0) {
      data += 16;
      printf("%s\n", data);
      exit(0);
    }
    data++;
  }
  exit(1);
}
```

实际运行时，可能需要第二遍 `attack` 才能输出正确内容。grader 也考虑到了这一点，只要求**任意一次输出正确内容即可**。

#### 潜在坑点

一开始看到 `secret` 中 `data` 数组正好占 8 个页面，并且数据从数组头部开始写入，我以为只需要在每一页的开头查找即可。

但实际上，`data` 的起始地址并不保证页对齐，数据可能落在某一页的中间位置，因此必须**遍历整片申请到的内存**来查找标志字符串。

---

## 测试方法与结果
使用
```bash
make grade
```
来运行官方测试，这会对**所有任务**进行测试。

以下是我的完整测试结果：
```bash
== Test answers-syscall.txt ==
answers-syscall.txt: OK
== Test sandbox_mask ==
$ make qemu-gdb
sandbox_mask: OK (2.9s)
== Test sandbox_fork ==
$ make qemu-gdb
sandbox_fork: OK (0.3s)
== Test sandbox_path ==
$ make qemu-gdb
sandbox_path: OK (1.1s)
== Test sandbox_most ==
$ make qemu-gdb
sandbox_most: OK (0.6s)
== Test sandbox_minus ==
$ make qemu-gdb
sandbox_minus: OK (1.1s)
== Test attack ==
$ make qemu-gdb
attack: OK (1.0s)
== Test time ==
time: OK
Score: 45/45
```

---

## 总结与回顾

在 Lab 2 中，我们主要学到了以下几点：
- 熟悉了如何**使用 GDB 调试内核**，包括设置断点、查看调用栈、读取寄存器的值等。
- 熟悉了在操作系统中**实现系统调用**的流程，包括定义系统调用号、在用户态和内核态之间传递参数、在内核中实现系统调用逻辑等。
- 通过**攻击 xv6 内核漏洞**的实验，体会到了内核漏洞可能带来的危害，也进一步理解了内存分配、页面释放和进程隔离的重要性。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
