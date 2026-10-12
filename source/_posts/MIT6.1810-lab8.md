---
title: MIT 6.1810 Lab 8:file system
date: 2026-10-12 16:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab8 全记录，主题是文件系统
---
# MIT 6.1810 Lab 8: file system

> **注：** 本实验在 WSL2 环境下的运行速度较慢，建议在进行测试时尽量关闭后台应用。

---

## 实验概览

本次实验的主题是**文件系统（file system）**，这是操作系统的重要组成部分，负责将磁盘等存储设备的原始数据块抽象为树形目录结构和文件，为用户和应用程序提供数据的**存储、组织、检索、共享及权限保护**等统一管理功能。

在本次实验中，我们会动手修改 xv6 文件系统中的 inode 索引结构，实现对更大文件的支持。我们还会实现**软链接**系统调用，并在整个过程中不断深化对文件系统整体结构的理解。

在完成本实验前，可以先阅读 [xv6 book](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf) 的第 10 章，其中介绍了 xv6 中的文件系统。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 前置知识

在阅读 xv6 book 的文件系统那一章时，我感觉内容非常杂，也遇到了很大困难，所以在实验之前先整理一下 xv6 文件系统的整体结构设计。

### xv6 文件系统概览

#### 文件系统的任务

xv6 提供类 Unix 的文件系统，包括文件、目录、路径名等。文件数据被存储在 qemu 模拟的**虚拟磁盘**中。

文件系统的实现主要解决以下四个问题：

- 使用数据结构来**组织磁盘上的数据**，实现目录树、文件等功能，还要记录磁盘上哪些块是空闲的。
- 文件系统的运作可能会被系统崩溃等意外中断，需要支持**重启后的恢复**。
- 文件系统提供多进程的**并发访问**，需要维护好不变量。
- 磁盘速度明显慢于内存，需要提供**内存缓存**。

#### 文件系统的 7 个层级

xv6 的文件系统被组织为 7 个层级，如下图所示：

![alt text](/img/MIT6.1810/文件系统分层.png)

**磁盘层（Disk）** 就是 qemu 模拟出的虚拟磁盘，用于存储文件数据以及磁盘的读写操作。

**缓冲区缓存（Buffer cache）** 实现磁盘到内存的缓存，并提供对磁盘块的同步访问，即**一个 block 在同一时刻至多被一个内核线程访问**。

**日志层（logging）** 负责记录上层对于磁盘的修改操作，实现系统**崩溃后的恢复**。

**inode 层** 实现**文件**功能，每个文件对应一个 inode，inode 记录了文件的元数据以及文件数据在磁盘上的位置。

**目录层（Directory）** 是特殊的 `inode`，其内容是一个个目录项，记录了文件名与 `inode` 号的映射关系。

**路径名（Pathname）** 提供对给定路径名的递归解析。

**文件描述符（File descriptor）** 利用文件系统接口提供对文件、设备、管道等资源的**抽象**。

#### xv6 中的磁盘布局

磁盘本身由若干个**扇区（sector）**组成，它是磁盘进行读写、寻址操作的基本单位。

而从文件系统的角度来看，磁盘被划分为若干个**块（block）**，每个块由若干个连续扇区组成。

xv6 的磁盘布局如下图所示：

![alt text](/img/MIT6.1810/磁盘布局.png)

第一块是**引导块（boot）**，它包含了启动代码以及文件系统的元数据。不使用。

第二块是**超级块（super block）**，它包含了文件系统的元数据，包括文件系统的大小、inode 的数量、数据块的数量等。

随后是日志块（log）、inodes 块、位图块（bitmap），分别用来记录日志、inode 的数据，以及磁盘上空闲块的分布。

后面就都是数据块（data）了，用于存储所有文件数据。

### 缓冲区缓存层（Buffer cache）

接下来我们会从 buffer cache 层开始，从下向上介绍文件系统的每一层。

buffer cache 的作用是**将磁盘中的块缓存到内存中**以及实现对磁盘块的**同步访问**。

#### 核心数据结构

缓冲区 buffer 的数据结构定义于 `kernel/buf.h` 中：

```c
struct buf {
  int valid;   // has data been read from disk?
  int disk;    // does disk "own" buf?
  uint dev;
  uint blockno;
  struct sleeplock lock;
  uint refcnt;
  struct buf *prev; // 链表指针
  struct buf *next;
  uchar data[BSIZE];
};
```

所有的 buffer 被组织为一个双向链表，链表头为 `bcache.head`，它的定义在 `kernel/buf.c` 中：

```c
struct {
  struct spinlock lock; 
  struct buf buf[NBUF]; // 所有缓冲区
  struct buf head;  // 链表头
} bcache;
```

#### 核心接口

这一层的核心实现在 `kernel/bio.c` 中。

##### bread(uint dev, uint blockno)

根据磁盘设备号和块号，调用 `bget()` 获取对应磁盘块的 buffer，如果该块没有被缓存就分配一个缓存。

`bget()` 先获取 `bcache.lock`，这是用来保证**一个磁盘块在内存中至多有一个缓存**。

随后 `bget()` 会先**从前往后**遍历 buffer 链表，如果存在对应的块，则将其引用计数（refcnt）加 1 并返回。

如果没找到，则会**从后往前**再遍历一遍，找出引用为 0 的 buffer 初始化后返回。

`bget()` 返回 buffer 时会**获取 buffer 的锁**，用以保证**同一时刻只有一个内核线程访问该 buffer**。

在 `bread()` 中，如果 buffer 是被新分配的，则会调用 `virtio_disk_rw()` 从磁盘中读取数据到 buffer 中。

```c
struct buf*
bread(uint dev, uint blockno)
{
  struct buf *b;
  b = bget(dev, blockno);
  if(!b->valid) {
    virtio_disk_rw(b, 0);
    b->valid = 1;
  }
  return b;
}
```

##### bwrite(struct buf *b)

使用 `bread()` 获取 buffer 后，如果我们对它进行了修改，就需要调用 `bwrite()`，它负责将修改后的内容通过 `virtio_disk_rw()` 写回磁盘。

##### brelse(struct buf *b)

当我们做完对该缓存的所有操作后，需要调用 `brelse()` 来释放这个缓存。

`brelse()` 会释放该缓存的锁，减少引用，并将这个缓存**插回队头**。

#### 缓存替换策略

buffer 的总数量是固定的（NBUF），因此需要像 cache 一样设计替换策略，xv6 中采用的是最近最久未使用（LRU）。

实际上从刚刚的接口函数中可以看出该策略的实现方法：

- 新释放的缓存插到队头，而获取缓存也**从队头开始**遍历，从而优先遍历最近被使用过的。
- 当缓存未命中时，**从队尾开始**遍历，优先选择那些最久未使用的缓存。

### 日志层(logging)

日志层的核心作用是将上层对磁盘的修改记录下来，以便在**系统崩溃后进行恢复**。

#### 恢复的原理

一次对文件系统的调用可能包含若干个写操作。在 xv6 中，这些写操作不会直接写入磁盘，而是会先被写入**日志**中。等到所有准备进行的写操作都已经在日志中后，系统会进行一次 commit 操作，此时会将该日志标记为**包含全部操作**。随后再逐个写入真正的磁盘块，全部完成后清除该日志。

实现恢复的原理是：如果崩溃发生在 **commit 之前**，我们此时还没对磁盘进行写操作，并且日志被标记为无效，所以就**直接忽略掉**该日志。

如果发生在 **commit 之后**，此时日志有效，包含所有的写操作记录，我们只需要完整地将这些写操作**重做一遍**即可实现恢复。

#### 日志区的磁盘布局

日志区在磁盘中分布在超级块之后。日志区由第一块**日志头（header block）** 和后续一系列的**日志块**组成。

日志头中包含了写操作的总数 `count`，以及后面每一块**日志块**对应的要写入的磁盘块。

日志块则包含了磁盘块**更新后的内容**。

相关的结构体定义于 `kernel/log.c` 中：

```c
struct logheader {      // 日志头
  int n;
  int block[LOGBLOCKS];
};

struct log {    // 日志
  struct spinlock lock;
  int start;
  int outstanding; // how many FS sys calls are executing.
  int committing;  // in commit(), please wait.
  int dev;
  struct logheader lh;
};
```

此外，xv6 支持将多次系统调用的写入操作记录到同一个日志中，从而减少 commit 的次数，提高性能。

#### 核心代码实现

##### 文件系统调用

一次文件系统调用的整体框架如下：

```c
begin_op();
// ...
bp = bread(...);
bp->data[...] = ...;
log_write(bp);
// ...
end_op();
```

`begin_op()` 是调用的开始，它查询当前的日志信息，如果当前日志正在进行 commit 或者日志的剩余空间不够，则进行 sleep 等待。

判断日志剩余空间是否够用的逻辑为 `log.lh.n + (log.outstanding+1)*MAXOPBLOCKS > LOGBLOCKS`，其中 `log.lh.n` 是当前**已经结束**的系统调用所占用的日志块，`log.outstanding` 是当前**正在进行**的调用数。这里默认每一个调用占 `MAXOPBLOCKS` 个日志块，其实就是对未完成调用进行的**预留**。

随后的 `bp = bread(...)` 和 `bp->data[...] = ...` 是获取缓存块并向里面写入数据。

`log_write()` 负责将该缓存块的修改记录到日志 `log` 中。具体来说，它会先判断 `log` 中是否已经包含了对该块的修改操作，如果有则更新该块以节约日志块，否则就写入一个新的日志块。

此外，`log_write()` 还会增加对应缓存的**引用次数**，防止该缓存被释放。

`end_op()` 作为一次**文件系统调用的结束**，会先减少调用数（`log.outstanding--`）。如果此时调用数为 0，则进行 commit；如果不为 0，则唤醒可能正在等待的调用，因为该调用的结束会释放对日志块的预留。

##### commit 操作的实现

一次 commit 分为 4 个阶段：

1. `write_log()`：负责将所有缓存中的日志块写入到磁盘的日志块区域。
2. `write_head()`：负责将日志头的 `count` 计数和日志块号设置好，然后写入到磁盘的日志头部分。
3. `install_trans(0)`：负责将磁盘中的所有日志块写入到对应的磁盘块之中，参数 0 表示会将 `log_write()` 之前增加的缓存引用次数恢复。
4. `log.lh.n` + `write_head()`：将日志头的计数置 0 并写回磁盘，表明这次操作已经全部完成，日志失效。

##### 恢复的实现

在启动时会初始化文件系统，存在调用链：`fsinit() -> init_log() -> recover_from_log() -> install_trans(1)`，从而将日志块中的数据**重新写入**对应的磁盘块，实现恢复。

这里的参数设置为 1，表示**不用**减少引用次数，因为之前被增加引用次数的缓存已经随着系统崩溃而消失了。

### 磁盘块的分配与释放

xv6 中使用 `balloc()` 和 `bfree()` 来分配和释放磁盘块，实现于 `kernel/fs.c` 中。

在之前提到的磁盘分布中，**位图区**用来表示**空闲磁盘块的分布**，其中每一位代表一个磁盘块，为 1 代表被占用，为 0 代表空闲。

`balloc()` 通过扫描位图区，找出对应的空闲块，置 1 并返回。

`bfree()` 则将对应的磁盘块释放，并在位图中置 0。

### inode 层

Inode 对应系统中的一个文件。

#### inode 分类

inode 分为两种，一种是磁盘上的 `inode（on-disk inode）`，一种是内存中的 `inode（in-memory inode）`。

##### 磁盘上的 inode（on-disk inode）

磁盘上的 inode 的结构体为 `struct dinode`，定义于 `kernel/fs.h` 中：

```c
struct dinode {
  short type;           // File type
  short major;          // Major device number (T_DEVICE only)
  short minor;          // Minor device number (T_DEVICE only)
  short nlink;          // 被目录链接的数量
  uint size;            // Size of file (bytes)
  uint addrs[NDIRECT+1];   // Data block addresses
};
```

可以看到，它包括了**文件类型、链接数、文件大小以及文件磁盘块的位置信息**。

inode 连续地存储在磁盘的 inode 区域，我们可以根据 inode 排在第几个来快速找到它的位置，这个数也就是它的 **inode 号**。

##### 内存中的 inode（in-memory inode）

内存中的 inode 的结构体为 `struct inode`，定义于 `kernel/file.h` 中：

```c
struct inode {
  uint dev;           // Device number
  uint inum;          // Inode number
  int ref;            // 被 C 指针引用的数量
  struct sleeplock lock; // protects everything below here
  int valid;          // inode has been read from disk?

  short type;         // copy of disk inode
  short major;
  short minor;
  short nlink;
  uint size;
  uint addrs[NDIRECT+1];
};
```

内存中的 inode 实际上就是磁盘上的 inode 在**内存中的副本**，除此之外它还包括 inode 号、设备号等信息。

内存中的 inode 由内存中的 **inode 表（itable）**维护：

```c
struct {
  struct spinlock lock;
  struct inode inode[NINODE];
} itable;
```

#### 核心函数

关于 inode 的核心函数的实现主要集中在 `kernel/fs.c` 中。

##### iget()/iput()

`iget(uint dev, uint inum)` 负责根据设备号和 inode 号，从 `itable` 中找到对应的 inode。

如果该 inode 已经在 `itable` 中了，则增加其 C 指针引用数（ref）并返回。

如果不在，则从 `itable` 中找出空闲 inode（ref == 0），并将其有效位置 0，以便使用时从磁盘中读取。

`iput(struct inode *ip)` 负责**减少给定 inode 的引用数**。

如果引用数**减少为 0**，则要释放该 inode。它会调用 `itrunc(ip)` 将该 inode 对应的**所有磁盘块全部释放**，将 `type` 字段设置为 0，并调用 `iupdate()` 将新信息写回磁盘上的 inode。

##### ialloc(uint dev, short type)

`ialloc` 负责**从磁盘中申请一个 inode**，它会先找到一个空闲的 inode（type == 0），然后设置好类型，并调用 `iget()` 将其放入 `itable` 中。

##### ilock()/iunlock()

如果需要读取或修改一个 inode 的元数据，必须在它的锁的保护下进行。

`ilock(struct inode *ip)` 负责**获取指定 inode 的锁**，同时，如果该 inode 的有效位为 0，则会从磁盘上对应的 inode 读取到内存中。

`iunlock(struct inode *ip)` 与之相对，负责释放 inode 的锁。

##### iupdate(struct inode *ip)

该函数用于在 inode 更新后，将其数据写回到磁盘上对应的 inode。

#### inode 中磁盘块的定位方法

`struct inode` 中有一个数组 `addrs[NDIRECT+1]`，用来记录该文件**存储在磁盘上的哪些块中**。

该数组中前 `NDIRECT` 个元素为**直接块**，其数值就是对应的磁盘块，总计 12 KB。

最后一个元素为**间接块**，其对应的磁盘块存储了 `NINDIRECT` 个磁盘块号，这些磁盘块号对应的就是存储文件数据的磁盘块，总计 256 KB。

一个文件在存储数据时，优先使用直接块，用尽时再使用间接块以提高访问性能。

![alt text](/img/MIT6.1810/inode磁盘块分布.png)

函数 `bmap(struct inode *ip, uint bn)` 用于找到给定 inode 中第 `bn` 个数据块对应的磁盘块号。

其实现方式是若 `bn < NDIRECT`，则 `addrs[bn]` 就是对应的磁盘块号，如果不存在就 `balloc()` 一个磁盘块。

如果 `bn - NDIRECT < NINDIRECT`，则先读取 `addrs[NDIRECT]` 对应的磁盘块（没有就申请），然后读取其第 `bn - NDIRECT` 个磁盘号，从而找到需要的地址。

`itrunc()` 实现清除 inode 对应的磁盘块也是相同的方式：先 `bfree()` 直接块，然后读取间接块，`bfree()` 掉所有间接块中对应的块号，最后再处理间接块本身。

`writei(struct inode *ip, int user_src, uint64 src, uint off, uint n)` 用于实现向 inode 对应文件的 `off` 处写入 n bytes，其中利用的就是 `bmap(ip, off/BSIZE)` 来找到对应的磁盘块。`readi()` 也是同理。

### 目录层（Directory）

xv6 中目录就是 `type` 字段为 `T_DIR` 的 inode，它的内容为一个个目录项，记录着 inode 号与文件名的映射，其数据结构为 `struct dirent`：

```c
struct dirent {
  ushort inum;
  char name[DIRSIZ] __attribute__((nonstring));
};

```

如果 `inum` 字段为 0，则代表该目录项是空闲的。

#### 相关函数

`dirlookup(struct inode *dp, char *name, uint *poff)` 负责从给定目录中找到名字为 `name` 的目录项，并返回其 inode，同时会把目录项在目录里的偏移量写入 `*poff`，方便调用者进行修改。

`dirlink(struct inode *dp, char *name, uint inum)` 负责在指定目录中加入新的目录项（`name` 和 `inum`）的映射。如果该名字的目录项已经存在则会报错。

### 路径名（Pathname）

在 `kernel/fs.c` 中，`namei()` 和 `nameiparent()` 分别用于查找给定路径 `path` 对应的 inode，其中前者返回路径最后一个元素的 inode，而后者返回最后一个元素**所在目录**的 inode。

这两个函数都通过调用 `namex(char *path, int nameiparent, char *name)` 来实现：

```c
static struct inode*
namex(char *path, int nameiparent, char *name)
{
  struct inode *ip, *next;

  if(*path == '/')
    ip = iget(ROOTDEV, ROOTINO);
  else
    ip = idup(myproc()->cwd);

  while((path = skipelem(path, name)) != 0){
    ilock(ip);
    if(ip->type != T_DIR){
      iunlockput(ip);
      return 0;
    }
    if(nameiparent && *path == '\0'){
      // Stop one level early.
      iunlock(ip);
      return ip;
    }
    if((next = dirlookup(ip, name, 0)) == 0){
      iunlockput(ip);
      return 0;
    }
    iunlockput(ip);
    ip = next;
  }
  if(nameiparent){
    iput(ip);
    return 0;
  }
  return ip;
}
```

首先，该函数会根据路径名的第一个元素判断当前路径是相对路径还是绝对路径，从而获取当前目录的 inode 或根目录的 inode。

然后进入循环，根据路径 `path` 获取当前目录下要查找的目录项名字，写入 `name` 中，并将 `path` 后移一个元素。

例如：`skipelem("a/bb/c", name) = "bb/c", setting name = "a"`

随后如果 `nameiparent` 有效且 `path` 为空，表明当前的目录是最后一个元素所在的目录，直接返回 `ip`。

否则在当前目录中查找 `name` 对应的 inode 并进入下一个循环。

由此就实现了通过**路径名**对文件/目录的**递归查找**。

### 文件描述符（File descriptor）

xv6 作为类 Unix 系统，大部分资源，如控制台、文件、设备等，都可以被视作文件。

文件的结构体定义在 `kernel/file.h` 中：

```c
struct file {
  enum { FD_NONE, FD_PIPE, FD_INODE, FD_DEVICE } type;
  int ref; // reference count
  char readable;
  char writable;
  struct pipe *pipe; // FD_PIPE
  struct inode *ip;  // FD_INODE and FD_DEVICE
  uint off;          // FD_INODE
  short major;       // FD_DEVICE
};
```

其中包括了该文件的类型、引用、偏移量等信息。在 xv6 中，每一个进程都有**自己的打开文件表**，同时系统中也会拥有**全局打开文件表** `ftable`。

```c
struct {
  struct spinlock lock;
  struct file file[NFILE];
} ftable;
```

#### 核心函数

`filealloc()` 从 `ftable` 中找出引用量为 0 的文件。

`filedup(struct file *f)` 增加指定文件的引用量。

`fileclose(struct file *f)` 降低指定文件的引用量，如果引用量降为 0，则释放该文件，不同文件类型有不同的释放方式。

`fileread()` / `filewrite()` 负责在文件的对应地址读取、写入数据。

`filestat(struct file *f, uint64 addr)` 用于将文件的 `struct stat` 状态信息读取到指定地址。

---

## 详细实现

### 1. Large files (moderate)

#### 需求分析

xv6 原有的文件系统中，一个 inode 有 **12 个直接索引块**（对应 12 KB）和 **1 个一级间接索引**（对应 256 KB），这导致 xv6 中一个文件最大只能有 256 + 12 = 268 KB。

在本题中，我们要修改 xv6 中的文件系统，使之能够支持更大的文件。具体来说，就是**将一个直接索引转化为一个二级间接索引**。

一个**二级间接索引**指向一个磁盘块，该磁盘块的内容是 256 个磁盘号，它们分别指向 256 个磁盘块，而这 256 个磁盘块的内容同样为 256 个块号（数据块），这样一个二级间接索引就可以对应 **256*256 = 65536** 个数据块了。

这样一来，最大文件的大小就变为 11 + 256 + 65536 = 65803 KB，而我们的测试就是测系统**是否能够建立与读取这么大的文件**。

#### 实现思路

首先我们要修改 inode 中的块索引结构。原来是 12 个直接索引 + 1 个一级间接索引，我们通过修改宏定义将其改为 11 个直接 + 1 个一级间接 + 1 个二级间接：

```c
#define NDIRECT 11
#define NINDIRECT (BSIZE / sizeof(uint))
#define DOUBLENINDIRECT NINDIRECT*NINDIRECT
#define MAXFILE (NDIRECT + NINDIRECT + DOUBLENINDIRECT)
```

随后我们把 `inode` 和 `dinode` 中的 `addrs[]` 字段改为 `addrs[NDIRECT+2]`，来适配对宏的修改。

除了修改定义以外，我们还要修改两个依赖 inode 块索引实现的函数，来适配新的索引结构。

首先是 `kernel/fs.c` 中的 `bmap(struct inode *ip, uint bn)` 函数，它**负责在指定 inode 文件中找到第 `bn` 块的块号并返回**。

在原有的实现中，它会**根据 `bn` 的大小来分别处理直接索引和一级间接索引**，因此我们需要加入对于二级间接索引的处理。

我们可以仿照前者的处理来进行实现。首先用 `addrs[NDIRECT + 1]` 来获得二级间接块的磁盘块号。

然后利用 `bn / NINDIRECT` 算出我们要找的块**在第几个一级间接块中**，将其作为二级间接块的索引，找到对应的一级间接块的块号。

接着再利用 `bn -= index2 * NINDIRECT` 算出一级间接块中的索引，从而得到我们要找的块号。

在这个过程中，如果二级间接块/一级间接块**不存在**（块号为 0），我们就通过 `balloc()` 来为它们申请一个磁盘块。在更新其中的块号时，还要记得**用 `log_write()` 写入日志**。

此外，任何用 `bread()` 获取的缓存块，我们都要对应地用 `brelse()` 释放。

```c
// 加在一级间接索引的处理之后
bn -= NINDIRECT;
if (bn < DOUBLENINDIRECT) {
  if ((addr = ip->addrs[NDIRECT + 1]) == 0) {
    // 二级间接块不存在，申请一个
    addr = balloc(ip->dev);
    if (addr == 0)
      return 0;
    ip->addrs[NDIRECT + 1] = addr;
  }
  bp = bread(ip->dev, addr);
  a = (uint *)bp->data; // 获取二级间接块的数据
  int index2 = bn / NINDIRECT;  // 一级间接块号在二级间接块中的第几个

  if ((addr = a[index2]) == 0) {
    // 一级间接块不在，申请一个
    addr = balloc(ip->dev);
    if(addr == 0)
      return 0;
    else {
      a[index2] = addr;
      log_write(bp);
    }
  }
  brelse(bp); // 先把之前的缓存释放掉
  bp = bread(ip->dev, addr);
  a = (uint *)bp->data;

  bn -= index2 * NINDIRECT; // 获得在一级间接块内的位置
  if((addr = a[bn]) == 0){
    addr = balloc(ip->dev);
    if(addr){
      a[bn] = addr;
      log_write(bp);
    }
  }
  brelse(bp);
  return addr;
```

随后我们还要修改 `itrunc(struct inode *ip)` 函数，它负责将该文件中所有的数据块都使用 `bfree()` 进行释放。

在原先的实现中，它会先释放所有直接块，然后再释放一级间接块对应的 256 个块，最后释放间接块本身。

我们要在这个函数中加入对于二级间接块的释放。思路是先找到二级间接块，然后遍历其中的所有块号找到对应的一级间接块，再按照已有的一级间接块处理逻辑处理即可，**最后再释放二级间接块本身**。

```c
struct buf *bp2;
uint *a, *a2;
// ...
// 处理二级间接块
if (ip->addrs[NDIRECT + 1]) {
  bp2 = bread(ip->dev, ip->addrs[NDIRECT + 1]);
  a2 = (uint *)bp2->data;
  for (int j = 0;j < NINDIRECT;j++) {
    if (a2[j]) {
      bp = bread(ip->dev, a2[j]);
      a = (uint *)bp->data;
      for (int k = 0;k < NINDIRECT;k++) {
        if (a[k])
          bfree(ip->dev, a[k]);
      }
      brelse(bp);
      bfree(ip->dev, a2[j]);
    }
  }
  brelse(bp2);
  bfree(ip->dev, ip->addrs[NDIRECT + 1]);
  ip->addrs[NDIRECT + 1] = 0;
}
```

#### 测试方法

在 xv6 中运行 `bigfile` 来进行测试，正确的结果如下：

```bash
..................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................
wrote 65803 blocks
reading bigfile
..................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................
bigfile done; ok
```

### 2. Symbolic links (moderate)

#### 需求分析

在任务中，我们要新增一个系统调用 `symlink(char *target, char *path)`，它的功能是**将 `path` 路径软链接到目标文件 `target`**。

**软链接**本身是一个特殊文件，里面会存储目标文件的路径。打开软链接文件时，不会直接打开文件本身，而是会**打开文件里的路径对应的目标文件**。**软链接不会增加文件的引用数**。

与软链接相对应的是硬链接，它本身不是一个文件，而是**文件名与 inode 的映射关系**（目录中的一行记录）。硬链接会增加文件的引用次数，因此不用担心源文件被删除。

除了实现系统调用以外，我们还要实现**软链接文件的打开**。特别地，如果链接到的目标文件也是软链接文件，应当**支持递归地打开**。但如果多个软链接文件循环链接，则应该**返回错误**（可以通过设立循环次数阈值来实现）。

此外，如果调用 `open()` 时使用了 `O_NOFOLLOW` 模式，则应当**直接打开软链接文件本身**，而不是打开链接到的目标文件。

#### 实现思路

在实现软链接之前，我们可以先参考硬链接的实现 `link(char *old, char *new)`，它负责将 `old` 指向的文件硬链接到 `new` 这个名字。

```c
uint64
sys_link(void)
{
  char name[DIRSIZ], new[MAXPATH], old[MAXPATH];
  struct inode *dp, *ip;

  if(argstr(0, old, MAXPATH) < 0 || argstr(1, new, MAXPATH) < 0)
    return -1;

  begin_op();
  if((ip = namei(old)) == 0){
    end_op();
    return -1;
  }

  ilock(ip);
  if(ip->type == T_DIR){
    iunlockput(ip);
    end_op();
    return -1;
  }

  ip->nlink++;
  iupdate(ip);
  iunlock(ip);

  if((dp = nameiparent(new, name)) == 0)
    goto bad;
  ilock(dp);
  if(dp->dev != ip->dev || dirlink(dp, name, ip->inum) < 0){
    iunlockput(dp);
    goto bad;
  }
  iunlockput(dp);
  iput(ip);

  end_op();

  return 0;

bad:
  ilock(ip);
  ip->nlink--;
  iupdate(ip);
  iunlockput(ip);
  end_op();
  return -1;
}
```

硬链接实现的思路是找到 `old` 对应的文件 inode，以及 `new` 对应的所在目录和文件名，然后在 `new` 所在的目录中添加 `new` 的名字与 `old` 的 inode 的映射。

注意到文件系统的相关系统调用涉及磁盘的读写，因此需要将操作写入日志，即**用 `begin_op()` 和 `end_op()` 包围**。

此外，当我们访问 inode 块时，还要记得对它们进行**上锁保护**。

与硬链接不同的是，软链接不需要建立映射关系，直接将目标路径写入文件即可。

因此实现软链接的整体思路是先检查 `path` 对应的文件是否存在，若不存在则调用 `create()` 创建一个类型为 `T_SYMLINK` 的文件，然后调用 `writei()` 将 `target` 写入这个文件的数据块中即可。

```c
uint64
sys_symlink(void) {
  char path[MAXPATH], target[MAXPATH], name[DIRSIZ];
  struct inode *dp, *ip;

  if (argstr(0, target, MAXPATH) < 0 || argstr(1, path, MAXPATH) < 0) {
    return -1;
  } 

  begin_op();

  if ((dp = nameiparent(path, name)) == 0) {
    end_op();
    return -1;
  }

  ilock(dp);
  if (dirlookup(dp, name, 0) != 0) {
    // path 对应的文件已经存在!
    iunlockput(dp);
    end_op();
    return -1;
  }
  iunlockput(dp);

  // 创建软链接文件
  ip = create(path, T_SYMLINK, 0, 0); // 会自动获取 ip 的锁

  writei(ip, 0, (uint64)target, 0, MAXPATH);  // 向文件中写入 target

  iunlockput(ip);

  end_op();

  return 0;
}
```

在 xv6 中实现系统调用的整个流程已经在前面的 lab 涉及过多次了，hint 中也有提示，这里不再重复，记得加入对于 `T_SYMLINK` 和 `O_NOFOLLOW` 的定义。

接下来我们要修改 `open()` 系统调用，使其支持打开软链接文件，并且在 `O_NOFOLLOW` 置位时直接打开文件本身。

我们需要在 `open()` 中**拿到 `path` 对应的文件 inode 后**进行软链接文件判断，条件为 `(omode & O_NOFOLLOW) == 0 && ip->type == T_SYMLINK`。如果 `O_NOFOLLOW` 置位，我们就不用当作软链接文件来处理，继续走正常打开流程。

对于软链接文件，可以用循环 `while (ip->type == T_SYMLINK)` 来递归访问软链接文件，并维护迭代次数来防止循环软链接。

对于循环内部，我们应当用 `readi()` **读取该软链接文件内的路径信息**，并据此找到目标文件的 inode。注意要合理管理 inode 锁的获取与释放。

当 inode 的类型不再为 `T_SYMLINK` 后，就说明找到了真正的目标文件，接下来走正常的打开流程。

```c
// kernel/sysfile.c sysopen()
if((ip = namei(path)) == 0){
  end_op();
  return -1;
}
ilock(ip);
if(ip->type == T_DIR && omode != O_RDONLY){
  iunlockput(ip);
  end_op();
  return -1;
}
if ((omode & O_NOFOLLOW) == 0 && ip->type == T_SYMLINK) {
  int iteration = 0;
  while (ip->type == T_SYMLINK) {
    if (++iteration > 100) {
      end_op();
      return -1;
    }
    char target[MAXPATH];
    readi(ip, 0, (uint64)target, 0, MAXPATH);
    iunlockput(ip);
    if ((ip = namei(target)) == 0) {
      end_op();
      return -1;
    }
    ilock(ip);
  }
}
```

#### 测试方法

在 xv6 中运行 `symlinktest`，正确输出如下：

```bash
Start: test symlinks
test symlinks: ok
Start: test concurrent symlinks
test concurrent symlinks: ok
```

---

## 测试方法与结果
使用以下命令运行官方测试，这将会对**所有任务**进行测试：

```bash
make grade
```

以下是我的完整测试结果：

```bash
== Test running bigfile (takes minutes) ==
$ make qemu-gdb
running bigfile (takes minutes): OK (230.9s)
== Test running symlinktest ==
$ make qemu-gdb
(2.6s)
== Test   symlinktest: symlinks ==
  symlinktest: symlinks: OK
== Test   symlinktest: concurrent symlinks ==
  symlinktest: concurrent symlinks: OK
== Test usertests (takes minutes) ==
$ make qemu-gdb
usertests (takes minutes): OK (317.2s)
== Test time ==
time: OK
Score: 100/100
```

---

## 总结与回顾

在本实验的**第一部分**，我们通过亲手修改 xv6 文件系统中的 **inode 索引结构**，通过增加**二级间接索引**实现了对更大文件的支持，从而对文件中各个磁盘块号是如何保存的有了更深入的理解。这一结构被广泛运用于类 Unix 系统。

在本实验的第二部分，我们在系统中添加了系统调用 `symlink()`，实现了文件的**软链接**，同时还支持递归访问软链接文件、直接访问软链接文件本身等功能。在这个过程中，我们运用到了文件系统多个层次的内容，进一步加深了对文件系统整体结构的理解。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
