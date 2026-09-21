---
title: MIT 6.1810 Lab 5:Copy-on-Write
date: 2026-09-21 10:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab5 全记录，主题是写时复制计数
---
# MIT 6.1810 Lab 5: Copy-on-Write Fork for xv6

---

## 实验概览

Lab 5 的主题是**写时复制（COW）**，这一技术被广泛应用于现代操作系统之中。它能够在**父进程和子进程之间共享内存**，从而减少内存占用并提升性能。

在本实验中，我们会亲手在 xv6 中实现写时复制功能，在深入了解这个技术的同时，也能回顾之前学过的内存管理、陷入等内容。

在完成本实验前，可以先阅读 [xv6 book](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf) 的第 5 章，这里会详细地介绍 xv6 中的页错误（Page Fault）机制，其中就包含了写时复制的内容。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Implement copy-on-write fork (hard)

#### 需求分析

##### 什么是写时复制（Copy-on-Write, COW）

在 xv6 中，`fork()` 系统调用会将父进程的内存**完全复制**到子进程中，这首先要为子进程分配同样大小的内存空间，随后还要将父进程的内存信息复制到子进程中，时间和空间开销都非常大。

不仅如此，子进程运行时往往**只会用到全部页面中的一小部分**，这导致剩下页面的时间和空间开销都被浪费了。

更为要命的是，`fork()` 往往和 `exec()` 搭配使用，我们刚把所有内存复制过来，马上就要被新的程序**完全替代**，这会严重影响性能。

为了解决这样的问题，现代操作系统引入了**写时复制（Copy-on-Write, COW）**技术。从名字中可以看出，它的核心思想是在 `fork()` 时先不进行内存复制，而是在**写入时才复制**，其余页面都由父子进程**共享**，这样就能节约大量的时间和空间开销。

其实现原理是：在 `fork()` 时，父子进程的内存页都被标记为**只读**，当父子进程中的任意一个尝试写入该页时，就会触发**页错误（Page Fault）**，操作系统会在页错误处理函数中为该进程分配新的内存页，并将原来的内容复制到新的内存页中，然后将该页标记为可写。

这样就能实现**按需复制**，提升系统的性能。

##### 实验目标

本 Lab 中只有这一个任务，那就是在 xv6 中实现写时复制功能。

具体来说，我们要修改内核代码，使得 `fork()` 时不进行复制，而是让父子进程共享内存页。同时还要修改**页错误处理函数**，使其能够识别并处理写时复制导致的页错误。此外，由于写时复制涉及内存页共享，我们还要修改内存页的释放函数，使其能够正确释放共享的内存页。

#### 详细实现

首先要做一些准备工作。写时复制的实现依赖于**页错误（Page Fault）**机制，我们必须能够识别这一页究竟是本来就不可写，还是因为写时复制而不可写。为此，我们需要在页表项的权限位中新增一个**写时复制位（PTE_COW）**，来标记该页属于写时复制页。

在 Lab 3 中我们了解到，xv6 中的页表项权限位共有 10 位，其中高两位作为**保留位**用作扩展，因此可以将其中一位作为写时复制位，并利用宏进行定义：

```c
// kernel/riscv.h
#define PTE_COW (1L << 8)
```

此外，写时复制还涉及父子进程的页面共享，这代表同一个物理页可能**被多个进程所引用**。我们必须保证只有在最后一个引用该页的进程退出时，才释放该页的物理内存，否则就会导致其他进程**访问到已经被释放的内存页**。

根据官方提示，我们可以维护一个全局数组来表示每个物理页的引用数量，数组的下标就是物理页的编号（物理地址 / 页大小），数组的值就是该页的引用数量。

```c
// kernel/kalloc.c
uint64 reference[(PHYSTOP - KERNBASE) / PGSIZE];
```

在 Lab 3 中我们还了解到，用户能使用的物理内存范围是从 `KERNBASE` 到 `PHYSTOP`，因此可以通过计算物理页的数量来确定数组的大小。

此外，测试中会通过大量 `fork()` 生成大量进程，形成对 `reference` 的并发访问，因此还需要一个锁来保护对 `reference` 的访问。

```c
// kernel/kalloc.c
struct spinlock referlock;
```

接下来，根据官方提示梳理 `reference` 的更新逻辑：

- 调用 `kalloc()` 分配物理页时，这一页会被一个进程引用，因此我们要将其初值设为 1。
- 调用 `fork()` 进行页面共享时，我们要将该页的引用数量加 1。
- 调用 `kfree()` 释放物理页时，我们先将引用数减 1，并且只有在引用数为 0 时才释放这一页，**否则直接返回**。

注意，在内存初始化过程中，会对所有的空闲物理页调用一遍 `kfree()`，因此要在这之前将 `reference` 数组的对应元素初始化为 1，来应对 `kfree()` 中引用数减 1 的操作。同时，我们也要在此处初始化锁 `referlock`。

```c
// kernel/kalloc.c
void
kinit()
{
  initlock(&referlock, "referlock");    // 初始化锁
  initlock(&kmem.lock, "kmem");
  freerange(end, (void*)PHYSTOP);
}

void
freerange(void *pa_start, void *pa_end)
{
  char *p;
  p = (char*)PGROUNDUP((uint64)pa_start);
  for(; p + PGSIZE <= (char*)pa_end; p += PGSIZE) {
    reference[PHYSNUM((uint64)p)] = 1; // 为后面 kfree 做准备
    kfree(p);
  }
}
```

随后，我们要修改 `kalloc()` 和 `kfree()` 函数来实现对 `reference` 的更新逻辑，注意所有 `reference` 的更新与访问都要被锁包围。

```c
// kernel/kalloc.c kfree()
if ((uint64) pa >= KERNBASE && (uint64) pa < PHYSTOP) {
    acquire(&referlock);
    reference[PHYSNUM((uint64) pa)]--; // 释放时引用数减 1
    if (reference[PHYSNUM((uint64) pa)] > 0) {
        release(&referlock);
        return;
    }
    release(&referlock);
}

// kernel/kalloc.c kalloc()
if(r) {
    memset((char*)r, 5, PGSIZE); // fill with junk

    acquire(&referlock);
    if ((uint64)r >= KERNBASE && (uint64)r < PHYSTOP) {
        reference[PHYSNUM((uint64)r)] = 1; // 新申请的页引用置 1
    } 
    release(&referlock);
}
```

做完准备工作后，就可以实现写时复制的核心功能了。

首先需要修改 `kernel/vm.c` 中的 `uvmcopy()` 函数。它用来在 `fork()` 时将父进程内存复制给子进程，我们需要**删掉其中的复制操作，并且将页面标记为只读，建立共享页面**。

通过删除 `kalloc()` 和 `memmove()` 的调用（注释掉的那几行），就可以防止在 `fork()` 中为子进程分配内存并进行复制。

随后，我们需要找出父进程中**可写权限（PTE_W）有效**的页表项并进行修改，删去其**可写权限（PTE_W）**，并且将**写时复制位（PTE_COW）**设置为 1。这样父进程下次写入时就会触发页错误，并能通过 `PTE_COW` 来识别这是一个写时复制的页错误。

最后调用 `mappages()` 将子进程的页表项映射到父进程的物理页上，并且传入修改后的权限，这样父子进程就能**共享**这一页。同时，将这一页的引用加 1，记得要用锁包围住。

```c
// kernel/vm.c
int
uvmcopy(pagetable_t old, pagetable_t new, uint64 sz)
{
  pte_t *pte;
  uint64 pa, i;
  uint flags;
  //char *mem;

  for(i = 0; i < sz; i += PGSIZE){
    if((pte = walk(old, i, 0)) == 0)
      continue;   // page table entry hasn't been allocated
    if((*pte & PTE_V) == 0)
      continue;   // physical page hasn't been allocated
    pa = PTE2PA(*pte);

    if ((*pte & PTE_W) != 0) {
      // 如果原来可写，则将可写位置 0，写时复制位置为 1
      *pte = *pte & ~PTE_W;
      *pte = *pte | PTE_COW;
    }
    flags = PTE_FLAGS(*pte);
    //if((mem = kalloc()) == 0)
    //  goto err;
    //memmove(mem, (char*)pa, PGSIZE);
    if(mappages(new, i, PGSIZE, pa, flags) != 0){ // 映射到原来的物理地址
      //kfree(mem);
      goto err;
    }
    acquire(&referlock);
    reference[PHYSNUM(pa)]++; // 共享时增加引用数量
    release(&referlock);
  }
  return 0;

 err:
  uvmunmap(new, 0, i / PGSIZE, 1);
  return -1;
}
```

这里我在 `kernel/memlayout.h` 中定义了一个宏，用来根据物理地址计算其在 `reference` 数组中的下标。

```c
// kernel/memlayout.h
#define PHYSNUM(pa) ((pa - KERNBASE) / PGSIZE)
```

当然，不要忘了用 `extern` 将 `reference` 和 `referlock` 引入到 `kernel/vm.c` 中。

```c
// kernel/vm.c
extern uint64 reference[];
extern struct spinlock referlock;
```

发生页错误时，内核在 `kernel/trap.c` 中的 `usertrap()` 函数中调用 `vmfault()` 来处理页错误：

```c
// kernel/trap.c usertrap()
else if((r_scause() == 15 || r_scause() == 13) &&
        vmfault(p->pagetable, r_stval(), (r_scause() == 13)? 1 : 0) != 0) {
// page fault on lazily-allocated page
        }
```

为了实现写时复制，我们需要修改 `vmfault()` 函数来识别写时复制的页错误，并进行处理。

原始的 `vmfault()` 只用来处理**懒分配页错误**，即虚拟地址没有映射到物理页的情况。因此，我们可以根据**页表项映射有效以及 `PTE_COW` 位**来判断是否是写时复制的页错误。

随后，我们要为这一进程分配一个新的物理页，将原来页的内容复制过来，解除原有映射，并将页表项重新映射到新的物理页上。同时，将 `PTE_COW` 置为 0、`PTE_W` 置为 1，这样就实现了写时复制功能：

```c
// kernel/vm.c vmfault()
// 这一部分要写在 va 的处理之后
pte_t *pte = walk(pagetable, va, 0);

if (pte != 0 && (*pte & PTE_COW) != 0 && (*pte & PTE_V) != 0 && read == 0) {
    // 当前正在写入写时复制页面
    mem = (uint64) kalloc();
    if (mem == 0) {
        setkilled(p);  // 如果没有可用内存就杀掉进程
        return 0;
    }
    memset((void *) mem, 0, PGSIZE);
    uint64 pa = PTE2PA(*pte);
    memmove((char *)mem,(char *) pa, PGSIZE); // 复制
    uint64 perm = PTE_FLAGS(*pte);
    perm = perm | PTE_W;
    perm = perm & ~PTE_COW; // 增加写权限，去掉写时复制
    uvmunmap(pagetable, va, 1, 1);  // do_free 设为 1
    if (mappages(pagetable, va, PGSIZE, mem, perm) != 0) {
        kfree((void *) mem);
        setkilled(p);
        return 0;
    }
    return mem;
}
```

这里 `uvmunmap()` 的 `do_free` 参数设为 1，如果是最后一个引用页就会正常释放，如果不是就更新 `reference`。

根据官方提示，当触发写时复制但内存不够时，**直接杀死进程**。

除了在 `vmfault()` 中处理写时复制以外，官方还提示我们要在 `copyout()` 中加入类似的代码。

这是因为 `copyout()` 中获取物理地址用的是 `walkaddr()`，它不检查 `PTE_W` 位，但后续处理中如果页表项的 `PTE_W` 为 0 会直接返回 -1。显然，写时复制对于 `PTE_W` 的置 0 影响到了原有逻辑，因此需要在 `copyout()` 中加入类似的代码来处理写时复制的页错误。

```c
int
copyout(pagetable_t pagetable, uint64 dstva, char *src, uint64 len)
{
  uint64 n, va0, pa0;
  pte_t *pte;

  while(len > 0){
    va0 = PGROUNDDOWN(dstva);
    if(va0 >= MAXVA)
      return -1;
  
    pa0 = walkaddr(pagetable, va0);
    if(pa0 == 0) {
      if((pa0 = vmfault(pagetable, va0, 0)) == 0) {
        return -1;
      }
    }

    pte = walk(pagetable, va0, 0);
    // forbid copyout over read-only user text pages.
    if((*pte & PTE_W) == 0) {
      if ((*pte & PTE_COW) != 0) {
        // 这一页是写时复制页
        uint64 mem = (uint64)kalloc();
        if (mem == 0) {
          return -1;
        }
        memset((void *) mem, 0, PGSIZE);
        uint64 pa = PTE2PA(*pte);
        memmove((char *)mem,(char *) pa, PGSIZE); // 复制
        uint64 perm = PTE_FLAGS(*pte);
        perm = perm | PTE_W;
        perm = perm & ~PTE_COW; // 增加写权限，去掉写时复制
        uvmunmap(pagetable, va0, 1, 1);  // do_free 设为 1
        if (mappages(pagetable, va0, PGSIZE, mem, perm) != 0) {
          kfree((void *) mem);
          return -1;
        }
        pa0 = (uint64)mem;
      } else {
        return -1;
      }
    }
      
    n = PGSIZE - (dstva - va0);
    if(n > len)
      n = len;
    memmove((void *)(pa0 + (dstva - va0)), src, n);

    len -= n;
    src += n;
    dstva = va0 + PGSIZE;
  }
  return 0;
}
```

到此，我们便成功在 xv6 中实现了写时复制功能。可以运行 `cowtest` 程序来进行测试，输出结果如下：

```bash
simple: ok
simple: ok
three: ok
three: ok
three: ok
file: ok
forkfork: ok
ALL COW TESTS PASSED
```

我们还要运行 `usertests -q` 来验证新增功能是否影响了原有功能，看到以下字样就表示通过：

```bash
ALL TESTS PASSED
```

#### 潜在坑点

##### (1) `reference` 的并发访问

之前的 Lab 几乎不涉及锁的使用，唯一涉及的地方是 Lab 3 中的超级页，而且是直接仿照原有实现即可，因此一开始没有意识到 `reference` 的**并发访问**问题，在排查后才找出了问题所在。

发生并发访问的情景主要是在 `forkforktest` 中：

```c
//
// try to expose races in page reference counting.
//
void
forkforktest()
{
  printf("forkfork: ");

  int sz = 256 * 4096;
  char *p = sbrk(sz);
  memset(p, 27, sz);

  int children = 3;

  for(int iter = 0; iter < 100; iter++){
    for(int nc = 0; nc < children; nc++){
      if(fork() == 0){
        pause(2);
        fork();
        fork();
        exit(0);
      }
    }

    for(int nc = 0; nc < children; nc++){
      int st;
      wait(&st);
    }
  }

  pause(5);
  for(int i = 0; i < sz; i += 4096){
    if(p[i] != 27){
      printf("error: parent's memory was modified!\n");
      exit(1);
    }
  }

  printf("ok\n");
}
```

可以看到在循环中，一个父进程会进行大量 `fork()`，最后可以有 13 个进程同时存在，并且会重复 100 次，从而形成大量并发访问，导致 `reference` 的更新出现问题。

其实一开始没有加锁时，也是有概率能通过测试的，但这显然不是一个正确的实现。

##### (2) 理清 `reference` 的更新逻辑

最初我没有按照官方提示的逻辑来更新 `reference`，我理解的是 `reference` 实际上就是这个物理页被虚拟页映射的个数，而进行虚拟地址与物理地址映射/解除映射的是 `mappages()` 和 `uvmunmap()`，因此我将 `reference` 的更新逻辑放在了这两个函数中，认为 `kfree()` 中只需检查 `reference` 是否为 0 即可。

但是实际上，我们要实现的写时复制针对的是**用户空间的内存页引用数**，而 `mappages()` 和 `uvmunmap()` 这两个函数是用户页和内核页共享的。

具体来讲，在 xv6 启动时，会调用 `kvminit()` 来初始化内核页表，进而调用 `kvmmake()`，在这里面有这样两行代码：

```c
// kernel/vm.c kvmmake()
  // map kernel text executable and read-only.
  kvmmap(kpgtbl, KERNBASE, KERNBASE, (uint64)etext-KERNBASE, PTE_R | PTE_X);

  // map kernel data and the physical RAM we'll make use of.
  kvmmap(kpgtbl, (uint64)etext, (uint64)etext, PHYSTOP-(uint64)etext, PTE_R | PTE_W);
```

这里会调用 `kvmmap()` 来将 `KERNBASE - PHYSTOP` 的内存映射到内核页表中，而在 `kvmmap()` 中会调用 `mappages()`，这就会导致所有物理页的 `reference` 都被加 1，而这次映射**永远不会**有对应的 `uvmunmap()` 来解除映射，从而导致 `reference` 的值出现问题。

---

## 测试方法与结果
使用：

```bash
make grade
```
来运行官方测试，这将会对**所有任务**进行测试。

以下是我的完整测试结果：

```bash
== Test running cowtest ==
$ make qemu-gdb
(29.8s)
== Test   simple ==
  simple: OK
== Test   three ==
  three: OK
== Test   file ==
  file: OK
== Test   forkfork ==
  forkfork: OK
== Test usertests ==
$ make qemu-gdb
(65.6s)
== Test   usertests: copyin ==
  usertests: copyin: OK
== Test   usertests: copyout ==
  usertests: copyout: OK
== Test   usertests: all tests ==
  usertests: all tests: OK
== Test time ==
time: OK
Score: 130/130
```

---

## 总结与回顾

在本次实验中，我们亲手在 xv6 中实现了**写时复制**功能。通过在 `fork()` 过程中共享内存页，并在写入时才进行复制，我们成功减少了内存占用并提升了性能。

实验的核心价值不仅在于学习这个应用广泛的技术本身，更在于它是对之前学过的内存管理、页错误机制的一个**综合应用**，让我们在实践中对 xv6 内核以及操作系统的基本原理有了更深入的理解。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
