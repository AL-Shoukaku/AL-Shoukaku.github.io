---
title: MIT 6.1810 Lab 9:mmap
date: 2026-10-17 17:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab9 全记录，主题是 mmap
---
# MIT 6.1810 Lab 9: mmap

---

## 实验概览

本次实验的主题是在 xv6 中**实现 `mmap()`、`munmap()` 系统调用**。

`mmap()` 负责**将指定文件映射到当前进程的地址空间中**，使得进程可以直接访问文件内容，而无需通过 `read()` 和 `write()` 系统调用进行数据传输；`munmap()` 负责**解除映射关系**，释放相关资源。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. mmap (hard)

#### 需求分析

在本实验中，我们需要实现 `mmap()` 和 `munmap()` 两个系统调用。

`mmap(void *addr, uint64 len, int prot, int flags, int fd, uint64 offset)` 的核心功能是**将文件 `fd` 映射到当前进程的地址空间中**，并返回映射的起始地址。

- `offset` 为文件中开始映射的偏移量，在本题中默认为 0。`len` 为映射的字节数，**不要求与文件大小相同**。
- `prot` 为映射区域的权限，支持 `PROT_NONE`、`PROT_READ`、`PROT_WRITE`、`PROT_EXEC`，分别代表**无权限、可读、可写、可执行**，可以组合使用。
- `flags` 为映射区域的类型，支持 `MAP_SHARED`、`MAP_PRIVATE`。前者为共享模式，在对映射区域进行修改后，会在 `munmap()` 或退出时**将修改写回文件**；后者为私有模式，不会写回文件，并允许进程写入私有映射页，因为这些修改不会被写回文件。
- `addr` 默认为 0，内核需要自行决定将该文件映射到哪一个虚拟地址，并且**返回该地址**。
- 该调用会将对应文件的引用次数增加 1 以防止文件被关闭。

`munmap(void *addr, uint64 len)` 负责解除 `mmap()` 建立的映射关系。

- `addr` 为开始解除的地址，`len` 为解除的字节数。
- 可以一次解除整个区域，也可以解除部分区域。
- 如果是解除整个区域，则会将对应文件的引用次数减少一次。
- 如果是解除部分区域，要求要么从头开始解除，要么一直解除到尾部，**禁止在中间解除映射**。

此外，要求 `mmap()` 映射的区域为**懒加载**，即在访问该区域时才会将对应的文件内容加载到内存中。

当进行 `fork()` 时，要求子进程继承父进程的 `mmap()` 映射关系。

当进程退出时（`exit()`），要求释放所有 `mmap()` 映射的区域。

#### 实现思路

本实验要实现的功能比较复杂，所幸 hint 中给了大致的框架。

首先，我们应当把 `mmaptest` 加入 `Makefile` 中，然后搭建起两个系统调用的框架。具体方法在前面的 lab 已经用过很多次了，暂时让它们直接返回 -1，过编译即可。

接着梳理一下整体思路。我们需要在 `struct proc` 中增加新的数据结构，用来**记录 `mmap()` 映射的区域信息**，官方将其称为 VMA（virtual memory area）。随后实现 `sys_mmap()` 来选出一个空闲 VMA 并记录映射区域的信息，修改 `vmfault()` 的页错误处理方式以支持 `mmap()` 映射区域的懒加载，再实现 `sys_munmap()` 的解除映射逻辑，最后修改 `kfork()` 和 `kexit()` 来支持 `mmap()` 映射区域的继承和释放。

首先准备好要用到的数据结构 `struct VMA`，它需要包含 `mmap()` 映射区域的起始地址、长度、权限、类型、偏移量和文件信息，我还加上了一个 `valid` 字段来标记该 VMA 是否有效：

```c
// kernel/proc.h
struct VMA {
  int valid;
  uint64 addr;
  uint64 length;
  int prot;
  int flag;
  uint64 offset;
  struct file *file;
};
```

接下来我们把 VMA 数组加入到 `struct proc` 中，官方给的 hint 中建议使用 16 个 VMA。

此外，`mmap()` 必须自行决定映射到的虚拟地址，显然不能随机决定，**需要一片固定的区域**。

我在这里选择了从 `TRAPFRAME` 向下进行生长，这样既能映射到固定的地址，也能避免与其他虚拟地址冲突。

因此，我们需要在 `struct proc` 中增加一个 `vma_sz` 来记录当前向下生长到了哪个地址。这个名字来自已有的 `sz` 字段，源自于我一开始的设计错误，将在后面展开。

```c
// kernel/proc.h
struct proc {
  // ...
  struct VMA vma[NVMA];
  uint64 vma_sz;
};
```

随后我们在 `kernel/proc.c` 的 `allocproc()` 中对这些字段进行初始化：VMA 清零，`vma_sz` 初始化为 `TRAPFRAME`。

```c
// kernel/proc.c allocproc()
for (int i = 0;i < NVMA;i++) {
  memset(&p->vma[i], 0, sizeof(struct VMA));
}
p->vma_sz = TRAPFRAME;  // 自顶向下生长
```

准备完毕后，就可以开始实现 `sys_mmap()` 了。它的核心逻辑是从当前进程里找出一个空闲 VMA，并根据参数设置好映射区域的信息。此外，还需要检查**权限 `prot` 的合法性**，判断依据是：`WRONLY` 文件不能映射为 `PROT_READ`，`RDONLY` 且非 `MAP_PRIVATE` 模式的文件不能映射为 `PROT_WRITE`，否则返回 -1。

计算 `vma_sz` 向下生长的大小时采用 `PGROUNDUP(len)`，即向上取整到页大小。

参考 `sys_open()`，我们可以用 `argfd()` 来将文件描述符参数转换为 `struct file *`，最后还要记得调用 `filedup()` 增加文件的引用次数。

```c
uint64
sys_mmap(void) {
  uint64 addr;
  int len;
  int prot;
  int flags;
  struct file* f;
  int offset;
  
  argaddr(0, &addr);
  argint(1, &len);
  argint(2, &prot);
  argint(3, &flags);
  if (argfd(4, 0, &f) < 0) {
    return -1;
  }
  argint(5, &offset);

  if ((f->readable == 0 && (prot & PROT_READ)) || (f->writable == 0 && (prot & PROT_WRITE) && !(flags & MAP_PRIVATE))) {
    // 权限不对
    return -1;
  }

  struct proc *p = myproc();
  struct VMA *vma = 0;

  for (int i = 0;i < NVMA;i++) {
    if (p->vma[i].valid == 0) {
      vma = &p->vma[i];
    }
  }
  if (vma == 0)
    return -1;

  vma->valid = 1;
  vma->length = len;
  vma->prot = prot;
  vma->flag = flags;
  vma->file = f;
  vma->offset = offset;
  // 自顶向下生长
  p->vma_sz -= PGROUNDUP(len);
  vma->addr = p->vma_sz;

  filedup(f);

  return vma->addr;
}
```

当前我们只是在 VMA 中记录了映射区域的信息，并没有真正为其分配物理页。这里要采用**懒分配**的形式，即**第一次**访问该区域时通过页错误来调用 `vmfault()` 为其分配物理页。因此，我们要修改页错误处理函数，让它支持 `mmap()` 映射区域的懒加载。

首先，我们在最开始就要遍历 `vma` 数组，判断当前地址**是否落在某个 VMA 区间内**，如果命中则将其记录下来。这是为了防止和原有 `va >= p->sz` 的判断冲突，**如果命中 VMA，则不受 `sz` 限制**。

在申请完物理页后，如果之前命中了 VMA，则需要将该地址对应的文件内容读入到物理页中，并根据 `prot` 设置好权限。

读入的方法是调用 `readi(struct inode *ip, int user_dst, uint64 dst, uint off, uint n)`。它可以从指定 inode 文件中的 `off` 偏移量开始，读取 `n` 字节到 `dst` 地址中；`user_dst` 为 0 表示 `dst` 是内核地址，否则是用户地址。

```c
// kernel/vm.c
uint64
vmfault(pagetable_t pagetable, uint64 va, int read)
{
  uint64 mem;
  struct proc *p = myproc();
  struct VMA *vma = 0;
  for (int i = 0;i < NVMA;i++) {
    if (p->vma[i].valid && p->vma[i].addr <= va && va < (p->vma[i].addr + p->vma[i].length)) {
      // 命中 vma
      vma = &p->vma[i];
      break;
    }
  }

  // 修改：大于 sz 且不属于 vma 的区域
  if (va >= p->sz && vma == 0) 
    return 0;
  va = PGROUNDDOWN(va);
  if(ismapped(pagetable, va)) {
    return 0;
  }
  mem = (uint64) kalloc();
  if(mem == 0)
    return 0;
  memset((void *) mem, 0, PGSIZE);
  int perm = PTE_W|PTE_U|PTE_R;
  if (vma != 0) {
    struct inode *ip = vma->file->ip;
    ilock(ip);
    readi(ip, 0, mem, va - vma->addr + vma->offset, PGSIZE);
    iunlock(ip);
    perm = PTE_U;
    if (vma->prot & PROT_READ) 
      perm |= PTE_R;
    if (vma->prot & PROT_WRITE)
      perm |= PTE_W;
    if (vma->prot & PROT_EXEC)
      perm |= PTE_X;
  }

  if (mappages(p->pagetable, va, PGSIZE, mem, perm) != 0) {
    kfree((void *)mem);
    return 0;
  }
  return mem;
}
```

接下来可以开始实现 `sys_munmap()` 的逻辑了。它的核心功能就是**解除 `mmap()` 建立的映射关系**。

首先，我们要遍历 `vma` 数组，找到地址 `addr` 对应的 VMA。如果该 VMA 的模式是 `MAP_SHARED`，就需要将其**写回文件**中。官方提示指出不需要考虑 `PTE_D` 这一位，把未修改的页写回也是合理的。

注意，写回时需要判断映射是否有效，映射无效的页不在内存中，无法写回。此外，传入的 `len` 参数可能比文件还长，因此需要进行截断。

处理完写回文件后，还需要调用 `uvmunmap()` 来解除映射关系。注意这里的 `do_free` 参数要设置为 1，表示**释放物理页**。

最后，我们要根据参数 `addr`、`len` 以及 VMA 的 `addr`、`length` 来判断是**解除整个区域**，还是**从头部解除**，还是**从尾部解除**，从而采取合适的更新逻辑。

- **全部解除：** 用 `fileclose()` 减少文件引用（减少为 0 时自动关闭），并将 VMA 清零。
- **头部解除：** 将 VMA 的起始地址和偏移量增加 `len`，长度减少 `len`。
- **尾部解除：** 将 VMA 的长度减少 `len`。

```c
uint64
sys_munmap(void) {
  uint64 addr;
  int len;
  argaddr(0, &addr);
  argint(1, &len);

  struct proc *p = myproc();
  for (int i = 0;i < NVMA;i++) {
    if (addr >= p->vma[i].addr && addr + len <= (p->vma[i].addr + p->vma[i].length)) {
      if (p->vma[i].flag == MAP_SHARED) {
        struct inode *ip = p->vma[i].file->ip;
        begin_op();
        ilock(ip);
        // 不能写出文件的范围
        int newlen = len;
        if (len > ip->size - (p->vma[i].offset + addr - p->vma[i].addr)) {
          newlen = ip->size - (p->vma[i].offset + addr - p->vma[i].addr);
        }
        for (int j = 0;j < newlen; j += BSIZE) {
          uint64 newaddr = addr + j;
          pte_t *pte = walk(p->pagetable, newaddr, 0);
          if (*pte & PTE_V) {
            writei(ip, 1, newaddr, p->vma[i].offset + newaddr - p->vma[i].addr, BSIZE);
          }
        }

        iunlock(ip);
        end_op();
      }
      uvmunmap(p->pagetable, PGROUNDDOWN(addr), len / PGSIZE, 1);
      if (addr == p->vma[i].addr && len == p->vma[i].length) {
        fileclose(p->vma[i].file);
        memset(&p->vma[i], 0, sizeof(struct VMA));
      } else if (addr == p->vma[i].addr) {
        // 从头部开始
        p->vma[i].addr += len;
        p->vma[i].offset += len;
        p->vma[i].length -= len;
      } else if (addr + len == p->vma[i].addr + p->vma[i].length) {
        // 从尾部开始
        p->vma[i].length -= len;
      } else {
        return -1;
      }
      return 0;
    }
  }
  return -1;
}
```

最后还剩下 `fork()` 和 `exit()` 对于 `mmap()` 映射区域的适配。

`fork()` 需要支持将父进程的 `mmap()` 映射关系继承给子进程，直接在 `kfork()` 中将父进程的 `vma` 数组和 `vma_sz` 复制给子进程即可，记得要**增加文件的引用数**。

`exit()` 中需要实现对所有 `mmap()` 映射的解除，以及 `MAP_SHARED` 模式下的写回文件操作，实现方式与 `munmap()` 相同。

```c
// kernel/proc.c kfork()
for (int i = 0;i < NVMA;i++) {
  if (p->vma[i].valid) {
    np->vma[i] = p->vma[i];
    filedup(p->vma[i].file);
  }
}
np->vma_sz = p->vma_sz;

// kernel/proc.c kexit()
for (int i = 0;i < NVMA;i++) {
  if (p->vma[i].valid) {
    if (p->vma[i].flag == MAP_SHARED) {
      struct inode *ip = p->vma[i].file->ip;
      begin_op();
      ilock(ip);
      int len = p->vma[i].length;
      if (p->vma[i].length > ip->size - p->vma[i].offset)
        len = ip->size - p->vma[i].offset;
      for (int j = 0; j < len; j += BSIZE){
        uint64 addr = p->vma[i].addr + j;
        pte_t *pte = walk(p->pagetable, addr, 0);
        if (pte != 0 && (*pte & PTE_V)) {
          writei(ip, 1, addr, p->vma[i].offset + j, BSIZE);
        }
      }
      iunlock(ip);
      end_op();
    }
    uvmunmap(p->pagetable, PGROUNDDOWN(p->vma[i].addr), p->vma[i].length / PGSIZE, 1);
    fileclose(p->vma[i].file);
    memset(&p->vma[i], 0, sizeof(struct VMA));
  }
}
```

到此我们就完成了 `mmap()` 和 `munmap()` 的全部实现。

#### 测试方法

在 xv6 中运行 `mmaptest` 进行测试，正确的输出结果如下：

```bash
test basic mmap
test basic mmap: OK
test mmap private
test mmap private: OK
test mmap read-only
test mmap read-only: OK
test mmap read/write
test mmap read/write: OK
test mmap dirty
test mmap dirty: OK
test not-mapped unmap
test not-mapped unmap: OK
test lazy access
test lazy access: OK
test mmap two files
test mmap two files: OK
test fork
test fork: OK
test munmap prevents access
usertrap(): unexpected scause 0xd pid=5
            sepc=0xa2a stval=0x3ffffee000
usertrap(): unexpected scause 0xd pid=6
            sepc=0xab2 stval=0x3ffffed000
test munmap prevents access: OK
test writes to read-only mapped memory
usertrap(): unexpected scause 0xf pid=7
            sepc=0xbfa stval=0x3fffffc000
test writes to read-only mapped memory: OK
mmaptest: all tests succeeded
```

#### 潜在坑点

##### 写回文件时只处理页表项有效的页面

在 `munmap()` 和 `exit()` 中，对于类型为 `MAP_SHARED` 的映射区域，我们需要将其写回文件中。但不能直接调用 `writei()` 进行写回。

这是因为调用 `writei()` 之前需要获取文件 inode 的锁，而如果对应的地址页表项无效，会发生页错误并调用 `vmfault()`。`vmfault()` 在将文件内容载入到内存中时，**也需要获取文件 inode 的锁**，这就会导致**死锁**。

因此，我们应当逐页或逐块进行写回，并加入对于页表项是否有效的检查。

##### 写回文件时需要对过长的 `len` 进行截断

在官方测试中，`mmap()` 和 `munmap()` 中的 **`len` 参数都可能比文件长**。如果 `mmap()` 的 `len` 过长，最多只是浪费一些内存，问题不大。但如果 `munmap()` 的 `len` 过长，则会直接导致测试失败。

其原因就是在调用 `writei()` 时，我们会传入 `len` 参数。如果该参数超过了文件的末尾，`writei()` 会**直接扩大文件的大小 `inode->size`**。

这样一来，在测试中调用 `read()` 时，由于文件变大，返回的**读取长度就会超过预期**，导致测试失败。

所以在写回时需要加入对于 `len` 的截断，确保不会超过文件的大小。

##### `mmap()` 映射区域地址的选取

最开始在设计 `mmap()` 映射的虚拟地址时，我想到了 **`sbrk()`** 中对于进程 `p->sz` 字段的操作。它会直接**将 `p->sz` 增加指定大小但不申请物理页面**，而 `vmfault()` 中通过 `p->sz` 来判断该虚拟地址是属于 `sbrk()` 申请的部分还是越界的部分，这样就实现了**懒加载**。

由于 `mmap()` 映射区域也需要实现懒加载，因此我一开始想的是**直接利用 `p->sz` 作为映射起始地址**，并将其加大 `len` 来实现懒加载。

但这样的实现方式在遇到 `mmaptest` 中的以下测试代码时就会出问题：

```c
printf("test munmap prevents access\n");

makefile(f);
if ((fd = open(f, O_RDWR)) == -1)
    err("open");
p = mmap(0, PGSIZE*2, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
if (p == MAP_FAILED)
    err("mmap");
close(fd);

*p = 'X';
*(p+PGSIZE) = 'Y';

pid = fork();
if(pid < 0) err("fork");
if(pid == 0){
    *p = 'a';
    *(p+PGSIZE) = 'b';
    if(munmap(p+PGSIZE, PGSIZE) == -1)
        err("munmap");
    // this should cause a fatal fault
    printf("*(p+PGSIZE) = %x\n", *(p+PGSIZE));
    exit(0);
}
int st = 0;
wait(&st);
if(st != -1)
    err("child #1 read unmapped memory");
```

可以看到，它首先用 `mmap()` 映射了两页的内存，然后 `fork()` 一个子进程。在子进程中会用 `munmap()` 解除映射**第二页**，随后**访问该页的内存**。

因为该页已经用 `munmap()` 解除映射了，所以访问该页的内存会触发页错误，从而导致子进程**异常退出**。父进程通过 `wait()` 获取异常退出码 `st`，从而通过这部分测试。

然而由于 `mmap()` 中的映射区域是 `p->sz` 到 `p->sz + len`，这个过程中增大了 `p->sz`，但 `vmfault()` 中正是**凭借 `va >= p->sz` 来判断该虚拟地址是否越界**的。

这样一来，虽然进行了 `munmap()`，但 `vmfault()` 中判断 `va < p->sz` 仍然成立，因此**不会触发页错误**，而是为该虚拟地址分配物理页并映射，导致子进程成功访问该地址并正常退出。父进程收到正常退出码 0，从而测试失败。

如果想通过在 `munmap()` 时**同步缩小 `p->sz` 来解决**，这显然相当麻烦。如果解除的不是尾部的区域，需要对其他映射区域进行重新排布，基本无法实现。

如果想不用 `sbrk()` 的 `p->sz`，而是通过为 VMA 映射区域单独维护一个 `sz` 来解决，但这同样是自低向上生长的，**会和 `sbrk()` 的 `p->sz` 申请的空间重叠**，从而导致二者会申请到对方的地址与页面。虽然测试中不使用 `sbrk()`，理论上能通过测试，但这显然是**对原有功能的破坏**。

因此，我们选取地址区域时必须避开底部的 `sbrk()` 申请的空间，所以我最后改用了从 `TRAPFRAME` 开始向下生长的地址空间，从而避开了冲突并通过测试。

---

## 测试方法与结果
使用以下命令运行官方测试，这将会对**所有任务**进行测试：

```bash
make grade
```

以下是我的完整测试结果：

```bash
== Test running mmaptest ==
$ make qemu-gdb
(4.4s)
== Test   mmaptest: mmap basic ==
  mmaptest: mmap basic: OK
== Test   mmaptest: mmap private ==
  mmaptest: mmap private: OK
== Test   mmaptest: mmap read-only ==
  mmaptest: mmap read-only: OK
== Test   mmaptest: mmap read/write ==
  mmaptest: mmap read/write: OK
== Test   mmaptest: mmap dirty ==
  mmaptest: mmap dirty: OK
== Test   mmaptest: not-mapped unmap ==
  mmaptest: not-mapped unmap: OK
== Test   mmaptest: lazy access ==
  mmaptest: lazy access: OK
== Test   mmaptest: two files ==
  mmaptest: two files: OK
== Test   mmaptest: fork_test ==
  mmaptest: fork_test: OK
== Test   mmaptest: munmap_noaccess ==
  mmaptest: munmap_noaccess: OK
== Test   mmaptest: read_only_write ==
  mmaptest: read_only_write: OK
== Test usertests ==
$ make qemu-gdb
usertests: OK (70.5s)
== Test time ==
time: OK
Score: 170/170
```

---

## 总结与回顾

在 MIT 6.1810 的最后一个实验中，我们在 xv6 系统中添加了 `mmap()` 和 `munmap()` 这两个系统调用，实现了**将文件映射到进程地址空间**的功能，并且支持**懒加载、权限控制、写回文件、映射区域的继承和释放**等特性。

在这个过程中，我们运用了前面实验学到的**内存管理、文件系统、陷阱处理**等多个模块的知识，基于对整个操作系统架构的理解完成了这最后一关，也很好地对整个实验的内容进行了综合应用与回顾。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [MIT 6.1810 mmap lab](https://pdos.csail.mit.edu/6.1810/2025/labs/mmap.html)
