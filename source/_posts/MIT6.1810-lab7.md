---
title: MIT 6.1810 Lab 7:Locks
date: 2026-09-25 23:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab7 全记录，主题是锁
---
# MIT 6.1810 Lab 7: Locks

---

## 实验概览

Lab 7 的主题是**锁（lock）**，这是操作系统中用于实现**并发控制**的一个重要机制。恰当地使用锁可以保证共享资源的安全访问，但过度使用锁会导致并发性能下降甚至死锁。

在本实验中，我们会重新设计 xv6 的内存分配器，通过减少锁的竞争来提高性能，并在 xv6 中用原子操作实现**读写锁（写者优先）**。

在完成本实验前，可以先阅读 [xv6 book](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf) 的第 7 章，这里会介绍 xv6 中锁的实现机制与用法。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Memory allocator (moderate)

#### 需求分析

当操作系统运行在多个 CPU 之上，或者在多线程环境下，就会存在对内存的**并发访问**问题，使用**锁(lock)** 是一种常见的解决方案。但过度使用锁会使得并行程序变成串行，导致多核处理器的优势下降。

在 xv6 的内存分配器（allocator）中，使用了一个**全局锁（`kmem.lock`）** 来保护内存分配器的状态，在 `kalloc()` 和 `kfree()` 中对空闲页面链表进行操作时都需要先获取锁，这就导致当 `kalloc()` 和 `kfree()` 被**频繁调用**时，大量进程都在等待锁的释放，导致程序性能下降。

问题的根源在于全局**只有一个空闲链表**，因此一个可能的解决方案就是为每一个 CPU 都维护一个**独立的空闲链表**，这样每个 CPU 都可以独立地进行内存分配和释放操作，从而减少锁的竞争。

当一个 CPU 的空闲链表**耗尽**时，应当允许它从其他 CPU 的空闲链表中获取空闲页面。

本题的测试在 `user/kalloctest.c` 中，它会进行大量的内存申请与释放，并且会统计对 `kmem` 锁的 `acquire()` 次数，要求这个次数必须在限定范围内。因此我们必须重新设计 xv6 的内存分配器实现，减少锁的竞争来提高性能。

#### 实现思路

整体思路就是为每一个 CPU 都维护一个独立的空闲链表，首先要做的就是修改 `kmem`，让它变为一个数组，CPU 的最大个数定义于 `kernel/param.h` 中。

```c
struct {
  struct spinlock lock;
  struct run *freelist;
} kmem[NCPU];
```

然后修改 `kinit()`，增加对于每一个锁的初始化：

```c
void
kinit()
{
  for (int i = 0;i < NCPU;i++) {
    initlock(&kmem[i].lock, "kmem");
    kmem[i].freelist = 0;
  }
  freerange(end, (void*)PHYSTOP);
}
```

这里的 `freerange()` 我们在 Lab 3 中已经见过，就是对所有空闲物理页面都调用 `kfree()`，这样会进行清空操作并将页面插入到链表中。

接下来就要修改 `kalloc()` 和 `kfree()` 的逻辑了。当调用这两个函数时，应当对当前 CPU 对应的链表进行操作。

首先是 `kfree()`，我们可以用 `cpuid()` 来获取**当前 CPU 的 ID**，然后获取对应的链表进行**插入操作**。

由于插入操作不涉及链表会溢出的情况，因此我们不需要做额外的处理。

根据官方提示，调用 `cpuid()` 时必须**关闭中断**，我们可以使用 `push_off()` 和 `pop_off()` 来分别关闭与恢复中断，这么做的原因会在后面详细解释。

```c
void
kfree(void *pa)
{
  struct run *r;

  if(((uint64)pa % PGSIZE) != 0 || (char*)pa < end || (uint64)pa >= PHYSTOP)
    panic("kfree");

  // Fill with junk to catch dangling refs.
  memset(pa, 1, PGSIZE);

  r = (struct run*)pa;

  push_off();
  int cpu = cpuid();
  
  acquire(&kmem[cpu].lock);
  r->next = kmem[cpu].freelist;
  kmem[cpu].freelist = r;
  release(&kmem[cpu].lock);
  pop_off();
}
```

最后是 `kalloc()`，同样需要获取 CPU ID 并关闭中断，然后从链表头部取出空闲页面。

与 `kfree()` 不同的是，`kalloc()` 需要考虑链表为空的情况，需要从其他 CPU 的链表中“窃取”空闲页面，这需要对应的窃取策略。

我采用的策略是从当前 CPU 的下一个开始**全部扫描一遍**，只要遇到有空闲页面的 CPU 就从它的链表中取出一个页面返回。

```c
void *
kalloc(void)
{
  push_off();
  int cpu = cpuid();
  
  struct run *r;

  acquire(&kmem[cpu].lock);
  r = kmem[cpu].freelist;
  if(r) {
    kmem[cpu].freelist = r->next;
    release(&kmem[cpu].lock);
  } else {
    // 本队列没有
    release(&kmem[cpu].lock);
    int index = (cpu + 1) % NCPU;
    for (int i = 0;i < NCPU - 1;i++) {
      acquire(&kmem[index].lock);
      r = kmem[index].freelist;
      if (r) {
        kmem[index].freelist = r->next;
        release(&kmem[index].lock);
        break;
      }
      release(&kmem[index].lock);
      index = (index + 1) % NCPU;
    }
  }
  pop_off();

  if(r)
    memset((char*)r, 5, PGSIZE); // fill with junk
  return (void*)r;
}
```

#### 测试方法

在 xv6 中运行 `kalloctest` 来进行测试，最终的输出结果如下：

```bash
start test1
test1 results:
--- lock kmem stats
lock: kmem: #test-and-set 0 #acquire() 80059
lock: kmem: #test-and-set 0 #acquire() 119299
lock: kmem: #test-and-set 0 #acquire() 113781
lock: kmem: #test-and-set 0 #acquire() 120054
lock: kmem: #test-and-set 0 #acquire() 64
lock: kmem: #test-and-set 0 #acquire() 64
lock: kmem: #test-and-set 0 #acquire() 64
lock: kmem: #test-and-set 0 #acquire() 64
--- top 5 contended locks:
lock: virtio_disk: #test-and-set 183985 #acquire() 180
lock: proc: #test-and-set 180750 #acquire() 216512
lock: proc: #test-and-set 74317 #acquire() 216565
lock: proc: #test-and-set 63345 #acquire() 616771
lock: proc: #test-and-set 56024 #acquire() 616775
tot= 0
test1 OK
start test2
total free number of pages: 32463 (out of 32768)
..........
test2 OK
start test3
..........child done 10000

test3 OK
start test4
............................child done 100000
.child done 100000
.child done 100000
--- lock kmem stats
lock: kmem: #test-and-set 7282 #acquire() 693336
lock: kmem: #test-and-set 10321 #acquire() 777890
lock: kmem: #test-and-set 10509 #acquire() 746934
lock: kmem: #test-and-set 18694 #acquire() 1271193
lock: kmem: #test-and-set 21 #acquire() 119465
lock: kmem: #test-and-set 279 #acquire() 119465
lock: kmem: #test-and-set 8 #acquire() 119465
lock: kmem: #test-and-set 21 #acquire() 119465
--- top 5 contended locks:
lock: wait_lock: #test-and-set 73421672 #acquire() 40031
lock: proc: #test-and-set 15664568 #acquire() 924105
lock: proc: #test-and-set 8740896 #acquire() 2290543
lock: proc: #test-and-set 439230 #acquire() 1794296
lock: proc: #test-and-set 292984 #acquire() 1458723
tot= 47135

test4 OK
```

这里面 `test 1` 和 `test 4` 会统计 `acquire()` 的次数，注意这个测试中电脑的工作负载会显著影响统计值，因此测试时尽量把电脑里的其他程序关闭。

`test 2` 和 `test 3` 则负责测试窃取时的正确性，检查是否因窃取丢失页面。

运行 `usertests sbrkmuch` 来测试我们的系统是否仍然能申请大量内存，结果如下：

```bash
usertests starting
test sbrkmuch: OK
ALL TESTS PASSED
```

#### 潜在坑点

##### 1. `cpuid()` 和中断

`cpuid()` 的实现如下：

```c
// kernel/proc.c
int
cpuid()
{
  int id = r_tp();
  return id;
}

// kernel/riscv.h
// read and write tp, the thread pointer, which xv6 uses to hold
// this core's hartid (core number), the index into cpus[].
static inline uint64
r_tp()
{
  uint64 x;
  asm volatile("mv %0, tp" : "=r" (x) );
  return x;
}
```

可以看到，`cpuid()` 是通过读取寄存器 `tp` 来获取当前 CPU 的 ID 的。

如果我们不关闭中断，那么在调用完 `cpuid()` 后，CPU 可能会被中断打断，当前进程回到就绪队列，很可能会被**另一个 CPU** 调度执行。此时 `tp` 寄存器会自动更新为新的 CPU 的 ID，但我们之前存下的 ID 就不再正确了。因此，我们需要在调用 `cpuid()` 到释放掉锁的这段时间内**关闭中断**。

##### 2. test 1、test 4 的不稳定性

由于工作负载以及偷取策略的不同，`test 1` 和 `test 4` 的统计值可能会有较大差异，不能稳定通过，这里提供两个可能的解决方案：

1. 内存初始化时均摊页面
`kinit()` 中 `freerange()` 实际上是把所有的内存都放到调用它的 CPU 的链表中，导致其他 CPU 的初始链表均为空，会明显增加窃取的频率。因此我们可以修改相关实现，让初始时所有 CPU 链表均摊所有页面。

2. 单次窃取多个页面
当一个 CPU 需要从其他 CPU 的链表中窃取页面时，可以一次性多窃取一些页面，这样可以减少窃取的频率，从而减少锁的竞争。

### 2. Read-write lock (moderate)

#### 需求分析

当我们使用一个**自旋锁（spinlock）** 来保护一个共享资源时，如果有并发的读操作，它们也会被阻塞，但实际上**只进行读操作**是安全的，因此这种方式会降低程序的性能。

为了解决这一点，我们要在 xv6 中实现一个**读写锁（read-write lock）**，它允许多个读操作同时进行，但写操作与其他读写操作仍然是互斥的。

更进一步，为了避免写者饥饿，我们要实现**写者优先**的策略，即当有写者等待时，新的读者不能获取读锁。

相关的框架已经给出，读写锁的结构体定义在 `kernel/spinlock.h` 中，相关锁的操作函数在 `kernel/spinlock.c` 中，总共要实现以下几个函数：

- `initrwlock(struct rwspinlock *lk)`：初始化读写锁。
- `read_acquire(struct rwspinlock *lk)`：获取读锁。
- `read_release(struct rwspinlock *lk)`：释放读锁。
- `write_acquire(struct rwspinlock *lk)`：获取写锁。
- `write_release(struct rwspinlock *lk)`：释放写锁。

#### 实现思路

锁的实现需要通过**原子操作**来保证在多 CPU 的环境下的正确性，原子操作就是在执行过程中不会被中断的操作。

我们可以参考 <https://gcc.gnu.org/onlinedocs/gcc/_005f_005fatomic-Builtins.html> 来了解可以使用哪些原子操作，以下介绍实验中需要用到的：

- `type __atomic_load_n(type *ptr, int memorder)`：从 `ptr` 指向的内存位置读取一个值并返回。
- `void __atomic_store_n(type *ptr, type val, int memorder)`：将 `val` 写入 `ptr` 指向的内存位置。
- `bool __atomic_compare_exchange_n(type *ptr, type *expected, type desired, bool weak, int success_memorder, int failure_memorder)`：如果 `*ptr` 的值等于 `*expected`，则将 `desired` 写入 `*ptr`，并返回 true；否则，将 `*ptr` 的值写入 `*expected`，并返回 false。
- `type __atomic_add_fetch(type *ptr, type val, int memorder)`：将 `val` 加到 `*ptr` 上，并返回运算结果。可以将 `add` 改为 `sub`、`and`、`or`、`xor` 等。

这里面都涉及到 `memorder` 这个参数，它用来表示**内存的访问顺序**，可选的值包括 `__ATOMIC_RELAXED`、`__ATOMIC_SEQ_CST`、`__ATOMIC_RELEASE` 等，我们选择其中最安全的 `__ATOMIC_SEQ_CST` 即可。

为了实现读写锁，我们需要维护一个状态变量 `status`，它代表**读者的数量**，如果 `status` 为负数，则表示有写者正在持有锁。

此外，为了实现**写者优先**，我们还需要维护表示是否有写者等待的变量 `haswriter`，该变量被置位时读者不再能获得锁。

这样我们就拿到了读写锁的核心数据结构，并在 `initrwlock()` 中初始化它们。

```c
/// kernel/spinlock.h
struct rwspinlock {
  // Replace this with your implementation.
  int status;  // 代表读者数量，-1 代表写者持有
  int haswriter;
};

// kernel/spinlock.c
void
initrwlock(struct rwspinlock *rwlk)
{
  // Replace this with your implementation.
  rwlk->haswriter = 0;
  rwlk->status = 0;
}
```

接下来我们先考虑写者的获取与释放逻辑。

**获取写锁**时，首先要将 `haswriter` 置位，然后利用 `__atomic_compare_exchange_n()` 来判断 `status` 是否为 0，如果是，则将其置为 -1 并跳出循环，表示写者持有锁；否则就继续循环。

```c
static void
write_acquire_inner(struct rwspinlock *rwlk)
{
  // Replace this with your implementation.
  while (1) {
    // 先通知有写者
    __atomic_store_n(&rwlk->haswriter, 1, __ATOMIC_SEQ_CST);
    int expect = 0;
    // 当 status 为 0 时写入 -1，获取写锁
    if (__atomic_compare_exchange_n(&rwlk->status, &expect, -1, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)) {
      break;
    }
  }
}
```

**释放写锁**时，只需要将 `status` 置为 0，并将 `haswriter` 清零即可。

```c
static void
write_release_inner(struct rwspinlock *rwlk)
{
  // Replace this with your implementation.
  // 释放写锁，status 置 0
  __atomic_store_n(&rwlk->status, 0, __ATOMIC_SEQ_CST);
  // 释放写锁后，haswriter 置 0
  __atomic_store_n(&rwlk->haswriter, 0, __ATOMIC_SEQ_CST);
}
```

接下来我们考虑读者的获取与释放逻辑。

**获取读锁**时，我们要先判断是否有写者等待（`haswriter`），如果有就继续循环。

然后获取当前 `status` 的值，如果为负数则代表有写者，继续循环。

然后用 `__atomic_compare_exchange_n()` 来判断 **`status` 是否还是刚刚的值**，如果是则将其加 1 并跳出循环。如果不是则代表中间有其他读者更新了该值，我们就重新循环。

```c
static void
read_acquire_inner(struct rwspinlock *rwlk)
{
  // Replace this with your implementation.
  while (1) {
    if (__atomic_load_n(&rwlk->haswriter, __ATOMIC_SEQ_CST)) 
      continue; // 有写者

    int expect = __atomic_load_n(&rwlk->status, __ATOMIC_SEQ_CST);
    if (expect < 0) 
      continue; // 写者持有锁
    // 先加载状态到 expect，然后当 status 仍为该值时写入 expect + 1，如果 status 已经改变则失败
    if (__atomic_compare_exchange_n(&rwlk->status, &expect, expect + 1, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)) {
      break;
    }
  }
}
```

**释放读锁**时，直接将 `status` 减 1 即可。

```c
static void
read_release_inner(struct rwspinlock *rwlk)
{
  // Replace this with your implementation.
  // 释放锁时直接读者数 - 1
  __atomic_sub_fetch(&rwlk->status, 1, __ATOMIC_SEQ_CST);
}
```

到此我们就完成了读写锁的实现，可以在 xv6 中运行 `rwlktest` 来进行测试，结果如下：

```bash
rwspinlock_test: step 1: initrwlock
rwspinlock_test: step 2: concurrent read_acquire
rwspinlock_test: step 3: concurrent read_release
rwspinlock_test: step 4: prepare read_acquire for writer priority test
rwspinlock_test: step 5: writer priority test
rwspinlock_test: step 6: checking for concurrent readers/writers
rwspinlock_test: step 7: checking for concurrent writers
rwspinlock_test: step 8: acquiring multiple locks
rwspinlock_test: step 9: releasing multiple locks
rwspinlock_test: step 10: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 11: multiple writer priority test
rwspinlock_test: step 12: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 13: multiple writer priority test
rwspinlock_test: step 14: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 15: multiple writer priority test
rwspinlock_test: step 16: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 17: multiple writer priority test
rwspinlock_test: step 18: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 19: multiple writer priority test
rwspinlock_test: step 20: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 21: multiple writer priority test
rwspinlock_test: step 22: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 23: multiple writer priority test
rwspinlock_test: step 24: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 25: multiple writer priority test
rwspinlock_test: step 26: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 27: multiple writer priority test
rwspinlock_test: step 28: prepare read_acquire for multiple writer priority test
rwspinlock_test: step 29: multiple writer priority test
rwspinlock_test: step 30: done
rwspinlock_test(0): 0
rwspinlock_test(2): 0
rwspinlock_test(3): 0
rwspinlock_test(1): 0
rwlktest: 4/4 CPUs succeeded
```

#### 潜在坑点

一开始我在写 `read_acquire()` 时，并没有加入对于 **`expect` 是否为负数** 的判断，因为我觉得如果中间有写者将 `status` 置为负数，那么 `__atomic_compare_exchange_n()` 就会失败，循环继续，读者就不会获取锁。

但实际上写者也可能在获取 `status` 的值之前就将其置为 -1 了，那样读者获得的 `expect` 会是 -1，结果在 `__atomic_compare_exchange_n()` 中正好与 `status` 相同，导致读者错误地将 `status` 加 1，使写者和读者同时持有锁，破坏了互斥性。

因此我们必须判断 `expect` 是否为负数，如果是非负数，即使 `status` 值被写者或其他读者改变，也只是重新循环，不影响正确性。

---

## 测试方法与结果
使用：

```bash
make grade
```
来运行官方测试，这将会对**所有任务**进行测试。

以下是我的完整测试结果：

```bash
== Test running kalloctest ==
$ make qemu-gdb
(102.1s)
== Test   kalloctest: test1 ==
  kalloctest: test1: OK
== Test   kalloctest: test2 ==
  kalloctest: test2: OK
== Test   kalloctest: test3 ==
  kalloctest: test3: OK
== Test   kalloctest: test4 ==
  kalloctest: test4: OK
== Test kalloctest: sbrkmuch ==
$ make qemu-gdb
kalloctest: sbrkmuch: OK (12.5s)
== Test running rwlktest ==
$ make qemu-gdb
(11.5s)
== Test   rwlktest ==
  rwlktest: OK
== Test usertests ==
$ make qemu-gdb
usertests: OK (173.9s)
== Test time ==
time: OK
Score: 100/100
```

---

## 总结与回顾

在本实验的第一部分，我们重新设计了 xv6 的内存分配器，通过**为每一个 CPU 维护一个独立的空闲链表**，减少了锁的竞争，从而提高了性能。这让我们体会到了锁的使用是如何影响系统的并发性的。

在第二部分，我们使用原子操作，在 xv6 中实现了**读写锁（写者优先）** 机制，允许多个读操作同时进行，但写操作与其他读写操作仍然是互斥的。这让我们深入理解了**锁的底层实现机制**，并且体会到了在多 CPU 的环境下，如何使用原子操作来保证锁的正确性。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
- https://gcc.gnu.org/onlinedocs/gcc/_005f_005fatomic-Builtins.html
