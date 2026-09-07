---
title: MIT 6.1810 Lab 3:Page Tables
date: 2026-09-03 20:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab3 全记录，主题是页表机制
---
# MIT 6.1810 Lab 3: Page Tables

---

## 实验概览

Lab 3 的主题是 xv6 中的**页表机制**。

我们将在本实验中学习 xv6 的内存管理机制，包括**三级页表**结构、**内核空间**与**用户空间**的地址结构及映射方式、**权限位**的设置与使用等。此外，我们还会在 xv6 原有的基础上实现**超级页(superpage)**功能。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Inspect a user-process page table (easy)

该任务用于帮助我们理解 xv6 的页表结构。

#### 需求分析

我们需要在 xv6 中运行 `pgtbltest` 程序，它会打印出这个进程（pgtbltest）的前 10 页和最后 10 页的信息，输出如下：

```bash
va 0x0 pte 0x21FC885B pa 0x87F22000 perm 0x5B
va 0x1000 pte 0x21FC7C5B pa 0x87F1F000 perm 0x5B
va 0x2000 pte 0x21FC7817 pa 0x87F1E000 perm 0x17
va 0x3000 pte 0x21FC7407 pa 0x87F1D000 perm 0x7
va 0x4000 pte 0x21FC70D7 pa 0x87F1C000 perm 0xD7
va 0x5000 pte 0x0 pa 0x0 perm 0x0
va 0x6000 pte 0x0 pa 0x0 perm 0x0
va 0x7000 pte 0x0 pa 0x0 perm 0x0
va 0x8000 pte 0x0 pa 0x0 perm 0x0
va 0x9000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFF6000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFF7000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFF8000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFF9000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFFA000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFFB000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFFC000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFFD000 pte 0x0 pa 0x0 perm 0x0
va 0x3FFFFFE000 pte 0x21FD08C7 pa 0x87F42000 perm 0xC7
va 0x3FFFFFF000 pte 0x2000184B pa 0x80006000 perm 0x4B
```

我们需要分析里面的内容并回答以下问题：

> For every page table entry in the print_pgtbl output, explain what it logically contains and what its permission bits are. Figure 3.4 in the xv6 book might be helpful, although note that the figure might have a slightly different set of pages than process that's being inspected here. Note that xv6 doesn't place the virtual pages consecutively in physical memory.

#### xv6 页表结构

xv6 采用了三级页表结构，如下图所示：

![alt text](/img/MIT6.1810/xv6页表结构.png)

**虚拟地址**为 64 位，采用 RISC-V 的 Sv39 地址转换模式，即**只使用低 39 位**的虚拟地址。其中 0-11 位为**页内偏移（页大小为 4KB）**，12 - 38 位为**页表索引**。如果有需要，可以扩展为 Sv48 模式（低 48 位的虚拟地址）。

**物理地址**为 56 位，这是由 RISC-V 的芯片设计者根据对未来的需求所做的预测。物理地址中的 0-11 位为**页内偏移**，12 - 55 位为**物理页号（PPN）**。

**页表项（PTE）**是一个 64 位的整数，其低 10 位为**权限位**，中间的 44 位为物理页号（PPN），而高 10 位为保留位，不使用。

因此，通过三级页表结构来进行**虚拟地址**到**物理地址**的翻译的过程如下：

1. RISC-V 中的 **satp** 寄存器存储了当前进程最高级页表的物理页号，将其左移 12 位后可以得到该页的物理地址。
2. 取虚拟地址的 **30 - 38** 位作为索引找到对应的页表项，得到下一级页表的物理页号。
3. 取虚拟地址的 **21 - 29** 位作为索引找到对应的页表项，得到最低级页表的物理页号。
4. 取虚拟地址的 **12 - 20** 位作为索引找到对应的页表项，得到最终的物理页号。
5. 将最终的物理页号左移 12 位后加上虚拟地址的 0 - 11 位即可得到最终的物理地址。

在 2 - 4 步中，还要检查页表项的**权限位**，例如是否有效（V）、是否可在用户态访问（U）等。

#### 分析输出结果

对于每一行输出，都包含了虚拟地址（va）、页表项（pte）、物理地址（pa）以及权限位（perm）。

这里的页表项是**最低级页表**的页表项，其低 10 位就是权限（perm），10 - 53 位是物理页号（PPN），将其左移 12 位后加上虚拟地址的 0 - 11 位即可得到物理地址（pa）。

这样我们就可以逐个分析输出结果，重点分析其**权限位（perm）**。最后可以发现，它与 xv6 book 中图 3.4 的用户地址空间是对应的：

![alt text](/img/MIT6.1810/用户地址空间.png)

在输出中：
- 第 1-2 页对应**代码段（text）**。
- 第 3 页对应**数据段（data）**。
- 第 4 页对应**保护页（guard page）**，用于防止堆栈溢出。
- 第 5 页对应**堆栈（stack）**。
- 第 6-10 页、倒数第 3-10 页的有效位都是 0，表示**未被映射**。
- 倒数第 2 页对应程序的 `trapframe`。
- 倒数第 1 页对应程序的**跳板页（trampoline）**。

### 2. Speed up system calls (easy)

#### 需求分析

xv6 中的系统调用 `getpid()` 用于根据当前进程的 `struct proc` 结构体来返回其中的进程 `pid`。由于在**用户态**下无法直接访问内核态的 `struct proc` 结构体，因此每次调用 `getpid()` 时都需要**陷入内核**，这会带来额外的开销。

本题中我们要做的就是**优化这个系统调用**。具体来讲，就是**每个进程**都在地址 `USYSCALL` 处映射一个物理页，并在该页起始位置存储结构体 `struct usyscall`（二者均定义于 `kernel/memlayout.h`），并将权限设为**用户态只读**。

这样我们就可以通过 `user/ulib.c` 中已经实现的 `ugetpid()`，在用户态完成 `pid` 的获取，从而实现性能优化。

此外，我们还要在 `answers-pgtbl.txt` 中回答以下问题：

> Which other xv6 system call(s) could be made faster using this shared page? Explain how.

#### 相关内核态函数

要想实现这个功能必须基于几个内存管理相关的内核态函数：

```c
// kernel/vm.c
pte_t *
walk(pagetable_t pagetable, uint64 va, int alloc)
{
  if(va >= MAXVA)
    panic("walk");

  for(int level = 2; level > 0; level--) {
    pte_t *pte = &pagetable[PX(level, va)];
    if(*pte & PTE_V) {
      pagetable = (pagetable_t)PTE2PA(*pte);
#ifdef LAB_PGTBL
      if(PTE_LEAF(*pte)) {
        return pte;
      }
#endif
    } else {
      if(!alloc || (pagetable = (pde_t*)kalloc()) == 0)
        return 0;
      memset(pagetable, 0, PGSIZE);
      *pte = PA2PTE(pagetable) | PTE_V;
    }
  }
  return &pagetable[PX(0, va)];
}

int
mappages(pagetable_t pagetable, uint64 va, uint64 size, uint64 pa, int perm)
{
  uint64 a, last;
  pte_t *pte;

  if((va % PGSIZE) != 0)
    panic("mappages: va not aligned");

  if((size % PGSIZE) != 0)
    panic("mappages: size not aligned");

  if(size == 0)
    panic("mappages: size");
  
  a = va;
  last = va + size - PGSIZE;
  for(;;){
    if((pte = walk(pagetable, a, 1)) == 0)
      return -1;
    if(*pte & PTE_V)
      panic("mappages: remap");
    *pte = PA2PTE(pa) | perm | PTE_V;
    if(a == last)
      break;
    a += PGSIZE;
    pa += PGSIZE;
  }
  return 0;
}

void
uvmunmap(pagetable_t pagetable, uint64 va, uint64 npages, int do_free)
{
  uint64 a;
  pte_t *pte;
  int sz = PGSIZE;

  if((va % PGSIZE) != 0)
    panic("uvmunmap: not aligned");

  for(a = va; a < va + npages*PGSIZE; a += sz){
    if((pte = walk(pagetable, a, 0)) == 0) // leaf page table entry allocated?
      continue;
    if((*pte & PTE_V) == 0)  // has physical page been allocated?
      continue;
    sz = PGSIZE;
    if(PTE_FLAGS(*pte) == PTE_V)
      panic("uvmunmap: not a leaf");
    if(do_free){
      uint64 pa = PTE2PA(*pte);
      kfree((void*)pa);
    }
    *pte = 0;
  }
}

void
uvmfree(pagetable_t pagetable, uint64 sz)
{
  if(sz > 0)
    uvmunmap(pagetable, 0, PGROUNDUP(sz)/PGSIZE, 1);
  freewalk(pagetable);
}

void
freewalk(pagetable_t pagetable)
{
  // there are 2^9 = 512 PTEs in a page table.
  for(int i = 0; i < 512; i++){
    pte_t pte = pagetable[i];
    if((pte & PTE_V) && (pte & (PTE_R|PTE_W|PTE_X)) == 0){
      // this PTE points to a lower-level page table.
      uint64 child = PTE2PA(pte);
      freewalk((pagetable_t)child);
      pagetable[i] = 0;
    } else if(pte & PTE_V){
      // backtrace();
      panic("freewalk: leaf");
    }
  }
  kfree((void*)pagetable);
}
```

`walk()` 函数用来根据**根页表**和**虚拟地址**，寻找虚拟地址对应的页表项（最低级页表）。当 `alloc` 参数为 1 时，如果该虚拟地址对应的页表项不存在（有效位为 0），则会**分配一个新的页表**。

`mappages()` 函数根据**根页表**，分别从**虚拟地址 `va`** 和**物理地址 `pa`** 开始，映射 `size` 大小的地址空间，并设置权限位为 `perm`。

`uvmunmap()` 函数根据**根页表**和**虚拟地址 `va`**，取消映射 `npages` 页的地址空间。如果 `do_free` 为 1，则取消映射的同时释放该物理页（插回空闲列表）。

`uvmfree()` 用于释放一个进程从 0 开始到 `sz` 大小的所有虚拟地址空间，它先解除所有映射，然后再用 `freewalk()` 来释放所有相关物理页。

`freewalk()` 函数用于递归释放所有页表。如果当前是有效的非叶子页表项，则置 0 并递归调用 `freewalk()` 来释放下一级页表，并在遍历完后释放该页表对应的物理页；如果是叶子页表项，则**要求已经取消映射，否则直接 panic**。

```c
// kernel/kalloc.c
void
kfree(void *pa)
{
  struct run *r;

  if(((uint64)pa % PGSIZE) != 0 || (char*)pa < end || (uint64)pa >= PHYSTOP)
    panic("kfree");

  // Fill with junk to catch dangling refs.
  memset(pa, 1, PGSIZE);

  r = (struct run*)pa;

  acquire(&kmem.lock);
  r->next = kmem.freelist;
  kmem.freelist = r;
  release(&kmem.lock);
}

void *
kalloc(void)
{
  struct run *r;

  acquire(&kmem.lock);
  r = kmem.freelist;
  if(r)
    kmem.freelist = r->next;
  release(&kmem.lock);

  if(r)
    memset((char*)r, 5, PGSIZE); // fill with junk
  return (void*)r;
}
```

`kalloc()` 函数用于从空闲物理页列表中**取出**一个物理页，并返回其物理地址；

`kfree()` 函数用于将指定物理地址的物理页**插回**空闲物理页列表中。

可以看到在 xv6 中，地址映射和物理页分配/回收是分开的，尤其需要注意在取消映射时要记得判断是否要释放该物理页。

#### 详细实现

理解完相关的辅助函数后，整体思路就比较简单了：在创建一个进程时，先用 `kalloc()` 分配一个物理页，并在该页的起始位置存储 `struct usyscall` 结构体并初始化 `pid`，最后用 `mappages()` 将该物理地址与 `USYSCALL` 进行映射。

在映射时还要注意设置权限。由于需要实现**用户态只读**，因此需要设置权限位为 `PTE_R | PTE_U`。这里不需要设置 `PTE_V`，因为 `mappages()` 函数会在映射时自动设置有效位。

首先要在 `kernel/proc.c` 中找到 `allocproc()` 函数。这个函数用来获取空闲的 PCB 并创建新进程，我们要在此处加入对于 `USYSCALL` 的映射。

```c
static struct proc*
allocproc(void)
{
    //...

  //先申请一个物理页，初始化pid，然后与虚拟地址建立映射
  void *pa = kalloc();
  struct usyscall* usyscall =  (struct usyscall *)pa;
  usyscall->pid = p->pid;
  if(mappages(p->pagetable, USYSCALL, PGSIZE, (uint64)pa, PTE_R | PTE_U) < 0) {
    printf("usyscall:映射失败！");
  }

  // Set up new context to start executing at forkret,
  // which returns to user space.
  memset(&p->context, 0, sizeof(p->context));
  p->context.ra = (uint64)forkret;
  p->context.sp = p->kstack + PGSIZE;

  return p;
}
```

只在所有进程创建时进行映射是不够的，因为在 `exec()` 时，当前进程的地址空间会被新的程序**覆盖**，我们所建立的映射也就没了。因此，还需要在 `kernel/exec.c` 中修改 `kexec()` 函数，在加载新的程序后重新建立映射。

```c
int
kexec(char *path, char **argv)
{
  //...
  //先申请一个物理页，然后与虚拟地址建立映射
  void *pa = kalloc();
  struct usyscall* usyscall =  (struct usyscall *)pa;
  usyscall->pid = p->pid;
  if(mappages(p->pagetable, USYSCALL, PGSIZE, (uint64)pa, PTE_R | PTE_U) < 0) {
    printf("usyscall:映射失败！");
  }

  return argc; // this ends up in a0, the first argument to main(argc, argv)

 bad:
  if(pagetable)
    proc_freepagetable(pagetable, sz);
  if(ip){
    iunlockput(ip);
    end_op();
  }
  return -1;
}
```

到此就完成了所有进程对于 `USYSCALL` 地址的映射，接下来关注进程释放时**解除映射**的逻辑。

```c
// kernel/proc.c
static void
freeproc(struct proc *p)
{
  if(p->trapframe)
    kfree((void*)p->trapframe);
  p->trapframe = 0;
  if(p->pagetable)
    proc_freepagetable(p->pagetable, p->sz);
  p->pagetable = 0;
  p->sz = 0;
  p->pid = 0;
  p->parent = 0;
  p->name[0] = 0;
  p->chan = 0;
  p->killed = 0;
  p->xstate = 0;
  p->state = UNUSED;
}

// Free a process's page table, and free the
// physical memory it refers to.
void
proc_freepagetable(pagetable_t pagetable, uint64 sz)
{
  uvmunmap(pagetable, TRAMPOLINE, 1, 0);
  uvmunmap(pagetable, TRAPFRAME, 1, 0);
  uvmfree(pagetable, sz);
}
```

可以看到，在释放一个进程 `freeproc()` 时，会首先释放 `trapframe` 对应的物理页，然后调用 `proc_freepagetable()`，先解除 `TRAMPOLINE` 和 `TRAPFRAME` 的映射，再调用 `uvmfree()` 来释放 0 - sz 的地址空间。

这里需要**重点注意**：`uvmfree` 只会释放页表和 0 - sz 的映射，而 `TRAMPOLINE` 和 `TRAPFRAME` 位于地址空间的最顶部，所以 `uvmfree()` 不会覆盖这部分，也就不会解除它们映射并释放物理页，这也是为什么它们两个要**单独处理**。

来看 `USYSCALL` 的定义：

```c
#define USYSCALL (TRAPFRAME - PGSIZE)
```

可以看到 `USYSCALL` 就位于 `TRAPFRAME` 下方一页，因此它也**不会**被 `uvmfree()` 覆盖，所以我们也需要在 `proc_freepagetable()` 中**单独解除它的映射并释放物理页**。

```c
void
proc_freepagetable(pagetable_t pagetable, uint64 sz)
{
  uvmunmap(pagetable, TRAMPOLINE, 1, 0);
  uvmunmap(pagetable, TRAPFRAME, 1, 0);
  uvmunmap(pagetable, USYSCALL, 1, 1);  //do_free为 1，表示解除映射时同时释放该物理内存
  uvmfree(pagetable, sz);
}
```

注意到这里的 `do_free` 参数设置为 1，这样在解除映射的同时可以释放物理页，不用再单独进行 `kfree()`。

我们还会注意到，这里并没有对 `TRAMPOLINE` 对应的物理页进行释放。这是因为这一页是**所有进程共享**的，在创建进程时实际上也没有为这一页进行 `kalloc()`，因此在释放时也不需要进行 `kfree()`。

这样就完成了 `getpid()` 的优化，在运行 `pgtbltest` 时可以看到如下输出：

```bash
ugetpid_test starting
ugetpid_test: OK
```

最后我们再来看看要回答的问题：

我们能实现 `getpid()` 的优化，本质上是将一个只能在内核态访问的属性映射到了用户态，从而使它可以在用户态访问，不用陷入内核。

因此我们只需要找其他**只需要读取一个内核中的属性**的系统调用，最典型的就是 `uptime()`，它需要读取内核并返回内核中的 `ticks`。

因此可以将 `ticks` 映射到用户空间的一个指定地址，进行系统调用时直接访问这个地址获取 `ticks`，从而避免陷入内核，实现性能优化。

#### 潜在坑点

一开始我在解除 `USYSCALL` 的映射时将它放在了 `freeproc()` 中：

```c
static void
freeproc(struct proc *p)
{
  uvmunmap(pagetable, USYSCALL, 1, 1);  //do_free为 1，表示解除映射时同时释放该物理内存
  if(p->trapframe)
    kfree((void*)p->trapframe);
  p->trapframe = 0;
  if(p->pagetable)
    proc_freepagetable(p->pagetable, p->sz);
//...
}
```

我一开始觉得每个进程释放时都要走 `freeproc()`，放在这里和放在 `proc_freepagetable()` 中应该是一样的，只是顺序不同而已，但在启动内核时就会遇到如下报错：

```bash
xv6 kernel is booting

hart 2 starting
hart 1 starting
init: starting sh
panic: freewalk: leaf
```

这表明在 `freewalk()` 中有**子页表项的映射未解除**，很显然就是我们加入的 `USYSCALL` 这页。

经过 AI 的提示，我最后才发现在 `kexec()` 中有这样一行：`proc_freepagetable(oldpagetable, oldsz);`

显然，在 `exec()` 中我们需要释放旧的页表并用新程序的页表替换它，然而释放旧页表走的是 `proc_freepagetable()`，而不是 `freeproc()`。因此，如果将解除映射的逻辑放在 `freeproc()` 中，那么 `proc_freepagetable()` 中就不会解除这个映射，最终造成了这个问题。

这个问题的根源在于没有弄清各个函数所负责的功能。`freeproc()` 是负责释放进程的，不适合单独将一个解除映射的逻辑放在这里；而 `proc_freepagetable()` 是负责释放页表的，才是适合放置这个逻辑的地方。

### 3. Print a page table (easy)

#### 需求分析

在 Lab 3 中，`kpgtbl` 系统调用负责调用打印当前进程的页表信息，它通过调用 `vmprint()` 来实现这一点：

```c
#ifdef LAB_PGTBL
int
sys_kpgtbl(void)
{
  struct proc *p;  

  p = myproc();
  vmprint(p->pagetable);
  return 0;
}
#endif
```

我们的任务就是实现 `vmprint()` 函数，它需要根据**根页表**按照指定格式打印出当前进程的页表信息，输出示例如下：

```bash
page table 0x0000000087f22000
 ..0x0000000000000000: pte 0x0000000021fc7801 pa 0x0000000087f1e000
 .. ..0x0000000000000000: pte 0x0000000021fc7401 pa 0x0000000087f1d000
 .. .. ..0x0000000000000000: pte 0x0000000021fc7c5b pa 0x0000000087f1f000
 .. .. ..0x0000000000001000: pte 0x0000000021fc705b pa 0x0000000087f1c000
 .. .. ..0x0000000000002000: pte 0x0000000021fc6cd7 pa 0x0000000087f1b000
 .. .. ..0x0000000000003000: pte 0x0000000021fc6807 pa 0x0000000087f1a000
 .. .. ..0x0000000000004000: pte 0x0000000021fc64d7 pa 0x0000000087f19000
 ..0x0000003fc0000000: pte 0x0000000021fc8401 pa 0x0000000087f21000
 .. ..0x0000003fffe00000: pte 0x0000000021fc8001 pa 0x0000000087f20000
 .. .. ..0x0000003fffffd000: pte 0x0000000021fd4813 pa 0x0000000087f52000
 .. .. ..0x0000003fffffe000: pte 0x0000000021fd00c7 pa 0x0000000087f40000
 .. .. ..0x0000003ffffff000: pte 0x0000000020001c4b pa 0x0000000080007000
```

在第一行，我们首先要打印 `page table`，然后是根页表的地址。

随后的每一个页表项，前面的 `..` 代表该页表项的**层级**，然后输出对应的**虚拟地址**、**页表项**和**物理地址**。

还应当注意**有效位为 0 的页表项不打印**。

此外我们还要回答问题：

> For every leaf page in the vmprint output, explain what it logically contains and what its permission bits are, and how it relates to the output of the earlier print_pgtbl() exercise above. Figure 3.4 in the xv6 book might be helpful, although note that the figure might have a slightly different set of pages than the process that's being inspected here.

#### 详细实现

根据 hint，我们可以参考 `kernel/vm.c` 中 `freewalk()` 的实现：

```c
void
freewalk(pagetable_t pagetable)
{
  // there are 2^9 = 512 PTEs in a page table.
  for(int i = 0; i < 512; i++){
    pte_t pte = pagetable[i];
    if((pte & PTE_V) && (pte & (PTE_R|PTE_W|PTE_X)) == 0){
      // this PTE points to a lower-level page table.
      uint64 child = PTE2PA(pte);
      freewalk((pagetable_t)child);
      pagetable[i] = 0;
    } else if(pte & PTE_V){
      // backtrace();
      panic("freewalk: leaf");
    }
  }
  kfree((void*)pagetable);
}
```

可以看到，其思想是遍历当前页表的所有页表项。如果是有效的非叶子页表项，则递归调用 `freewalk()` 去遍历下一级页表，并在最后释放自己的物理页。

如果是叶子页表项，则不进行递归，到最后直接释放自己的物理页。

我们可以把 `freewalk()` 中释放的操作替换为打印，以相似的方式来实现 `vmprint()`。

```c
void
vmprint(pagetable_t pagetable) {
  // your code here
  printf("page table %p\n", pagetable);
  uint64 va = 0;
  for (int i = 0; i < 512; i++) {
    pte_t pte = pagetable[i];
    if (pte & PTE_V) {
      uint64 child = PTE2PA(pte);
      pteprint((pagetable_t)child, 1, pte, va);
    }
    va += (uint64)1 << (12 + 2 * 9);
  }
}
```

首先我们打印第一行的 `page table` 信息，实际上就是传入的参数 `pagetable`，可以用 `%p` 来打印 64 位的 16 进制数。

随后我们逐个遍历当前页表的所有页表项。当前显然不是叶子页表项，所以我调用辅助函数 `pteprint()` 来进行递归：

```c
void 
pteprint(pagetable_t pagetable, int level, pte_t pte, uint64 va) {
  switch(level) {
    case 1:
      printf("..");
      break;
    case 2:
      printf(".. ..");
      break;
    default:
      printf(".. .. ..");    
  }

  printf("%p: pte %p pa %p\n", (void *)va, (void *)pte, (void *)PTE2PA(pte));

  if (level == 3) {
    return;
  }

  for (int i = 0; i < 512; i++) {
    pte_t pte = pagetable[i];
    if (pte & PTE_V) {
      uint64 child = PTE2PA(pte);
      pteprint((pagetable_t)child, level + 1, pte, va);
    }
    va += (uint64)1 << (12 + (2 - level) * 9);
  }
}
```

之所以构造这个辅助函数，是因为我们需要记录当前的页表层级 `level`，并根据层级打印不同数量的 `..`（注意最开头有一个空格），每一次递归都让 `level` 加一。

与 `freewalk()` 不同的是，我们要在**遍历之前**打印信息，而不是在之后。

当到了**最低层级**的页表时（`level == 3`），由于不再有更低级的页表，所以直接 `return` 即可。

这里还有一个难点就是虚拟地址 `va` 的计算。在 xv6 中一页的大小是 **4KB**，因此最低一级页表的两个页表项之间差 `1 << 12` 的地址。

一个高级页表包含 **512** 个低级页表项，因此每高一级，相邻页表项 `va` 的差值就要多**左移 9 位**，这样就可以得到正确的虚拟地址了。

最后的输出如下：

```bash
print_kpgtbl starting
page table 0x0000000087f22000
 ..0x0000000000000000: pte 0x0000000021fc7801 pa 0x0000000087f1e000
 .. ..0x0000000000000000: pte 0x0000000021fc7401 pa 0x0000000087f1d000
 .. .. ..0x0000000000000000: pte 0x0000000021fc7c5b pa 0x0000000087f1f000
 .. .. ..0x0000000000001000: pte 0x0000000021fc705b pa 0x0000000087f1c000
 .. .. ..0x0000000000002000: pte 0x0000000021fc6cd7 pa 0x0000000087f1b000
 .. .. ..0x0000000000003000: pte 0x0000000021fc6807 pa 0x0000000087f1a000
 .. .. ..0x0000000000004000: pte 0x0000000021fc64d7 pa 0x0000000087f19000
 ..0x0000003fc0000000: pte 0x0000000021fc8401 pa 0x0000000087f21000
 .. ..0x0000003fffe00000: pte 0x0000000021fc8001 pa 0x0000000087f20000
 .. .. ..0x0000003fffffd000: pte 0x0000000021fd4853 pa 0x0000000087f52000
 .. .. ..0x0000003fffffe000: pte 0x0000000021fd00c7 pa 0x0000000087f40000
 .. .. ..0x0000003ffffff000: pte 0x000000002000184b pa 0x0000000080006000
print_kpgtbl: OK
```

实际的分析方法和第 1 题中的方法类似，根据权限位可以发现，它与 xv6 book 中图 3.4 的用户地址空间是对应的。

在这里我们发现多出来一页权限为 0x53 的页表项，这代表**用户态只读**，恰好对应了我们在第 2 题中映射的 `USYSCALL` 页。

### 4. Use superpages (moderate)/(hard)

#### 需求分析

我们知道 xv6 中一个页面的大小为 4KB，而我们现在要做的就是让它支持 2MB 大小的页面，称之为**超级页（superpage）**，又称 **megapage**。使用超级页能够降低页表占用的空间并提高 TLB 的命中率，而缺点则是会带来更多的页内碎片。

具体来讲，普通页面是由最低级页表（level 0）的页表项指向的，而我们要实现的超级页由 **level 1 页表**的页表项所指向。普通的 level 1 页表项的权限位为 `PTE_V`，而超级页的 level 1 页表项的权限位为 `PTE_V | PTE_R`，我们通过这样的方式来进行区分。

xv6 内核中原有的内存分配器维护一个空闲物理页链表，每一个节点都是一个 4KB 页面。我们要将其**拆分成两部分**：链表 A 负责管理 4KB 的空闲页面，链表 B 负责管理 2MB 的空闲页面。

在为进程分配内存时（如 `sbrk()`），如果单次申请的内存大小**大于等于 2MB**，则应当分配给它超级页。

同时，如果一个进程使用了超级页，那它在进行 **`fork()`** 时，它的子进程也应当使用超级页。

和普通页面一样，我们应当支持超级页的**分配、映射、回收、解除映射**。特别地，如果我们只解除超级页的一部分映射，我们应当将它**降级为 512 个普通页面**，然后再解除对应的映射。

#### 详细实现

首先让我们观察 `kernel/kalloc.c` 中关于 xv6 的内存初始化机制：
```c
extern char end[]; // first address after kernel.
                   // defined by kernel.ld.

struct run {
  struct run *next;
};

struct {
  struct spinlock lock;
  struct run *freelist;
} kmem;

void
kinit()
{
  initlock(&kmem.lock, "kmem");
  freerange(end, (void*)PHYSTOP);
}

void
freerange(void *pa_start, void *pa_end)
{
  char *p;
  p = (char*)PGROUNDUP((uint64)pa_start);
  for(; p + PGSIZE <= (char*)pa_end; p += PGSIZE)
    kfree(p);
}
```

我们可以看到 xv6 中一个空闲页实际上由一个 `struct run` 结构体来表示，其元素是指向下一个页面的指针，这样就构成了一个空闲页面的**链表**。

`kmem` 是一个没有名字的结构体，它包含这个链表以及一个**锁（lock）**，用来实现内存分配与回收的**互斥访问**。

`kinit()` 中首先初始化锁，然后调用 `freerange()`。它负责对范围内的页面物理地址调用 `kfree()`，这会将对应的内容清零并将该页面插入到空闲链表中，从而完成链表的构建。在这里，`end` 是空闲物理地址的起始点。

因此我们可以仿照着实现对于超级页的初始化。我们知道 xv6 的内存大小为 128MB，这里分配给超级页一半的空间 `64MB`（这个数可以随意，够用即可）：

```c
//superpage的链表
struct {
  struct spinlock lock;
  struct run *freelist;
} supermem;

void
kinit()
{
  initlock(&kmem.lock, "kmem");
  //初始化超级页的锁
  initlock(&supermem.lock, "supermem");
  //保留 64MB 来给超级页
  freerange(end, (void*)PHYSTOP - 64 * (1 << 20));
  superfreerange((void*)PHYSTOP - 64 * (1 << 20), (void *)PHYSTOP);
}

//用于初始化超级内存
void 
superfreerange(void *pa_start, void *pa_end)
{
  char *p;
  p = (char*)SUPERPGROUNDUP((uint64)pa_start);
  for(; p + SUPERPGSIZE <= (char*)pa_end; p += SUPERPGSIZE)
    superfree(p);
}
```

`kernel/kalloc.c` 中通过 `kalloc()` 和 `kfree()` 来实现页面的**分配与回收**，本质上是从空闲链表中取出/放入一页，并且使用锁来实现互斥访问。因此我们需要仿照着实现对于超级页的分配与释放：

```c
void *
superalloc(void) {
  struct run *r;

  acquire(&supermem.lock);
  r = supermem.freelist;
  if(r)
    supermem.freelist = r->next;
  release(&supermem.lock);

  if(r)
    memset((char*)r, 5, SUPERPGSIZE); // fill with junk
  return (void*)r;
}

void
superfree(void *pa) {
    struct run *r;

  if(((uint64)pa % SUPERPGSIZE) != 0 || (char*)pa < end || (uint64)pa >= PHYSTOP)
    panic("superfree");

  // Fill with junk to catch dangling refs.
  memset(pa, 1, SUPERPGSIZE);

  r = (struct run*)pa;

  acquire(&supermem.lock);
  r->next = supermem.freelist;
  supermem.freelist = r;
  release(&supermem.lock);
}
```

到这里就完成了对于超级页的初始化以及分配/回收的功能。接下来关注一个进程申请内存的流程：

```c
// kernel/sysproc.c
uint64
sys_sbrk(void)
{
  uint64 addr;
  int t;
  int n;

  argint(0, &n);
  argint(1, &t);
  addr = myproc()->sz;

  if(t == SBRK_EAGER || n < 0) {
    if(growproc(n) < 0) {
      return -1;
    }
  } else {
    // Lazily allocate memory for this process: increase its memory
    // size but don't allocate memory. If the processes uses the
    // memory, vmfault() will allocate it.
    if(addr + n < addr)
      return -1;
    myproc()->sz += n;
  }
  return addr;
}

// kernel/proc.c
int
growproc(int n)
{
  uint64 sz;
  struct proc *p = myproc();

  sz = p->sz;
  if(n > 0){
    if((sz = uvmalloc(p->pagetable, sz, sz + n, PTE_W)) == 0) {
      return -1;
    }
  } else if(n < 0){
    sz = uvmdealloc(p->pagetable, sz, sz + n);
  }
  p->sz = sz;
  return 0;
}

// kernel/vm.c
uint64
uvmalloc(pagetable_t pagetable, uint64 oldsz, uint64 newsz, int xperm)
{
  char *mem;
  uint64 a;

  if (newsz < oldsz)
    return oldsz;

  oldsz = PGROUNDUP(oldsz);
  for (a = oldsz; a < newsz; a += PGSIZE) {
    mem = kalloc();
    if (mem == 0) {
      uvmdealloc(pagetable, a, oldsz);
      return 0;
    }
    memset(mem, 0, PGSIZE);
    if (mappages(pagetable, a, PGSIZE, (uint64)mem, PTE_R | PTE_U | xperm) !=
        0) {
      kfree(mem);
      uvmdealloc(pagetable, a, oldsz);
      return 0;
    }
  }
  return newsz;
}
```

可以看到这是一条 `sbrk() -> growproc() -> uvmalloc()` 的线路，实现申请指定大小的内存并建立映射。

因此我们应当在 `uvmalloc()` 中加入判断：如果当前地址是 2MB 对齐的并且剩余的需求 >= 2MB，就应该分配一个超级页，否则分配一个普通页：

```c
uint64
uvmalloc(pagetable_t pagetable, uint64 oldsz, uint64 newsz, int xperm)
{
  char *mem;
  uint64 a;
  int sz;

  if(newsz < oldsz)
    return oldsz;

  oldsz = PGROUNDUP(oldsz);
  for(a = oldsz; a < newsz; a += sz){
    int superflag = 0;
    if (a % SUPERPGSIZE == 0 && newsz - a >= SUPERPGSIZE) {
      sz = SUPERPGSIZE;
      mem = superalloc();
      superflag = 1;
    } else {
      sz = PGSIZE;
      mem = kalloc();
      superflag = 0;
    }
    if(mem == 0){
      uvmdealloc(pagetable, a, oldsz);
      return 0;
    }
#ifndef LAB_SYSCALL
    memset(mem, 0, sz);
 #endif
    if (superflag) {
      if (mapsuperpages(pagetable, a, sz, (uint64)mem, PTE_R|PTE_U|xperm) != 0) {
        superfree(mem);
        uvmdealloc(pagetable, a, oldsz);
        return 0;
      }
    } else {
      if(mappages(pagetable, a, sz, (uint64)mem, PTE_R|PTE_U|xperm) != 0){
        kfree(mem);
        uvmdealloc(pagetable, a, oldsz);
        return 0;
      }
    }
  }
  return newsz;
}
```

由于超级页的映射方式和普通页不同，需要**由 level 1 页表项直接指向**，因此不能够用 `mappages()` 来建立映射，我们需要为它设计专属的映射函数 `mapsuperpages()`：

```c
int
mapsuperpages(pagetable_t pagetable, uint64 va, uint64 size, uint64 pa, int perm)
{
  uint64 a, last;

  if((va % SUPERPGSIZE) != 0)
    panic("mapsuperpages: va not aligned");

  if((size % SUPERPGSIZE) != 0)
    panic("mapsuperpages: size not aligned");

  if(size == 0)
    panic("mapsuperpages: size");
  
  a = va;
  last = va + size - SUPERPGSIZE;
  for(;;){
    pte_t* pte_l2 = &pagetable[PX(2, a)];
    pagetable_t child;
    pte_t* pte_l1;

    //如果没有level1页表，则申请一个
    if ((*pte_l2 & PTE_V )== 0) {
      child = (pagetable_t)kalloc();
      if (child == 0) {
        printf("mapsuperpages:alloc fail!\n");
        return -1;
      }
      memset(child, 0, PGSIZE);
      *pte_l2 = PA2PTE(child) | PTE_V;
    } else {
        child = (pagetable_t)PTE2PA(*pte_l2);
    }
    pte_l1 = &child[PX(1, a)];  //获得level 1的页表项

    if((*pte_l1 & PTE_V))
      panic("mapsuperpages: remap");
    *pte_l1 = PA2PTE(pa) | perm | PTE_V | PTE_R;
    if(a == last)
      break;
    a += SUPERPGSIZE;
    pa += SUPERPGSIZE;
  }
  return 0;
}
```

这里不能直接用 `walk()`，因为这会拿到 level 0 的页表项，所以需要**手动逐级解析**，拿到 level 1 的页表项。如果没有，就申请一个，最后建立映射，记得要在权限位上加上 `PTE_R`。

这样就实现了在申请大内存时使用超级页的功能。但除此之外，我们还需要实现在 `fork()` 时，如果父进程使用了超级页，则子进程也要使用超级页。

在 `fork()` 时，会使用 `uvmcopy()` 来将父进程的地址空间复制给子进程，因此需要修改它来适配超级页。具体来讲，就是先判断当前页是普通页还是超级页，然后走对应的复制逻辑：

```c
int
uvmcopy(pagetable_t old, pagetable_t new, uint64 sz)
{
  pte_t *pte;
  uint64 pa, i;
  uint flags;
  char *mem;
  int szinc = PGSIZE;

  for(i = 0; i < sz; i += szinc){
    pte_t *pte_l1, *pte_l2;
    
    pte_l2 = &old[PX(2, i)];
    if ((*pte_l2 & PTE_V) == 0) {
      continue; //level2页表项无效
    }
    pagetable_t child = (pagetable_t)PTE2PA(*pte_l2);
    pte_l1 = &child[PX(1,i)];

    if((*pte_l1 & PTE_V) == 0) {
      continue; //level1页表项无效
    }

    if ((*pte_l1 & PTE_R) != 0) {
      //是超级页
      szinc = SUPERPGSIZE;
      pa = PTE2PA(*pte_l1);
      flags = PTE_FLAGS(*pte_l1);
      if ((mem = superalloc()) == 0) 
        goto err;
      memmove(mem, (char*)pa, SUPERPGSIZE);  
      if (mapsuperpages(new, i, SUPERPGSIZE, (uint64)mem, flags) != 0) {
        superfree(mem);
        goto err;
      }
    } else {
      if((pte = walk(old, i, 0)) == 0)
        continue;
      if((*pte & PTE_V) == 0) {
        continue;
      }
      szinc = PGSIZE;
      pa = PTE2PA(*pte);
      flags = PTE_FLAGS(*pte);
      if((mem = kalloc()) == 0)
        goto err;
      memmove(mem, (char*)pa, PGSIZE);
      if(mappages(new, i, PGSIZE, (uint64)mem, flags) != 0){
        kfree(mem);
        goto err;
      }
    }
  }
  return 0;

 err:
  uvmunmap(new, 0, i / PGSIZE, 1);
  return -1;
}
```

Lab 3 中，`walk()` 函数能够识别叶子页表项在 level 1 还是 level 0，但我们最后只能拿到页表项本身，所以还是无法区分它属于哪一级。因此这里需要手动获取 level 1 级的页表项，根据它的**权限位**来判断叶子页表项在哪一级，然后再做对应的复制操作，可以用 `PTE_FLAGS` 来获取权限位。

最后，还需要实现超级页映射的解除。特别是当要解除的大小**不足 2MB** 时，我们要将这个超级页降级为 512 个**普通页面**。

和 `uvmcopy` 一样，我们要手动判断是超级页还是普通页。如果是超级页，还要判断剩余的要解除映射的空间大小是否够 2MB；如果不够，就要先将这 2MB 改为 512 个普通页映射，然后再解除指定的地址映射。

```c
void
uvmunmap(pagetable_t pagetable, uint64 va, uint64 npages, int do_free)
{
  uint64 a;
  pte_t *pte;
  int sz = PGSIZE;

  if((va % PGSIZE) != 0)
    panic("uvmunmap: not aligned");

  for(a = va; a < va + npages*PGSIZE; a += sz){
    sz = PGSIZE;
    pte_t *pte_l1, *pte_l2;
    
    pte_l2 = &pagetable[PX(2, a)];
    if ((*pte_l2 & PTE_V) == 0) {
      continue; //level2页表项无效
    }
    pagetable_t child = (pagetable_t)PTE2PA(*pte_l2);
    pte_l1 = &child[PX(1,a)];

    if((*pte_l1 & PTE_V) == 0) {
      continue; //level1页表项无效
    }

    if ((*pte_l1 & PTE_R) != 0) {
      //叶子在level1，是超级页
      if (va + npages*PGSIZE - a >= SUPERPGSIZE && a % SUPERPGSIZE == 0) {
        //剩余空间能装下一个超级页
        sz = SUPERPGSIZE;
        if (do_free) {
          uint64 pa = PTE2PA(*pte_l1);
          superfree((void *)pa);
        }
        *pte_l1 = 0;
      } else {
        //剩余空间不足，这个超级页将被拆开
        uint64 pa = PTE2PA(*pte_l1);
        uint64 mva =  a & ~(SUPERPGSIZE-1); //要对齐虚拟地址！
        int perm = PTE_FLAGS(*pte_l1);
        *pte_l1 = 0;  //先取权限再进行释放
        //将这2MB空间全部换为普通映射
        mappages(pagetable, mva, SUPERPGSIZE, pa, perm);

        //然后走默认流程
        if((pte = walk(pagetable, a, 0)) == 0) // leaf page table entry allocated?
          continue;
        if((*pte & PTE_V) == 0)  // has physical page been allocated?
          continue;
        sz = PGSIZE;
        if(PTE_FLAGS(*pte) == PTE_V)
          panic("uvmunmap: not a leaf");
        if(do_free){
          uint64 pa = PTE2PA(*pte);
          kfree((void*)pa);
        }
        *pte = 0;
      }
    } else {
      //叶子在level0，走正常逻辑
      if((pte = walk(pagetable, a, 0)) == 0) // leaf page table entry allocated?
        continue;
      if((*pte & PTE_V) == 0)  // has physical page been allocated?
        continue;
      sz = PGSIZE;
      if(PTE_FLAGS(*pte) == PTE_V)
        panic("uvmunmap: not a leaf");
      if(do_free){
        uint64 pa = PTE2PA(*pte);
        kfree((void*)pa);
      }
      *pte = 0;
    }
 }
}
```

在进行降级的时候，要记得**先获取权限**，然后再将页表项设为 0，否则就找不到权限了。

这样就完成了超级页功能的实现，我们可以通过 `pgtbltest` 来进行检验，输出如下，有两个异常属于正常情况。

```bash
superpg_fork starting
usertrap(): unexpected scause 0xf pid=69
            sepc=0x2ec stval=0x5001
superpg_fork: OK
superpg_free starting
usertrap(): unexpected scause 0xd pid=70
            sepc=0x40a stval=0xfff001
superpg_free: OK
pgtbltest: all tests succeeded
```

#### 潜在坑点

在对超级页进行降级的过程中，虚拟地址**未必是 2MB 对齐的**。如果此时直接用 `va` 来开始映射 512 个普通页面，则会映射到这 2MB 虚拟地址之外。

因此我们需要先对虚拟地址进行对齐操作，然后再进行降级映射：

```c
uint64 pa = PTE2PA(*pte_l1);
uint64 mva =  a & ~(SUPERPGSIZE-1); //要对齐虚拟地址！
int perm = PTE_FLAGS(*pte_l1);
*pte_l1 = 0;  //先取权限再进行释放
//superfree((void *)pa);  //不要释放这一页
//将这2MB空间全部换为普通映射
mappages(pagetable, mva, SUPERPGSIZE, pa, perm);
```

此外，在降级时，我一开始认为换成 512 个普通页面后，这个超级页就该被释放并放回空闲队列，但这会导致报错：

```bash
superpg_free starting
pgtbltest: superpg_free failed: lost content after freeing part of super page, pid=3
```

实际上，这里降级的意思是直接将这个 2MB 页面转换为 512 个普通页面，也就意味着超级页的总数**减少一个**，变成 512 个普通页。

如果释放了超级页，但又往该物理地址映射了 512 个普通页面，未来这个超级页**被别的进程使用**时，同样会映射到这片地址，从而导致我们的数据发生冲突与丢失。

当然，理论上也可以释放超级页后不再映射这个物理地址，而是 `kalloc()` 512 个 4KB 页面后再映射，但这样明显会比较麻烦。

---

## 测试方法与结果
使用
```bash
make grade
```
来运行官方测试，这会对**所有任务**进行测试。

以下是我的完整测试结果：
```bash
== Test pgtbltest ==
$ make qemu-gdb
(5.1s)
== Test   pgtbltest: ugetpid ==
  pgtbltest: ugetpid: OK
== Test   pgtbltest: print_kpgtbl ==
  pgtbltest: print_kpgtbl: OK
== Test   pgtbltest: superpg ==
  pgtbltest: superpg: OK
== Test answers-pgtbl.txt ==
answers-pgtbl.txt: OK
== Test usertests ==
$ make qemu-gdb
(57.5s)
== Test time ==
time: OK
Score: 41/41
```

---

## 总结与回顾

在本次实验中，我们首先通过分析一个进程的页表信息，学习了 xv6 中**用户地址空间的结构**，熟悉了**三级页表结构**以及进行**地址翻译**的方法，同时也了解了不同**权限位**的作用。

随后，我们通过共享页面实现了对 `getpid()` 系统调用的优化。这个过程中，我们熟悉了 xv6 中进行内存管理的几个函数以及内存的**分配/回收，申请/释放**的操作流程，同时也认识到了可以通过修改内存管理的各种机制来实现**性能的优化**。

然后，我们又动手实现了打印一个进程页表详细信息的函数，练习了对**三级页表结构的解析**，进一步加深了理解，同时结果也巧妙地与第二题中我们新加入的页面产生了联系。

最后，我们迎来了第一个 hard 难度的任务，在 xv6 系统的原有基础上实现**超级页**功能，建立了对整个内存管理机制更全面的认知。


---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
