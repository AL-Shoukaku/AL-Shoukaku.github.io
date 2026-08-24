---
title: 2025 MIT 6.1810 Lab 1:Xv6 and Unix Utilities
date: 2026-08-23 20:00:00
tags:
  - MIT 6.1810
  - 操作系统
categories:
  - MIT 6.1810
description: 我的 MIT 6.1810 的 lab1 全记录，主题是启动 xv6 和实现 5 个 Unix 工具。
---
# MIT 6.1810 Lab 1: Xv6 and Unix Utilities

---

## 实验概览

作为 MIT 6.1810 的第一个实验，本 lab 的主要目的是配置与熟悉 xv6 的开发环境，核心内容是实现 5 个 Unix 工具：`sleep`、`sixfive`、`memdump`、`find` 和 `find -exec`。

详细的代码实现在[我的 GitHub 仓库](https://github.com/AL-Shoukaku/xv6-2025)

---

## 详细实现

### 1. Boot xv6(easy)

这部分主要是**配置开发环境**并学会**启动 xv6**。我选择在 Windows 11 上使用 **WSL2（Ubuntu 24.04）** 进行开发，这也是官方推荐的实验环境之一。

WSL2 的安装可以参考[官方文档](https://learn.microsoft.com/zh-cn/windows/wsl/install)

#### 环境配置

根据官方的教程，运行以下命令来完成工具链的配置。

```bash
$ sudo apt-get update && sudo apt-get upgrade
$ sudo apt-get install git build-essential gdb-multiarch qemu-system-misc gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu
```

MIT 6.1810 使用Git来管理实验代码，可以通过以下命令来克隆实验代码仓库：

```bash
$ git clone git://g.csail.mit.edu/xv6-labs-2025
```

至此便完成了实验开发环境的配置。

#### 启动 xv6

在 `xv6-labs-2025` 目录下运行以下命令来启动 xv6：

```bash
$ make qemu
```

启动后会出现如下字样，代表 xv6 已经成功启动：

```bash
xv6 kernel is booting

hart 2 starting
hart 1 starting
init: starting sh
$ #可以在这里开始输入命令
```

如果想要退出 xv6，可以按下 `Ctrl + A` 然后按下 `X`。


### 2. sleep(easy) — 最简单的起点

**涉及文件**：`user/sleep.c`

这是我们要实现的第一个功能，它并不复杂，官方也给出了大量的 hint，很适合用来熟悉 xv6 的开发流程。

#### 需求分析

该任务要在 xv6 中实现 `sleep` 程序，用来让当前进程**暂停指定时长**，其单位是两次计时器中断之间的间隔时间，由 xv6 系统定义。

需要注意：如果用户**忘记传入参数**，程序应当打印出错误信息。

#### 实现思路

根据 hint，我们可以先看看 `user/` 目录下其它几个程序（如 `ls.c`、`echo.c`）是如何**获取命令行参数**的，可以发现它们都有如下结构：

```C
int
main(int argc, char *argv[])
{
    //code something...
}
```

其中 `argc` 代表**参数个数**，`argv` 是一个字符串数组，存储了**所有参数**，我们可以通过 `argv[i]` 访问第 i 个参数。

需要**注意**的是，`argv[0]` 一般情况下是**程序的名字**，因此我们需要从 `argv[1]` 开始获取用户传入的参数。

在本题中，我们可以先用 `argc` 判断用户是否传入了时间参数，再通过 `argv[1]` 以字符串形式获取该参数。

根据 hint，我们可以使用 `atoi()` 将其转换为**整数**，再通过 `pause()` **系统调用**让当前进程暂停指定时长。这两个函数的实现可以分别在 `user/ulib.c` 和 `kernel/sysproc.c` 中找到。

综合以上思路，具体的代码实现如下：

```C
#include "kernel/types.h"
#include "kernel/stat.h"
#include "user/user.h"

int
main(int argc, char *argv[])
{
    if (argc <= 1) {
        write(1, "no arguments!\n", 14);
        exit(1);
    }
 
    int time = atoi(argv[1]);
    if (pause(time) < 0) {
        write(1, "sleep fail\n", 11);
        exit(1);
    }
 
    exit(0);
}
```

此外，为了在启动 xv6 时能编译 `user/sleep.c`，我们还需要将其添加到 `Makefile` 中，形式如下：

```Makefile
UPROGS=\
    $U/_cat\
    $U/_echo\
    ... 
    $U/_sleep\
```

值得一提的是，如果传入**负数**，`atoi()` 会返回 0，相当于 `sleep 0`。


### 3. sixfive(Moderate) — 文本解析的细节

**文件**：`user/sixfive.c`

#### 需求分析

该功能以**文件名**作为参数，对每个文件打印其中**为 5 或 6 的倍数**的数字。

本题中“数字”的定义是**被分隔符分隔开的一串十进制数**，分隔符包括 `" -\r\t\n./,"`（注意最前面是一个空格，不要漏掉）。同时，文件的开始和结尾也视为一个隐藏的分隔符。

这样的定义可能难以理解，我们可以用 `user/sixfive.txt` 这个文件作为例子来理解，内容如下：
```txt
5
3
127
100
18-4
06
```
其中，`5` 位于文件开头和 `\n` 这两个**分隔符之间**，因此是数字；`3`、`127`、`100` 位于两个 `\n` 之间，也是数字；`18` 和 `4` 位于 `-` 和 `\n` 之间；`06` 位于 `\n` 和文件结尾之间。因此它们都是数字。

再举一些反例：
```txt
11/4 5a14
19,1`9-810
```
这里面的数字包括 `11,4,19,810`。其中 `5` 夹在空格和 `a` 之间，由于 `a` **不是分隔符**，因此它不算数字；同理，`14`、`1`、`9` 也不是数字。

#### 实现思路

实现这个功能的关键点就是 xv6 中的**文件操作**和**字符串解析**。

对于文件的操作这里主要涉及两个：
- **打开文件**：使用 `open(char *file, int flags)` 系统调用打开文件，返回文件描述符（一个整数），如果打开失败则返回 -1。其中 `open()` 的第一个参数是**文件名**，第二个参数是**打开模式**（可以在 `kernel/fcntl.h` 中查看）。
- **读取文件**：使用 `read(int fd, char *buf, int n)` 系统调用读取文件内容，返回实际读取的字节数，如果读取失败则返回 -1。其中 `read()` 的第一个参数是**文件描述符**，第二个参数是**缓冲区指针**，第三个参数是**要读取的字节数**。

对于每一个文件，先使用 `open()` 打开，再使用 `read()` 读取内容。为了方便处理，可以**一次只读一个字符**，通过 `read()` 的**返回值是否为 1** 来判断是否读到文件末尾。

对于字符串的解析，可以将字符分为**分隔符**、**数字**和**其它**三类，同时维护标志位 `hasNum`、`hasOther` 和字符数组 `str`，用来记录两个分隔符之间的数字情况。

- **分隔符**：如果当前字符是分隔符，则根据 `hasNum`、`hasOther` 判断两个分隔符之间是否有数字；若有则将 `str` 中保存的数打印出来，随后重置 `str`、`hasOther` 和 `hasNum`，准备处理下一个数字。
- **数字**：如果当前字符是数字，且 `hasOther == 0`，则将其加入 `str`，并将 `hasNum` 置为 1，表示当前分隔符之间有数字。
- **其它**：如果当前字符是其它字符，则将 `hasOther` 置为 1，表示当前分隔符之间有非数字字符。

完整的代码实现如下：

```C
int isSeparators(char c) {
    char separators[] = " -\r\t\n./,";
    for (int i = 0;i < strlen(separators);i++) {
        if (c == separators[i]) {
            return 1;
        }
    }
    return 0;
}

int isNum(char c) {
    if (c >= '0' && c <= '9') {
        return 1;
    }
    return 0;
}

int str2int(char *s) {
    int num = 0;
    for (int i = 0;i < strlen(s);i++) {
        num = num * 10;
        num += s[i] - '0';
    }
    return num;
}

int
main(int argc, char *argv[]) 
{
    if (argc <= 1) {
        write(1, "please enter filename!\n", 23);
        exit(1);
    }

    for (int i = 1; i < argc; i++) {
        int fd = open(argv[i], O_RDONLY);
        char *c = (char *)malloc(sizeof(char *));
        *c = '\0';
        char *str = (char *)malloc(sizeof(char *));
        *str = '\0';
        int hasNum = 0; //分隔符间是否有数字
        int hasOther = 0;
        while (read(fd, c, 1) == 1) {
            if (isSeparators(*c)) {
                //两个分隔符间有数字，且是5或6的倍数
                if (hasNum && !hasOther && (str2int(str) % 5 == 0 || str2int(str) % 6 == 0)) {
                    while (*str == '0' && *(str + 1) != '\0') {
                        str++;
                    }
                    write(1, str, strlen(str));
                    write(1, "\n", 1);
                }
                hasNum = 0;
                *str = '\0';
                hasOther = 0;
            } else if (isNum(*c) && hasOther == 0) {
                hasNum = 1;
                str[strlen(str) + 1] = '\0';
                str[strlen(str)] = *c;
            } else {
                //不是数字也不是分隔符，则不满足要求，不输出
                hasOther = 1;
                hasNum = 0;
                *str = '\0';
            }
        } 
        // 文件的结尾也是分隔符！
        if (hasNum && (str2int(str) % 5 == 0 || str2int(str) % 6 == 0)) {
            while (*str == '0' && *(str + 1) != '\0') {
                str++;
           }
 
            write(1, str, strlen(str));
            write(1, "\n", 1);
        }
    }
    exit(0);
}
```

与 `sleep` 同理，最后还要将 `sixfive.c` 添加到 `Makefile` 中。

### 4. memdump(easy) — 指针与内存布局

**文件**：`user/memdump.c`

#### 需求分析

本题的任务是实现`user/memdump.c`中的`memdump(char *fmt, char *data)`函数。

该函数的功能是根据`fmt`中指定的格式来处理`data`所指向的数据，并打印出来。`fmt`中包含了若干个格式字符，每个字符对应一种数据类型，具体如下：
- `i`: 打印32bit的十进制数
- `p`: 打印64bit的十六进制数
- `h`: 打印16bit的十进制数
- `c`: 打印8bit的字符
- `s`: 前 8 字节存放一个字符串指针，打印该指针指向的字符串
- `S`: 打印字符串，以 `\0` 结尾

#### 实现思路

这道题的关键在于**指针的使用**：大致思路是**逐个解析** `fmt` 中的字符，根据其类型对 `data` 做对应的**类型转换**并打印；每处理完一个字符，还要将 `data` 指针向后移动对应的字节数，以便处理下一个数据。

具体的实现如下：
```C
void
memdump(char *fmt, char *data)
{
  // Your code here.
    while (*fmt) {
        switch(*fmt) {
            case 'i':
                int* i = (int *)data;
                printf("%d\n", *i);
                data += 4;
                break;
            case 'p':
                long *p = (long *)data;
                data += 8;
                printf("%lx\n", *p);
                break;
            case 'h':
                short* h = (short *)data;
                data += 2;
                printf("%d\n", *h);
                break;
            case 'c':
                printf("%c\n", *data);
                data++;
                break;
            case 's':
                char *s = *((char **)data);
                for (int i = 0;i < 8;i++) {
                    printf("%c", *s);
                    s++;
                }
                data += 8;
                printf("\n");
                break;
            case 'S':
                printf("%s\n", data);
                data += strlen(data) + 1;
                break;
            default:
                printf("format error\n");
        }
        fmt++;
    }
}
```

### 5. find(Moderate) — 递归与目录遍历

**文件**：`user/find.c`

#### 需求分析

`find`的功能是指定要查找的目录和要查找的文件名，然后在指定目录下进行**递归查找**，并打印出所有匹配的文件路径。

#### 实现思路

整体思路并不难：对目录下的所有文件进行**递归遍历**，再使用 `strcmp()` 判断文件名是否匹配即可，核心难点在于**如何遍历目录**。根据 hint，我们可以从 `user/ls.c` 中找到相关实现。

```C
  char buf[512], *p;
  int fd;
  struct dirent de;
  struct stat st;

  //打开文件
  if((fd = open(path, O_RDONLY)) < 0){
    fprintf(2, "ls: cannot open %s\n", path);
    return;
  }

  //获取文件的状态
  if(fstat(fd, &st) < 0){
    fprintf(2, "ls: cannot stat %s\n", path);
    close(fd);
    return;
  }
```

在 `ls` 中，首先使用 `open()` 根据路径获取**文件描述符** `fd`，再使用 `fstat()` 根据 `fd` 获取文件的**状态信息** `st`，其类型为 `struct stat`，具体定义如下：

```C
#define T_DIR     1   // Directory
#define T_FILE    2   // File
#define T_DEVICE  3   // Device
//status的简写
struct stat {
  int dev;     // File system's disk device
  uint ino;    // Inode number
  short type;  // Type of file
  short nlink; // Number of links to file
  uint64 size; // Size of file in bytes
};
```

可以看到其中包含文件的类型、Inode 号、大小等信息，我们可以用 `st.type` 判断当前文件是否为目录。

`ls`中采用以下方式遍历一个目录：
```C
//将当前目录的路径复制到buf中并在末尾加上'/'
if(strlen(path) + 1 + DIRSIZ + 1 > sizeof buf){
    printf("ls: path too long\n");
    break;
}
strcpy(buf, path);
p = buf+strlen(buf);
*p++ = '/';

//逐个读取该目录的所有目录项
while(read(fd, &de, sizeof(de)) == sizeof(de)){
    if(de.inum == 0)
    continue;
    memmove(p, de.name, DIRSIZ);    //将文件名加到buf末尾
    p[DIRSIZ] = 0;
    if(stat(buf, &st) < 0){
    printf("ls: cannot stat %s\n", buf);
    continue;
    }
    printf("%s %d %d %d\n", fmtname(buf), st.type, st.ino, (int) st.size);
}
```

首先将当前路径复制到 `buf` 中并在末尾加上 `/`。对于目录文件来说，它的内容就是一个个**目录项**，类型为 `struct dirent`，其定义在 `kernel/fs.h` 中：
```C
struct dirent {
  ushort inum;
  char name[DIRSIZ];
};
```

本质上就是将**文件名与其 Inode 号对应起来**。我们可以通过 `read()` 一次读取 `sizeof(de)` 个字节来获取一个目录项，再用 `de.name` 获取文件名、`de.inum` 获取 Inode 号。

如果想**打开**某个文件，可以先把它的名字拼到当前路径后面，再使用 `open()` 打开，最后用 `fstat()` 获取它的状态信息。

以上就是遍历一个目录的方法，由此我们可以梳理出`find`的实现思路：

1. 对于一个给定的路径`path`，可以直接将文件名与要查找的文件名进行比较，如果匹配则打印出路径。
2. 接下来使用`open()`和`fstat()`来打开文件并获取**类型信息**，如果是**目录**，则接下来进行递归遍历。
3. 逐个遍历目录中的所有目录项，并将其加入到`path`中，然后再用`find()`来进行递归查找。

具体的代码实现如下：
```C
void find(char *path, char *name) {
    int fd;
    struct stat st;
    char buf[512], *p;
    struct dirent de;
    if (strcmp(fmtname(path), name) == 0) {
        printf("%s\n", path);
    }
    if((fd = open(path, O_RDONLY)) < 0){
        fprintf(2, "find: cannot open %s\n", path);
        return;
    }

    if(fstat(fd, &st) < 0){
        fprintf(2, "find: cannot stat %s\n", path);
        close(fd);
        return;
    }
    // 对于非目录的直接关闭fd，否则会数量不够 
    if (st.type != T_DIR) {
        close(fd);
        return;
    }
            
    if(strlen(path) + 1 + DIRSIZ + 1 > sizeof buf){
        printf("find: path too long\n");
        return;
    }
    strcpy(buf, path);
    p = buf+strlen(buf);
    *p++ = '/';
    while (read(fd, &de, sizeof(de)) == sizeof(de)) {
        if (de.inum == 0) {
            continue;
        }
        if (strcmp(de.name, ".") == 0 || strcmp(de.name, "..") == 0) {
            continue;
        }
        memmove(p, de.name, DIRSIZ);
        p[strlen(de.name)] = '\0';
        find(buf, name);
    }
    close(fd);
    return;
}
```

#### 潜在坑点

在 xv6 中使用 `ls` 时，我们会发现它打印出了 `.` 和 `..`，这代表遍历目录时会遇到**当前目录**和**父目录**。如果不加以判断，`find` 就会陷入**无限递归**，因此遍历时需要跳过这两个目录。

此外，`find()` 需要 `open()` 打开多个文件，因此每次打开后都要记得用 `close()` 关闭文件描述符，否则会出现**文件描述符不够用**的情况。

当我们根据 `path` 获取文件名时，可以借用 `ls.c` 里的 `fmtname()` 函数，它本质上返回最后一个 `/` 之后的文件名。但要注意，`ls.c` 为了打印整齐会把文件名补齐到固定长度，这会干扰 `strcmp()` 的判断，因此需要修改：
```C
char* fmtname(char *path)
{
  //static char buf[DIRSIZ+1]; 这里用不到
  char *p;

  // Find first character after last slash.
  for(p=path+strlen(path); p >= path && *p != '/'; p--)
    ;
  p++;

//ls原版里会凑长度，这里不能，否则影响strcmp的判断
    return p;
  // Return blank-padded name.
  //if(strlen(p) >= DIRSIZ)
  //  return p;
  //memmove(buf, p, strlen(p));
  //memset(buf+strlen(p), ' ', DIRSIZ-strlen(p));
  //buf[sizeof(buf)-1] = '\0';
  //return buf;
}
```

### 6. find -exec(Moderate) — fork 与 exec

**文件**：`user/find.c`

#### 需求分析

本题要为之前实现的 `find` 指令新增一个 `-exec` 选项，其格式为：
```bash
find <directory> <string1> <string2> ... -exec <command> <arg1> <arg2> ...
```
具体功能是执行 `-exec` 后面的指令，并把 `find` 找到的文件路径作为参数传给该指令。

举个例子：
```bash
find . hello -exec echo we find
```
假设find找到了`./hello`和`./dir/hello`,这两个将作为`echo`的参数，最终执行：
```bash
echo we find ./hello ./dir/hello
```

#### 实现思路

首先需要识别 `find` 命令是否包含 `-exec` 选项；若包含，还要区分哪些是 `find` 的参数、哪些是 `-exec` 的参数。同时还需要维护一个新的参数数组 `newArgv[]`，用来存储 `-exec` 对应的命令及参数。

我们可以通过在`main()`中遍历`argv[]`来实现这一点:
```C
int main(int argc, char *argv[])
{
    if (argc < 3) {
        write(2, "argument error!\n", 15);
        exit(1);
    }
    int pos = 0;
    for (int i = 3;i < argc;i++) {
        if (strcmp("-exec", argv[i]) == 0) {
            pos = i;
            break;
        }
    }

    //存在-exec参数
    if (pos > 0) {
        char* newArgv[MAXARG];
        int argNum = 0;
        //先构建指令参数
        for (int i = pos + 1; i < argc; i++) {
            newArgv[argNum++] = argv[i];
        }
        //构建find指令找到的文件名作为参数
        for (int i = 2; i < pos; i++) {
            findexec(argv[1], argv[i], newArgv, &argNum);
        }

        int pid = fork();
        if (pid > 0) {
            wait((int *) 0);
        } else if (pid == 0){
           exec(argv[pos + 1], newArgv);
           printf("findexec: exec error!\n");
           exit(1);
        } else {
            printf("fork error!\n");
            exit(1);
        }
        exit(0);
    }

    //不存在-exec参数，正常执行
    char* path = argv[1];
    for (int i = 2;i < argc;i++) {
        char* filename = argv[i];
        find(path, filename);
    }
    exit(0);
}
```

接下来要做的就是构建传给 `-exec` 命令的参数数组 `newArgv[]`，它由两部分组成：第一部分是命令行中 `-exec` 后面的参数，这在前面的 `argv[]` 遍历中已经处理；第二部分是 `find` 找到的文件路径。

由于之前已经实现了 `find()`，这里只需在此基础上稍加修改：传入参数数组 `newArgv[]` 和参数个数 `argNum`，并把原来打印路径的地方改为将路径加入参数数组。

具体的实现如下：
```C
void findexec(char *path, char *name, char **argv, int *argNum) {
    int fd;
    struct stat st;
    char buf[512], *p;
    struct dirent de;
    if (strcmp(fmtname(path), name) == 0) {
        if (*argNum + 1 == MAXARG) {
            printf("findexec: too much argument!\n");
            return;
        }
        //这里不能直接用path！因为*path的值后面会被改变！
        char s[512];
        strcpy(s, path);
        argv[*argNum] = s;
        *argNum += 1;
    }

    if((fd = open(path, O_RDONLY)) < 0){
        fprintf(2, "findexec: cannot open %s\n", path);
        return;
    }

    if(fstat(fd, &st) < 0){
        fprintf(2, "findexec: cannot stat %s\n", path);
        close(fd);
        return;
    }
    // 对于非目录的直接关闭fd，否则会数量不够 
    if (st.type != T_DIR) {
        close(fd);
        return;
    }
            
    if(strlen(path) + 1 + DIRSIZ + 1 > sizeof buf){
        printf("findexec: path too long\n");
        return;
    }
    strcpy(buf, path);
    p = buf+strlen(buf);
    *p++ = '/';
    while (read(fd, &de, sizeof(de)) == sizeof(de)) {
        if (de.inum == 0) {
            continue;
        }
        if (strcmp(de.name, ".") == 0 || strcmp(de.name, "..") == 0) {
            continue;
        }
        memmove(p, de.name, DIRSIZ);
        p[strlen(de.name)] = '\0';
        findexec(buf, name, argv, argNum);
    }
    close(fd);
 
}
```

构建完参数数组后，就可以运行 `-exec` 命令了：先使用 `fork()` 创建子进程，在子进程中用 `exec()` 执行命令并把参数数组传入，父进程则调用 `wait()` 等待子进程结束。

```C
int pid = fork();
if (pid > 0) {
    wait((int *) 0);
} else if (pid == 0){
    exec(argv[pos + 1], newArgv);
    printf("findexec: exec error!\n");
    exit(1);
} else {
    printf("fork error!\n");
    exit(1);
}
exit(0);
```

至此，`find -exec` 的实现就完成了。

#### 潜在坑点

在 `findexec()` 中，如果找到了与文件名相匹配的 `path`，不能直接 `argv[*argNum] = path`。因为 `argv[]` 是指针数组，保存的是指针值；而 `path` 指向的内容在后续递归中会被覆盖，所以需要**拷贝一份** `path` 的字符串到新的缓冲区中，再把新缓冲区的指针存入 `argv[]`。

---

## 测试方法与结果
运行 `make grade` 来执行官方测试，这会对**所有任务**进行测试。

如果想要针对**单个任务**进行测试，可以使用以下命令：
```bash
make GRADEFLAGS=name grade # name 为要测试的任务名，如 sleep
```
需要注意的是，lab1 对 `find` 的测试中包含了 `find -exec` 的测试点，因此如果尚未实现 `find -exec`，会有部分测试点无法通过。

以下是我的完整测试结果：
```bash
== Test sleep, no arguments ==
$ make qemu-gdb
sleep, no arguments: OK (3.3s)
== Test sleep, returns ==
$ make qemu-gdb
sleep, returns: OK (0.8s)
== Test sleep, makes syscall ==
$ make qemu-gdb
sleep, makes syscall: OK (1.1s)
== Test sixfive_test ==
$ make qemu-gdb
sixfive_test: OK (0.9s)
== Test sixfive_readme ==
$ make qemu-gdb
sixfive_readme: OK (1.3s)
== Test sixfive_all ==
$ make qemu-gdb
sixfive_all: OK (1.3s)
== Test memdump, examples ==
$ make qemu-gdb
memdump, examples: OK (0.6s)
== Test memdump, format ii, S, p ==
$ make qemu-gdb
memdump, format ii, S, p: OK (0.8s)
== Test find, in current directory ==
$ make qemu-gdb
find, in current directory: OK (1.2s)
== Test find, in sub-directory ==
$ make qemu-gdb
find, in sub-directory: OK (1.1s)
== Test find, recursive ==
$ make qemu-gdb
find, recursive: OK (1.1s)
== Test exec ==
$ make qemu-gdb
exec: OK (0.8s)
== Test exec, multiple args ==
$ make qemu-gdb
exec, multiple args: OK (0.7s)
== Test exec, recursive find ==
$ make qemu-gdb
exec, recursive find: OK (1.4s)
== Test time ==
time: OK
Score: 131/131
```

---

## 总结与回顾

在 lab1 中，我们熟悉了整个实验开发环境，并实现了 5 个 Unix 工具：
1. `sleep`：学习如何获取命令行参数，并使用系统调用来实现进程的暂停。
2. `sixfive`：学习了使用`open()`和`read()`来读取文件内容，并实现了字符串的解析。
3. `memdump`：熟悉了C语言中的指针操作与类型转换，实现了根据格式打印内存数据的功能。
4. `find`：学习了如何遍历目录，并实现了递归查找文件的功能。
5. `find -exec`：学习了如何使用`fork()`和`exec()`来创建子进程并执行命令。

---

## 参考资料

- [MIT 6.1810 课程主页](https://pdos.csail.mit.edu/6.1810/2025/index.html)
- [xv6 Book (RISC-V)](https://pdos.csail.mit.edu/6.1810/2025/xv6/book-riscv-rev5.pdf)

