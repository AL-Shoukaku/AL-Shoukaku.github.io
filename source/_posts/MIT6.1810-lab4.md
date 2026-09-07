---
title: MIT 6.1810 Lab 4:Traps
date: 2026-09-07 12:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab4 全记录，主题是陷入机制
---
# MIT 6.1810 Lab 4: Traps

---

## 实验概览

Lab 4 的主题是 **Traps**，也就是**陷入**，它是 xv6 中的一个重要机制。

在本实验中，我们会学习如何阅读 **RISC-V 汇编**，理解 xv6 中**内核栈**的结构，并通过亲手实现一个定时器功能来熟悉 xv6 的**陷入代码以及整个流程**。

在完成本实验前，可以先阅读 [xv6 book](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf) 的第 4 章，这里会详细地介绍 xv6 中的陷入机制。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. RISC-V assembly (easy)

这一部分我们主要通过回答一些问题来熟悉阅读 RISC-V **汇编代码**的方法。

在 `user` 目录中有一个 `call.c` 程序，我们可以通过 `make fs.img` 来编译生成对应的汇编代码 `call.asm`。

```c
int g(int x) {
  return x+3;
}

int f(int x) {
  return g(x);
}

void main(void) {
  printf("%d %d\n", f(8)+1, 13);
  exit(0);
}
```

> Which registers contain arguments to functions? For example, which register holds 13 in main's call to `printf`?

首先让我们来阅读一下汇编代码：

```assembly
int g(int x) {
   0:	1141                	addi	sp,sp,-16
   2:	e422                	sd	s0,8(sp)
   4:	0800                	addi	s0,sp,16
  return x+3;
}
   6:	250d                	addiw	a0,a0,3
   8:	6422                	ld	s0,8(sp)
   a:	0141                	addi	sp,sp,16
   c:	8082                	ret

000000000000000e <f>:

int f(int x) {
   e:	1141                	addi	sp,sp,-16
  10:	e422                	sd	s0,8(sp)
  12:	0800                	addi	s0,sp,16
  return g(x);
}
  14:	250d                	addiw	a0,a0,3
  16:	6422                	ld	s0,8(sp)
  18:	0141                	addi	sp,sp,16
  1a:	8082                	ret

000000000000001c <main>:

void main(void) {
  1c:	1141                	addi	sp,sp,-16
  1e:	e406                	sd	ra,8(sp)
  20:	e022                	sd	s0,0(sp)
  22:	0800                	addi	s0,sp,16
  printf("%d %d\n", f(8)+1, 13);
  24:	4635                	li	a2,13
  26:	45b1                	li	a1,12
  28:	00001517          	auipc	a0,0x1
  2c:	88850513          	addi	a0,a0,-1912 # 8b0 <malloc+0x106>
  30:	6c6000ef          	jal	6f6 <printf>
  exit(0);
  34:	4501                	li	a0,0
  36:	298000ef          	jal	2ce <exit>
```

在 RISC-V 中，我们通过 **a0 - a7** 来传递函数的参数，如果不够就使用堆栈。从汇编中可以看到，在调用 `printf` 前先进行了如下指令：

```asm
  24:	4635                	li	a2,13
  26:	45b1                	li	a1,12
  28:	00001517          	auipc	a0,0x1
  2c:	88850513          	addi	a0,a0,-1912 # 8b0 <malloc+0x106>
```

这里分别将 `"%d %d\n"`、`12`、`13` 三个参数传递给 a0、a1、a2 三个寄存器。

> Where is the call to function `f` in the assembly code for main? Where is the call to `g`? (Hint: the compiler may inline functions.)

可以看到 `main` 的汇编代码并没有调用 `f`、`g` 两个函数，这是因为这两个函数被编译器内联优化了。编译器在编译时提前算好它们的运行结果，于是便可以直接用 `li` 指令为对应的寄存器赋值。

> At what address is the function `printf` located?

在 `user/call.asm` 中搜索 `<printf>`，可以找到这一行：

```asm
00000000000006f6 <printf>:
```

说明 `printf` 函数的地址位于 `0x6f6`。

> What value is in the register `ra` just after the `jalr` to `printf` in `main`?

从汇编代码中我们可以看到，跳转到 `printf` 函数并没有使用 `jalr`，而是使用了 `jal`。它们的区别只在于前者跳转到**寄存器**中的地址，而后者通过**相对偏移量**寻址。

二者都会将 **PC + 4** 写入 ra 寄存器，用于记录函数调用完毕后返回的地址。因此跳转到 `printf` 后，ra 寄存器的值为 `0x34`。

> Run the following code.
>
> ```bash
> unsigned int i = 0x00646c72;
> printf("H%x Wo%s", 57616, (char *) &i);
> ```
>
> What is the output? Here's an ASCII table that maps bytes to characters.
> The output depends on that fact that the RISC-V is little-endian. If the RISC-V were instead big-endian what would you set `i` to in order to yield the same output? Would you need to change `57616` to a different value?

运行这段代码后，其输出为：`HE110 World`

首先它会输出一个字符 `'H'`，然后会以 **16 进制** 的形式输出 57616，即 `E110`。

然后正常输出 ` Wo`。
 
接下来，先对 `i` 取址，然后将其转换为 `char *` 类型并以**字符串**形式输出，将 `i` 中的值用 ASCII 码转换为字符。

输出字符串**从地址低位开始**，在**小端存储**中地址低位对应字节低位，因此顺序是 `0x72 -> 0x6c -> 0x64 -> 0x00`，分别对应 `r`、`l`、`d`、`\0`。

如果采用**大端存储**，为了得到相同的结果，由于字符串同样从地址低位开始，但此时地址低位对应字节高位，因此需要将 `i` 改为 `0x726c6400`。

不论是小端还是大端，`printf` 都会自动帮我们调整好整数的顺序，因此我们不需要改 57616。

> In the following code, what is going to be printed after `'y='` ? (note: the answer is not a specific value.) Why does this happen?
>
> ```bash
> printf("x=%d y=%d", 3);
> ```

首先，这段代码在 C 语言中无法通过编译，因为传入的参数个数小于占位符的个数，属于**未定义行为**。

如果不考虑编译器报错，y 输出的对应值是**不确定**的。这是因为 x、y 的值分别对应寄存器 a1、a2。而我们调用时只给了 a0、a1 寄存器的参数值，a2 中仍然是**旧值**，所以 y 的值取决于调用前的运行情况。

### 2. Backtrace (moderate)

#### 需求分析

在这一部分，我们要在 `kernel/printf.c` 实现一个 `backtrace()` 函数，这个函数用来按顺序打印当前进程函数的**返回地址**，从而反映**函数的调用关系**。

随后，我们要将 `backtrace()` 函数插入到 `kernel/sysproc.c` 中的 `sys_pause()` 中，这样在调用它时就能打印出函数调用关系。

`bttest` 程序将调用 `pause()`，从而实现打印 `backtrace` 的效果。

#### 栈帧结构

在 RISC-V 架构中，当前进程的栈帧地址在 **s0/fp** 寄存器中。

通过 [lecture notes](https://pdos.csail.mit.edu/6.1810/2023/lec/l-riscv.txt)，我们可以看到栈帧的结构如下：

```txt
      +->          .
      |   +-----------------+   |
      |   | return address  |   |
      |   |   previous fp ------+
      |   | saved registers |
      |   | local variables |
      |   |       ...       | <-+
      |   +-----------------+   |
      |   | return address  |   |
      +------ previous fp   |   |
          | saved registers |   |
          | local variables |   |
      +-> |       ...       |   |
      |   +-----------------+   |
      |   | return address  |   |
      |   |   previous fp ------+
      |   | saved registers |
      |   | local variables |
      |   |       ...       | <-+
      |   +-----------------+   |
      |   | return address  |   |
      +------ previous fp   |   |
          | saved registers |   |
          | local variables |   |
  $fp --> |       ...       |   |
          +-----------------+   |
          | return address  |   |
          |   previous fp ------+
          | saved registers |
  $sp --> | local variables |
          +-----------------+
```

可以看到，帧指针（fp）指向的位置下方分别是**返回地址（fp - 8）、上一个函数的帧指针（fp - 16）、保存的寄存器和局部变量**。在本题中，我们要**打印**偏移量为 -8 的返回地址，并使用偏移量为 -16 的上一个函数的帧指针来实现对于整个栈帧的遍历。

此外，每一个内核栈都会申请一整个页对齐的页面，所以同一个内核栈中的所有栈帧都是**在同一页中**的。因此，我们可以通过**地址是否页对齐**来判断当前是否到了栈的顶部。

#### 实现思路

根据官方提示，我们可以先将以下函数加入到 `kernel/riscv.h` 中，注意要放在 `#ifndef __ASSEMBLER__` 和 `#endif` 之间：

```c
static inline uint64
r_fp()
{
  uint64 x;
  asm volatile("mv %0, s0" : "=r" (x) );
  return x;
}
```

这个函数用于获取当前进程的 **s0 寄存器的值**。里面存放着当前函数的**栈帧地址**。

因此，整体思路是：
1. 获取 s0 寄存器的值作为帧指针。
2. 加上偏移量 -8 拿到存放返回地址的地址，打印出来。
3. 加上偏移量 -16 拿到存放上一个函数帧指针的地址，取出里面的值并更新帧指针指向的地址。
4. 重复第 2、3 步，直到下一个帧指针指向的地址是页对齐的为止。

根据这个思路，`backtrace()` 的实现如下：

```c
void
backtrace()
{
  printf("backtrace:\n");
  uint64 *s0 = (uint64 *)r_fp();
  while(1) {
    printf("%p\n",(uint64 *)*(s0 - 1));
    if (*(s0 - 2) % PGSIZE == 0) {
      break;
    }
    s0 = (uint64 *)*(s0 - 2);
  }
}
```

启动 xv6 后，输入 `bttest` 可以拿到每个函数的返回地址：

```bash
backtrace:
0x0000000080001e9c
0x0000000080001d18
0x0000000080001a9c
```

记下这几个地址，然后**退出 xv6**。在终端输入 `addr2line -e kernel/kernel`，然后再依次输入刚刚的地址：

```bash
addr2line -e kernel/kernel
0x0000000080001e9c
0x0000000080001d18
0x0000000080001a9c
Ctrl-D
```

我们可以拿到如下输出，其中 `project_path` 是你项目的路径，我们可以据此来得到函数的调用关系：

```bash
project_path/xv6-labs-2025/kernel/sysproc.c:85
project_path/xv6-labs-2025/kernel/syscall.c:141 (discriminator 1)
project_path/xv6-labs-2025/kernel/trap.c:80
```

#### 潜在坑点

当下一个帧指针指向的地址是**页对齐**的时候，我们应该直接**退出循环**，而不是把这个栈帧中存储的返回地址也打印出来。

可以这样理解，当前已经到了栈顶，该函数实际上**不被任何一个函数调用**，自然也就没有返回地址。

### 3. Alarm (hard)

#### 需求分析

在这一部分，我们要实现 `sigalarm()` 和 `sigreturn()` 两个系统调用。

`sigalarm(int ticks, void (*handler)())` 用于**在指定时间间隔后调用用户自定义的处理函数**，而 `sigreturn()` 则用于**从处理函数中返回**，继续执行原来的代码。

当我们调用 `sigalarm(0, 0)` 时，表示**取消定期调用处理函数的功能**。

#### 实现思路

##### Test 0: `sigalarm()` 的定期调用

在 Test 0 中，我们的目标是跑通 `sigalarm()` 的整个流程，实现**在指定时间间隔后调用用户自定义的处理函数**。

官方已经提供了 `user/alarmtest.c` 程序，我们首先将它加入到 `Makefile` 中，然后添加用到的两个系统调用 `sigalarm()` 和 `sigreturn()` 的基本框架。添加系统调用的流程已经在 Lab 2 中学过了，这里再次总结一下：

- 在 `user/user.h` 中添加两个函数的声明
- 在 `user/usys.pl` 中添加系统调用存根
- 在 `kernel/syscall.h` 中添加系统调用号
- 在 `kernel/sysproc.c` 中添加两个系统调用的实现函数
- 在 `kernel/syscall.c` 中导入两个函数，并在系统调用表中添加系统调用号和对应函数指针的映射。

添加完两个系统调用后就能通过编译了，在 Test 0 中我们不用考虑 `sigreturn()`，直接**返回 0** 即可。

对于 `sigalarm()`，我们先修改 `struct proc` 结构体，它需要添加三个属性：间隔时长 `interval`，距离上一次调用处理函数的时间 `ticks`，以及处理函数的指针 `handler`。

```c
// kernel/proc.h  struct proc 
  uint64 interval;
  uint64 ticks;
  void (*handler)();
```

随后，我们要在 `kernel/proc.c` 中增加对这三个属性的初始化：

```c
// kernel/proc.c  allocproc()
  p->ticks = 0;
  p->interval = 0;
  p->handler = 0;
```

然后就可以在 `sys_sigalarm()` 中实现该系统调用的核心逻辑了，其实就是**将传入的参数赋值给对应的属性**，并返回 0。

```c
uint64
sys_sigalarm(void)
{
  int interval;
  uint64 handler; 
  argint(0, &interval);
  argaddr(1, &handler);

  myproc()->interval = interval;
  myproc()->handler = (void (*)())handler;
  myproc()->ticks = 0;

  return 0;
}
```

我们可以使用 `argaddr()` 来获取地址参数。此外，当调用 `sigalarm(0, 0)` 时应当**取消定期调用处理函数的功能**，此时参数都为 0，而我们也恰好需要将它们设置为 0，因此不需要额外的判断。

最后，我们要在 `kernel/trap.c` 中实现**定时调用处理函数**的功能。

实现思路也比较简单，每当中断发生时（`which_dev == 2`），我们就检查该进程的 `interval` 是否为 0，如果不为 0 则代表它需要定期调用处理函数，否则正常放弃 CPU。

`interval` 不为 0 时，我们先将 `ticks` 加 1，然后检查它是否等于 `interval`。如果相等，则代表需要调用处理函数，此时应当**把 `epc` 设置为处理函数的地址**，这样就能在回到用户态时调用这个函数了。

```c
// kernel/trap.c  usertrap()
if(which_dev == 2 && myproc() != 0) {
  if (p->interval > 0) {
    p->ticks++;
    if (p->ticks == p->interval) {
      p->ticks = 0;
      void (*handler)() = p->handler;
      p->trapframe->epc = (uint64)handler;
    }
  }
  yield();
}
```

到此，我们就成功实现了 Test 0 的功能。运行 `alarmtest` 可以看到这样的输出：

```bash
$ alarmtest
test0 start
..........................alarm!
oops, sigreturn returned!
```

没有其他输出是正常的，因为我们没有实现 `sigreturn()` 的功能，所以将 `epc` 设置为处理函数地址后，程序就会跳到处理函数处执行，无法再找到原来执行的位置了。

##### Test 1-3: `sigreturn()` 正确返回

Test 1 - 3 的目标之一是实现 `sigreturn()`，使之能够**恢复到处理函数调用前的状态**，从而继续执行原来的代码。另一个则是当一个处理函数正在进行时，如果再次触发中断并到了指定时间，则**不再调用处理函数**，而是直接返回。

为了能够恢复到处理函数调用前的状态，我们必须要在**调用之前**保存当前进程的 `epc` 以及其他寄存器的值，因此要在 `struct proc` 中添加一个新的属性 `alarm_trapframe`，它是一个指向 `struct trapframe` 的指针，用于保存当前进程的寄存器状态。

对于在处理函数中不重复调用的情况，我们可以直接在 `struct proc` 中添加属性 `pending` 来表示是否正在进行处理函数。

```c
// kernel/proc.h  struct proc
int pending;
struct trapframe *alarm_trapframe;
```

接下来，我们要在 `kernel/proc.c` 中初始化这两个属性。注意 `alarm_trapframe` 是一个指针，因此需要**申请一页内存**来存储它，实现方式照抄 `trapframe` 即可。此外，我们还需要在进程释放时加上对于这一页的释放。

```c
// kernel/proc.c  allocproc()
p->pending = 0;
// Allocate a trapframe page.
if((p->alarm_trapframe = (struct trapframe *)kalloc()) == 0){
  freeproc(p);
  release(&p->lock);
  return 0;
}

// kernel/proc.c  freeproc()
if (p->alarm_trapframe)
  kfree((void *)p->alarm_trapframe);
p->alarm_trapframe = 0;  
```

随后，我们需要修改 `usertrap()` 函数的逻辑，加入对于 `pending` 状态的检测以及置位，并在调用处理函数之前保存 `trapframe`。

```c
// kernel/trap.c  usertrap()
if(which_dev == 2 && myproc() != 0) {
  if (p->interval > 0 && p->pending == 0) {
    p->ticks++;
    if (p->ticks == p->interval) {
      p->ticks = 0;
      p->pending = 1;
      void (*handler)() = p->handler;
      *(p->alarm_trapframe) = *(p->trapframe);  
      p->trapframe->epc = (uint64)handler;
    }
  }
  yield();
}
```

注意保存 `trapframe` 的方式是**深拷贝**，而不是直接赋值指针。

这样我们就可以开始实现 `sigreturn()` 的逻辑了，其实就是恢复 `trapframe` 的值，并将 `pending` 置为 0，同时还要注意作为一个系统调用，它还需要正确的**返回值**（a0 寄存器）。

```c
uint64
sys_sigreturn(void)
{
  struct proc *p = myproc();
  *(p->trapframe) = *(p->alarm_trapframe);
  uint64 a0 = p->trapframe->a0;
  p->pending = 0;
  return a0;
}
```

到此，我们就实现了全部功能。运行 `alarmtest` 后的输出如下：

```bash
test0 start
................................alarm!
test0 passed
test1 start
....alarm!
...alarm!
...alarm!
...alarm!
...alarm!
....alarm!
...alarm!
...alarm!
..alarm!
....alarm!
test1 passed
test2 start
............................................alarm!
test2 passed
test3 start
test3 passed
```

此外，我们还可以在 xv6 中运行 `usertests -q` 来验证加入的改动是否会影响之前的功能，出现如下字样表示没问题。

```bash
ALL TESTS PASSED
```

#### 潜在坑点

##### 不要在 `usertrap()` 中直接调用处理函数

一开始我想的是直接在 `usertrap()` 中调用处理函数，因为改了 `epc` 后显然无法回到原来执行的地方：

```c
// kernel/trap.c  usertrap()
if(which_dev == 2 && myproc() != 0) {
  if (p->interval > 0) {
    p->ticks++;
    if (p->ticks == p->interval) {
      p->ticks = 0;
      void (*handler)() = p->handler;
      handler(); // 直接调用处理函数
    }
  }
  yield();
}
```

这样就会出现报错：

```bash
test0 start
......................................scause=0xc sepc=0x0 stval=0x0
panic: kerneltrap
```

这表明在执行 `kerneltrap()` 时出现了问题。实际上，我们就**不应该在内核态执行用户态代码**。在 xv6 book 的 4.5 中有提到，内核态在陷入时只准备了**设备中断**这一种情况，系统调用和异常会被视作内核 bug。

因此，如果我们在内核态执行用户态代码，很可能会出现系统调用或代码本身的 bug，从而导致内核**无法识别陷入类型**，进而 panic。

##### 正确恢复 a0 寄存器的值

官方在 hint 中强调了 `sigreturn()` 必须要正确恢复 a0 寄存器的值。我一开始觉得 `trapframe` 中就包含 a0 寄存器，因此正确恢复 `trapframe` 即可，但这样无法通过 Test 1 的测试。

对于这个问题，我们可以观察 `syscall()` 中的代码：

```c
// kernel/syscall.c  syscall()
p->trapframe->a0 = syscalls[num]();
```

可以看到，在进行完系统调用后，a0 寄存器会被**重写为系统调用的返回值**，因此我们不能再像之前一样直接返回 0，而是要返回 `trapframe` 中 a0 寄存器的值。

##### 记得释放 `alarm_trapframe` 页面

如果我们在 `allocproc()` 中申请了 `alarm_trapframe` 的页面，但在 `freeproc()` 中忘记释放它，那么在 `usertests` 中就会出现报错：

```bash
usertests: FAIL (72.7s)
    ...
                     sepc=0x4442 stval=0x3f013000
         OK
         test lazy_copy: OK
         FAILED -- lost some free pages 25813 (out of 32452)
         $ qemu-system-riscv64: terminating on signal 15 from pid 79812 (make)
    MISSING '^ALL TESTS PASSED$'
    QEMU output saved to xv6.out.usertests
```

这表明我们有一些空闲的物理内存丢失了，实际上就是没有释放 `alarm_trapframe` 的页面。

之所以会出现这个问题，是因为我们在申请完这一页后没有映射到任何虚拟地址上，因此它不会随着其他映射的页面一起被释放。

那这是否意味着我们要映射到某个特定的虚拟地址上呢？如果随便选某个位置，我们不能保证指定的地址之前**有没有被别的地址映射过**。

那如果像 `TRAPFRAME` 一样映射到虚拟空间的顶部呢？理论上是可行的，但涉及这两个特殊页的代码很多，我们要保证所有处理 `TRAPFRAME` 的地方都处理好 `alarm_trapframe`，这会很麻烦。

实际上，`TRAMPOLINE`、`TRAPFRAME` 这两页之所以要被映射到特殊地址，是因为它们要在陷入内核时发挥作用，必须保证它们在内核空间和用户空间的地址是**一致的**，而 `alarm_trapframe` 实际上只是内核中用来保存 `trapframe` 副本的一页，因此我们其实**不需要**将它映射到虚拟空间的某个位置上。

综上所述，我们最终只需要在 `freeproc()` 中用 `kfree()` 释放掉这一页即可：

---

## 测试方法与结果
使用：

```bash
make grade
```
来运行官方测试，这将会对**所有任务**进行测试。

以下是我的完整测试结果：

```bash
== Test answers-traps.txt ==
answers-traps.txt: OK
== Test backtrace test ==
$ make qemu-gdb
backtrace test: OK (3.0s)
== Test running alarmtest ==
$ make qemu-gdb
(3.8s)
== Test   alarmtest: test0 ==
  alarmtest: test0: OK
== Test   alarmtest: test1 ==
  alarmtest: test1: OK
== Test   alarmtest: test2 ==
  alarmtest: test2: OK
== Test   alarmtest: test3 ==
  alarmtest: test3: OK
== Test usertests ==
$ make qemu-gdb
usertests: OK (70.6s)
== Test time ==
time: OK
Score: 95/95
```

---

## 总结与回顾

在本次实验中，我们首先学习了如何阅读 **RISC-V 汇编代码**，了解了在汇编中如何调用函数，如何传递参数以及一些编译器给我们带来的优化等内容。

随后，我们学习了**栈帧的结构**，并通过实现 `backtrace()` 函数来熟悉**内核栈的使用**，同时通过其结果了解了 xv6 中的陷入流程。

最后，我们在提示下亲手实现了一个**定时器**，通过 `sigalarm()` 和 `sigreturn()` 两个系统调用来实现**在指定时间间隔后调用用户自定义的处理函数**，并在处理函数中正确返回到原来的执行位置。在这个过程中，我们深入到了陷入的相关代码之中，学习了陷入过程中对于寄存器的保存和恢复、用户态和内核态间相互切换的相关机制，以及从陷入中返回等内容。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
