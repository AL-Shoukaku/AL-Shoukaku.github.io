---
title: MIT 6.1810 Lab 6:Networking
date: 2026-09-23 17:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab6 全记录，主题是操作系统的设备驱动程序
---
# MIT 6.1810 Lab 6: Networking

---

## 实验概览

Lab 6 的主题是**设备驱动程序**，它是操作系统中最重要的组成部分之一，负责**操作系统与硬件之间的交互**。

在本实验中，我们将使用 QEMU 模拟出来的 E1000 网卡设备，编写对应的**驱动程序代码**，并在此基础上实现一个简单的 **UDP 协议栈**，体会操作系统是如何与设备进行交互的。

在完成本实验前，可以先阅读 [xv6 book](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf) 的第 6 章，这里会介绍 xv6 中几个设备驱动程序的例子，辅助我们理解本实验的内容。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Part One: NIC (moderate)

#### 需求分析

在本实验中，QEMU 将为我们模拟 **E1000** 网卡设备以及以太局域网（LAN）。在 LAN 中，xv6 为客户机，IP 地址为 10.0.2.15；QEMU 模拟的计算机则为主机，IP 地址为 10.0.2.2。

在第一部分，我们将补全 `kernel/e1000.c` 中 `e1000_transmit()` 和 `e1000_recv()` 这两个函数，它们分别是 E1000 进行**发送分组**和**接收分组**的核心函数。

`e1000_transmit()` 负责将一个待发送的数据写入缓冲区（由 `struct tx_desc` 描述）。

`e1000_recv()` 负责将缓冲区（由 `struct rx_desc` 描述）内的数据读取出来并交给网络协议栈。

#### E1000 介绍

关于 E1000，可以参考 [Software Developer's Manual](https://pdos.csail.mit.edu/6.1810/2025/readings/8254x_GBe_SDM.pdf)，重点关注 3.2 - 3.4 以及第 13 章。下面先介绍与本实验最相关的部分。

在 `kernel/e1000.c` 的 `e1000_init()` 中，系统会将 E1000 配置为 DMA 模式，即设备直接访问 RAM 内存。

由于分组（packet）到达的速度可能会快于设备处理的速度，因此我们设置了**缓冲区**。它分为发送和接收两种，分别由 `struct tx_desc` 和 `struct rx_desc`（后续简称 TX 和 RX）这两种结构体进行描述，包括缓冲区地址、大小、状态等字段。

设备驱动程序为这两种缓冲区各自维护一个**循环队列**。

- 在发送分组时，设备驱动程序将**待发送数据所在的缓冲区**的地址、大小等写入一个空闲的 TX，随后设备会将这里面的数据发送出去。
- 在接收分组时，设备会向**接收队列**中 RX 对应的缓冲区地址写入数据，而设备驱动程序则负责提取 RX 里的缓冲区数据并将其交给网络协议栈。

此外，E1000 还有若干个由内存映射的寄存器，我们可以通过直接访问对应的**物理地址**来与这些寄存器进行交互。所有寄存器映射的基地址在 `regs` 中，我们可以通过定义于 `kernel/e1000_dev.h` 中的偏移量来访问各个寄存器。例如 `E1000_TDT`、`E1000_RDT` 分别对应发送队列和接收队列尾部的**索引**。

#### 实现思路

我们分为发送和接收两部分来实现，这两部分官方给的 hint 都很充分，可以照着做。

##### 发送（e1000_transmit）

首先，我们要获取队列尾部的 TX（索引为 `regs[E1000_TDT]`）。

随后要判断其**是否是空闲的**。可以根据 `status` 字段中的 `DD（Descriptor Done）` 位来判断，它用来代表设备是否已经处理完这个缓冲区，如果为 0 则代表设备还没处理完，此时没有空余的缓冲区可用，直接返回 -1。

如果是空闲的，我们要先用 `kfree()` 释放掉该描述符原先对应的缓冲区，然后将要传输的缓冲区地址 `buf`、大小 `len` 写入对应字段。

此外还要设置好 `cmd` 字段，`EOP` 代表当前是该分组的最后一个缓冲区，`RS` 则是让设备处理完后将 `DD` 置位。

最后更新 `E1000_TDT` 的值，让其指向下一个 TX 即可。

注意 xv6 运行在多个 CPU 之上，会存在对于设备的**并发访问**，因此我们要用锁来进行保护。

```c
int
e1000_transmit(char *buf, int len)
{
  acquire(&e1000_lock);
  uint32 tail = regs[E1000_TDT];  // 获取 TX 尾部
  struct tx_desc *tx = &tx_ring[tail];
  if ((tx->status & E1000_TXD_STAT_DD) == 0) {
    printf("no free tx\n");
    release(&e1000_lock);
    return -1;
  }
  tx->status &= ~E1000_TXD_STAT_DD;
  if (tx->addr != 0)
    kfree((void *)PGROUNDDOWN(tx->addr));   // 释放 buf

  tx->length = len;
  tx->addr = (uint64)buf;
  tx->cmd |= E1000_TXD_CMD_EOP | E1000_TXD_CMD_RS;
  regs[E1000_TDT] = (regs[E1000_TDT] + 1) % TX_RING_SIZE;

  release(&e1000_lock);

  return 0;
}
```

在一个终端 A 中运行 `python3 nettest.py txone`，然后在另一个终端 B 中运行 xv6 并执行 `nettest txone` 来发送一个分组。此时终端 A 会有以下输出，代表测试成功：

```bash
tx: listening for a UDP packet
txone: OK
```

此时运行 `tcpdump -XXnr packets.pcap` 可以看到以下输出：

```bash
reading from file packets.pcap, link-type EN10MB (Ethernet), snapshot length 65536
13:06:55.648657 IP 10.0.2.15.2003 > 10.0.2.2.26099: UDP, length 5
        0x0000:  5255 0a00 0202 5254 0012 3456 0800 4500  RU....RT..4V..E.
        0x0010:  0021 0000 0000 6411 3ebc 0a00 020f 0a00  .!....d.>.......
        0x0020:  0202 07d3 65f3 000d 0000 7478 6f6e 65    ....e.....txone
```

##### 接收（e1000_recv）

接收和发送的整体思路相近，区别在于发送一次只发一个分组，而接收**一次可能会接收多个分组**，因此需要加一个循环处理。

首先还是取队列尾部的 RX，根据 `DD` 位判断设备是否已经向里面写完了数据，如果为 0 则所有的缓冲区数据都被读出，**终止循环**。

随后根据 RX 将缓冲区的地址和大小信息读出，调用 `net_rx()` 来将数据**交给协议栈**。

然后再用 `kalloc()` 为这个缓冲区**分配新的内存地址**，并将 `DD` 置为 0，最后更新队尾的索引。

同样的，我们也要用锁来进行并发保护。

```c
static void
e1000_recv(void)
{
  while (1) {
    acquire(&e1000_lock);
    uint32 tail = (regs[E1000_RDT] + 1) % RX_RING_SIZE;
    struct rx_desc *rx = &rx_ring[tail];

    // 没有剩余的 rx
    if ((rx->status & E1000_RXD_STAT_DD) == 0) {
      release(&e1000_lock);
      return;
    }

    char *buf = (char *)rx->addr;
    int len = (int)rx->length;

    rx->addr = (uint64)kalloc();
    rx->length = PGSIZE;
    rx->status = 0;
    regs[E1000_RDT] = tail;

    release(&e1000_lock);

    net_rx(buf, len); // 里面会调用 transmit，还会 acquire，不能放临界区
  }
}
```

在一个终端 A 里启动 xv6，然后在另一个终端 B 中运行 `python3 nettest.py rxone`，此时 xv6 中出现以下字样代表测试成功：

```bash
ip_rx: received an IP packet
```

此时运行 `tcpdump -XXnr packets.pcap` 的输出如下：

```bash
reading from file packets.pcap, link-type EN10MB (Ethernet), snapshot length 65536
13:09:53.741395 ARP, Request who-has 10.0.2.15 tell 10.0.2.2, length 46
        0x0000:  ffff ffff ffff 5255 0a00 0202 0806 0001  ......RU........
        0x0010:  0800 0604 0001 5255 0a00 0202 0a00 0202  ......RU........
        0x0020:  0000 0000 0000 0a00 020f 0000 0000 0000  ................
        0x0030:  0000 0000 0000 0000 0000 0000            ............
13:09:53.743486 ARP, Reply 10.0.2.15 is-at 52:54:00:12:34:56, length 28
        0x0000:  5255 0a00 0202 5254 0012 3456 0806 0001  RU....RT..4V....
        0x0010:  0800 0604 0002 5254 0012 3456 0a00 020f  ......RT..4V....
        0x0020:  5255 0a00 0202 0a00 0202                 RU........
13:09:53.816269 IP 10.0.2.2.32787 > 10.0.2.15.2000: UDP, length 3
        0x0000:  5254 0012 3456 5255 0a00 0202 0800 4500  RT..4VRU......E.
        0x0010:  001f 0000 0000 4011 62be 0a00 0202 0a00  ......@.b.......
        0x0020:  020f 8013 07d0 000b 6d6a 7879 7a00 0000  ........mjxyz...
        0x0030:  0000 0000 0000 0000 0000 0000            ............
```

#### 潜在坑点

一开始在实现 `e1000_recv()` 时，我把交给协议栈的 `net_rx()` 也写在了临界区里。这时如果进行测试，一开始的 `acquire()` 会直接 `panic`，根据 `acquire()` 源码可以得知这是因为 CPU 已经持有了该锁。

造成这种现象的原因是 `net_rx()` 中有调用链：`net_rx -> arp_rx -> e1000_transmit`，所以这里的 `e1000_transmit()` 会**再次获取锁**导致 bug。因此，我们不能将 `net_rx()` 写进临界区。

### 2. Part Two: UDP Receive (moderate)

#### 需求分析

UDP 是运输层的一个协议，它允许应用向**指定 IP 地址的主机以及监听端口**发送分组。在本题中我们要完善 xv6 中的 UDP 协议栈。

核心代码在 `kernel/net.c` 中，用于发送分组的部分已经实现，相关的函数为 `sys_send()`。我们要实现的则是**接收分组**的功能。

UDP 协议栈的相关系统调用总共有四个：

- `send(short sport, int dst, short dport, char *buf, int len)`：用于将 `buf` 所指向的 `len` 字节数据作为 UDP 分组的负载部分（payload）发送到 IP 地址为 `dst` 的主机的监听端口 `dport` 上。同时我们也要发送 UDP 分组的源端口号 `sport`，以便接收方可以回复发送方。该系统调用在成功时返回 0，失败时返回 -1。
- `recv(short dport, int *src, short *sport, char *buf, int maxlen)`：用于从 `dport` 对应端口的接收分组队列中取出**到达时间最早的 UDP 分组**，将其源 IP、源端口号分别复制到 `*src` 和 `*sport` 中，并将分组的负载部分复制到 `buf` 中，最多复制 `maxlen` 字节。该系统调用在成功时返回复制的字节数，失败时返回 -1。注意 `src`、`sport` 以及 `buf` 都是**用户空间的虚拟地址**。此外，如果 `dport` 对应的接收分组队列为空，则该系统调用会**阻塞**，直到有新的分组到达。
- `bind(short port)`：用于**设置并初始化一个要监听的端口号** `port`，以便后续的 `recv(port, ...)` 可以从该端口接收分组。
- `unbind(short port)`：与 `bind()` 对应，用于解除对端口号 `port` 的监听。（这一部分不会进行测试，可选实现）

在这里面，`send()` 已经由官方实现可供我们参考，我们要实现 `recv()` 和 `bind()`，具体来讲是补全 `sys_bind()`、`sys_recv()` 和 `ip_rx()` 这三个函数。其中 `ip_rx()` 负责识别分组是否为 UDP 分组、对应端口号是否已经绑定，以及对应的分组队列是否已满（最多 16 个）。**不满足条件的分组全部抛弃**。

#### 实现思路

##### 数据结构设计

从需求中可以看出，我们要维护一个**端口号到分组队列的映射**，支持**新端口号的绑定**以及**分组队列的入队和出队**操作。

因此，我们可以定义一个结构体 `struct udp_port` 来描述一个端口号以及对应的分组队列。它需要有**端口号**、**队列长度**（用来判断是否已满）、**锁**（互斥访问以及等待与唤醒）和**分组队列**的相关结构。

```c
struct udp_port {
  uint16 port;
  uint16 num;
  struct spinlock lock;
  struct packet* head;
  struct packet* tail;
  struct udp_port* next;
};
```

这里我采用链表的结构来维护端口和分组队列，因此设置了 `next` 指针来指向下一个端口号，同时用 `head` 和 `tail` 分别指向分组队列的头和尾，方便进行入队出队。

随后，我们还需要结构体 `struct packet` 来存储一个 UDP 分组的相关信息，包括**分组数据**、**源 IP**、**源端口号**以及**分组长度**。

```c
struct packet {
  char buf[4070];
  struct packet *next;
  int src;
  short sport;
  int len;
};
```

这里要控制 `buf` 的长度，使得 `packet` 能在一个页面内装下。

此外要注意，这两个结构体要定义在 `kernel/net.c` 中，因为 `kernel/net.h` **在用户态也有使用**，但用户态并没有导入 `kernel/spinlock.h`，会导致编译错误。

接下来在 `kernel/net.c` 中加入相关的全局变量：

```c
#define NPORT 16
static struct udp_port ports[NPORT];      
static struct udp_port *portlist;      
```

这里一开始我只维护了链表 `portlist`，但每一个链表项都要申请一个页面，而官方测试对页面使用有严格要求，因此最后采用了**静态数组**的方式，这样不用进行 `kalloc()`。

这里犯懒不想做太多修改，所以仍保留了链表结构，实际上用到链表的地方都可以替换为数组遍历，这样更统一。

##### `bind()`——端口的绑定与初始化

接下来就可以实现 `sys_bind()` 了，它的功能就是**绑定一个新的端口号，并初始化对应的分组队列**。

整体思路很简单，先获取端口号参数 `portNum`，然后遍历 `ports` 数组。如果端口号没绑定过，则找到一个空闲的 `udp_port` 结构体，初始化它的各个字段即可。

由于测试中的端口号普遍都大于 1000，因此我们可以用端口号为 0 来标记一个 `udp_port` 结构体是否空闲。

为了兼容一开始的链表思路，所以我在此处加入了对于 `portlist` 和 `next` 的维护。

```c
uint64
sys_bind(void)
{
  //
  // Your code here.
  //
  int portNum;
  argint(0, &portNum);

  for(int i = 0; i < NPORT; i++){
    if(ports[i].port == portNum)
      return 0;                              // 已绑定过
    if(ports[i].port == 0){                 
      initlock(&ports[i].lock, "spinlock");
      ports[i].port = portNum;
      ports[i].head = ports[i].tail = 0;
      ports[i].num = 0;
      ports[i].next = portlist;              // 挂到链表头
      portlist = &ports[i];
      return 0;
    }
  }
  return -1;
}
```

##### `ip_rx()`——分组的筛选与入队

`ip_rx()` 由 `net_rx()` 调用，负责接收**网络层协议为 IP 的分组**。

`ip_rx()` 只接收 **UDP 协议的分组**，并且只接收**端口号已经绑定的分组**，同时还要检查对应的分组**队列是否已满**（最多 16 个）。任何不满足条件的分组全部抛弃，最后要记得释放缓冲区 `buf`。

首先让我们了解一个 UDP 分组的结构：它由**以太网帧头**，**IP 头**，**UDP 头**以及**负载数据**组成：

| 以太网头（eth） | IP 头（ip） | UDP 头（udp） | 负载（payload） |
|---|---|---|---|

其中只有**负载部分**是我们需要的数据，其他三部分都是协议头部，包含了分组的源 IP、源端口号、目的端口号等信息。

由于 `net_rx()` 已经筛选出了**网络层协议为 IP 的分组**，因此以太网头和 IP 头一定存在，只需根据 IP 头判断是否为 UDP 协议即可。

对于三个协议头部的获取，可以参考 `sys_send()` 的实现，采用强制类型转换的方式来获取对应的结构体指针。

首先根据 IP 头的 `ip_p` 字段判断**是否为 UDP 协议**，如果不是则直接抛弃。

然后提取 UDP 头，判断**目的端口号** `dport` 是否已经绑定，如果没有则直接抛弃。

随后获取该端口的锁，判断**分组队列是否已满**，如果已满则直接抛弃。

以上条件都通过时，我们就可以将分组入队了，入队时要注意**分配新的内存**来存储负载数据，还要更新**队列长度**。

对于一个分组，我们需要存储它的**负载数据（payload）、源 IP、源端口号以及长度**，这里要注意长度的计算，`len` 是包含了三个协议头的长度，要去掉。

最后，我们要**唤醒对应的进程**，释放锁，并释放缓冲区 `buf`。

这里要注意协议头通常采用**大端存储**，而我们的 CPU 是**小端存储**，因此可以用官方提供的 `ntohs()` 和 `ntohl()` 来分别转换 2 字节和 4 字节的数据。

```c
void
ip_rx(char *buf, int len)
{
  // don't delete this printf; make grade depends on it.
  static int seen_ip = 0;
  if(seen_ip == 0)
    printf("ip_rx: received an IP packet\n");
  seen_ip = 1;

  //
  // Your code here.
  //

  struct eth *eth = (struct eth *) buf;
  struct ip *ip = (struct ip *)(eth + 1);

  if (ip->ip_p != IPPROTO_UDP) {  
    // 不是 UDP 协议，直接抛弃
    kfree(buf);
    return;
  }

  // 判断 UDP 端口号是否对应
  struct udp *udp = (struct udp *)(ip + 1);
  int portNum = ntohs(udp->dport);
  struct udp_port *port = portlist;
  while (1) {
    if (port == 0) {
      kfree(buf);
      return;
    }
    if (port->port == portNum) {
      break;
    }
    port = port->next;
  }

  // 端口号对应，检查数量后插入
  acquire(&port->lock);
  if (port->num >= 16) {
    release(&port->lock);
    kfree(buf);
    return;
  }
  struct packet *packet = (struct packet *)kalloc();
  memmove(packet->buf, (char *)(udp + 1), len - sizeof(struct eth) - sizeof(struct ip) - sizeof(struct udp));
  packet->len = ntohs(udp->ulen) - sizeof(struct udp);
  packet->next = 0;
  packet->src = ntohl(ip->ip_src);
  packet->sport = ntohs(udp->sport);
  if (port->tail == 0) {
    port->head = packet;
    port->tail = packet;
  } else {
    port->tail->next = packet;
    port->tail = packet;
  }
  port->num++;
  kfree(buf);

  // 唤醒对应进程
  wakeup(port);
  release(&port->lock);
}
```

##### `recv()`——分组出队与复制

`sys_recv()` 是 `recv()` 系统调用的实现，它的功能是**从指定端口号的分组队列中取出最早到达的分组**，并将其源 IP、源端口号以及负载数据复制到**用户空间**。

首先是获取所有参数，然后根据 `dport` 在 `ports` 数组中找到对应的端口号，如果没有则直接返回 -1。

接下来获取端口号的锁，判断分组队列是否为空，如果为空则**阻塞等待**，直到有新的分组到达。

队列非空时，取出**队头分组**。注意 `src`、`sport` 和 `buf` 都是**用户空间的虚拟地址**，必须有用户页表进行映射，因此要用 `copyout()` 来进行复制。

最后记得释放**锁**和**分组内存（packet）**。

```c
uint64
sys_recv(void)
{
  //
  // Your code here.
  //
  int dport;
  int maxlen;
  uint64 srcaddr;
  uint64 sportaddr;
  uint64 bufaddr;
  argint(0, &dport);
  argaddr(1, &srcaddr);
  argaddr(2, &sportaddr);
  argaddr(3, &bufaddr);
  argint(4, &maxlen);

  // 找到端口号对应的 port
  struct udp_port *port = portlist;
  while (1) {
    if(port == 0) {
      return -1;
    }
    if (port->port == dport) {
      break;
    }
    port = port->next;
  }

  // 如果分组为空则阻塞
  acquire(&port->lock);
  while(port->num == 0) {
    sleep(port, &port->lock);
  }

  // 取出包
  struct packet *packet = port->head;
  port->head = port->head->next;
  if (port->head == 0) {
    port->tail = 0;
  }
  port->num--;

  // 复制到用户空间
  copyout(myproc()->pagetable, srcaddr, (char *)&packet->src, 4);
  copyout(myproc()->pagetable, sportaddr, (char *)&packet->sport, 2);
  int bytes = (packet->len > maxlen) ? maxlen : packet->len;
  copyout(myproc()->pagetable, bufaddr, packet->buf, bytes);

  kfree((void *)packet);
  release(&port->lock);
  return bytes;
}
```

到此，我们就完成了该部分的全部实现。

##### 测试方法

先在窗口 A 中运行 `python3 nettest.py grade`，然后在窗口 B 中运行 xv6 并执行 `nettest grade`，此时窗口 B 会输出测试结果：

```bash
txone: sending one packet
arp_rx: received an ARP packet
ip_rx: received an IP packet
ping0: starting
ping0: OK
ping1: starting
ping1: OK
ping2: starting
ping2: OK
ping3: starting
ping3: OK
dns: starting
DNS arecord for pdos.csail.mit.edu. is 128.52.129.126
dns: OK
free: OK
```

#### 潜在坑点

##### 页面使用的严格限制

如果我们没有采用静态数组来存端口，而是用一开始的链表结构，对每一个元素都 `kalloc()` 一个页面，那么测试时会出现这样的错误：

```bash
free: FAILED -- lost too many free pages 32268 (out of 32305)
```

通过观察 `user/nettest.c`，可以看到如下代码：

```c
if ((free1 = countfree()) + 32 < free0) {
  printf("free: FAILED -- lost too many free pages %d (out of %d)\n", free1, free0);
} 
```

可以看到，官方测试要求最多用掉 32 个页面。这里 TX 环的缓冲区就要占掉 16 个页面。

此外，在 `ping3` 测试中会 `fork()` 出一个子进程，占用若干页面，并且子进程通过 `exit()` 退出。这会走到 `kexit()`，只会将子进程设为 `ZOMBIE` 状态，并**不会释放掉子进程占用的页面**。

实际上，要释放子进程的空间，必须由父进程使用 `wait()` 来走 `kernel/proc.c` 的 `kwait()`，但测试中并没有调用 `wait()`，因此子进程占用的页面不会被释放掉，这会占用掉若干页。

这里 RX 环的缓冲区不占用 32 个页面，因为它在 `e1000_init()` 中就已经分配，`free1` 和 `free0` 都计入。

可以看出固有的页面使用已经很高，因此我们不能再用 `kalloc()` 来为端口号分配页面了，必须采用静态数组。

##### sleep 前必须持有锁

一开始觉得 `sleep()` 时会一直占着锁，导致其他进程无法更新队列状态，也就永远无法唤醒。因此为 `udp_port` 增加了一个用来阻塞和唤醒进程的 `sleeplock`。但测试时发现会触发 `release()` 的 `panic`。

通过阅读 `sleep()` 的源码可以发现如下的结构：

```c
void
sleep(void *chan, struct spinlock *lk)
{
  struct proc *p = myproc();
  
  // Must acquire p->lock in order to
  // change p->state and then call sched.
  // Once we hold p->lock, we can be
  // guaranteed that we won't miss any wakeup
  // (wakeup locks p->lock),
  // so it's okay to release lk.

  acquire(&p->lock);  //DOC: sleeplock1
  release(lk);

  // Go to sleep.
  p->chan = chan;
  p->state = SLEEPING;

  sched();

  // Tidy up.
  p->chan = 0;

  // Reacquire original lock.
  release(&p->lock);
  acquire(lk);
}
```

可以看到，`sleep()` 实际上会**自动释放掉传入的锁** `lk`，并在被唤醒后**重新获取锁**。而我一开始并没有在 `sleep()` 前获取 `sleeplock`，因此会触发 `release()` 的 `panic`。

这样看来，我们不需要为 `udp_port` 额外加一个 `sleeplock`，只要在 `sleep()` 前获取 `udp_port` 的锁即可，`sleep()` 过程中会自动释放掉。

---

## 测试方法与结果
使用：

```bash
make grade
```
来运行官方测试，这将会对**所有任务**进行测试。

以下是我的完整测试结果：

```bash
== Test running nettest ==
$ make qemu-gdb
(19.1s)
== Test   nettest: txone ==
  nettest: txone: OK
== Test   nettest: arp_rx ==
  nettest: arp_rx: OK
== Test   nettest: ip_rx ==
  nettest: ip_rx: OK
== Test   nettest: ping0 ==
  nettest: ping0: OK
== Test   nettest: ping1 ==
  nettest: ping1: OK
== Test   nettest: ping2 ==
  nettest: ping2: OK
== Test   nettest: ping3 ==
  nettest: ping3: OK
== Test   nettest: dns ==
  nettest: dns: OK
== Test   nettest: free ==
  nettest: free: OK
== Test time ==
time: OK
Score: 171/171
```

---

## 总结与回顾

在本实验的第一部分，我们阅读了 E1000 网卡设备的相关文档并了解了设备接口，同时动手实现了驱动程序中**发送与接收分组**的函数，体会了如何通过内存映射寄存器来与设备进行交互。

在第二部分，我们完善了 UDP 协议栈的接收端，实现了**端口号的绑定以及与分组队列的映射**、**分组的入队出队**等功能，进一步体会了操作系统中**网络协议栈的实现**。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)
- [Software Developer's Manual](https://pdos.csail.mit.edu/6.1810/2025/readings/8254x_GBe_SDM.pdf)
