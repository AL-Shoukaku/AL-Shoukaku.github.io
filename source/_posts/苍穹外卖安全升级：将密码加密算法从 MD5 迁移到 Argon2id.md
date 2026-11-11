---
title: 苍穹外卖安全升级：将密码加密算法从 MD5 迁移到 Argon2id
date: 2026-11-11 22:00:00
tags:
  - 苍穹外卖
  - Java
  - 密码加密算法
categories:
  - 苍穹外卖二次开发
description: 这篇文章记录了我将苍穹外卖的密码加密算法从 MD5 迁移到 Argon2id 的过程。
---
# 苍穹外卖安全升级：将密码加密算法从 MD5 迁移到 Argon2id

## 前言

苍穹外卖是黑马程序员用于教学的经典 Spring Boot 项目，由于其容易上手，业务闭环等特点，很多人都选择将它写在自己的简历上。

因此，对于这样一个“烂大街”的项目，要想在简历上有一定竞争力，必须自己独立做一些二次开发。

我让 AI 帮我分析了一下都有哪些升级点，其中一个就是**密码加密方式**，我了解了相关内容后，将加密方式**从 MD5 迁移到 Argon2id**。这篇文章记录了我的整个升级过程。

## 现有问题与目标

苍穹外卖使用 **MD5** 对员工的密码进行加密，但该算法实际上并不适合加密密码。一方面，MD5 计算速度非常快，攻击者可以快速尝试大量密码进行暴力破解；另一方面，MD5 缺乏内置的盐值机制，相同的密码会生成相同的哈希值，攻击者可以利用这一点进行**彩虹表攻击**。

相比之下，**Argon2id** 加密算法能够设置计算的**迭代次数，内存使用量以及并行度**，从而控制计算时间。同时，Argon2id 内置了**盐值机制**，即使相同的密码也会生成不同的哈希值，从而有效防止彩虹表攻击。

因此，我选择将员工的密码加密方式从 **MD5** 替换为 **Argon2id**。

此外，对于数据库中已经使用 MD5 进行加密的密码，应当继续兼容 MD5 验证，并在员工成功登录后自动升级为 Argon2id 加密。

## 升级过程

### 数据库字段扩容

苍穹外卖原版数据库中，员工表密码字段的长度设置为 `varchar(64)`，而常见的 `Argon2id` 编码长度为 97 个字符，因此需要将其扩容为 `varchar(128)`

可以用以下 sql 实现现有数据库的字段扩容：

```sql
ALTER TABLE employee MODIFY COLUMN password varchar(128) COLLATE utf8_bin NOT NULL COMMENT '密码哈希';
```

### 引入依赖

引入以下依赖来支持 Argon2id 密码加密。其中 `spring-security-crypto` 负责提供 Argon2id 的**加密与验证的相关接口**，而 `bcprov-jdk18on` 提供了加密算法的**底层实现**。

```xml
<!-- pom.xml -->
<bouncycastle.version>1.86</bouncycastle.version>
<dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcprov-jdk18on</artifactId>
    <version>${bouncycastle.version}</version>
</dependency>

<!-- sky-server/pom.xml -->
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-crypto</artifactId>
</dependency>
<dependency>
    <groupId>org.bouncycastle</groupId>
    <artifactId>bcprov-jdk18on</artifactId>
</dependency>
```

### 封装加密工具类

我编写了一个 `PasswordHasher` 类来**提供密码的 Argon2id 加密与验证**，使用 `@Component` 注解让 Spring 管理这个类。该类需要提供以下方法：

- `String encode(String rawPassword)`: 将密码字符串进行 Argon2id 加密并返回
- `boolean matchs(String rawPassword, String storedHash)`: 验证密码与数据库中已经哈希化后的密码是否匹配(要能**自动识别**数据库中的是 MD5 还是 Argon2id，做对应类型的验证)
- `boolean needsUpgrade(String storedHash)`: 判断存储的哈希是否需要升级为新的 Argon2id 参数配置，即当前存储的是否是 MD5 加密的形式

首先要实例化 `Argon2PasswordEncoder` 对象，用于密码的加密和验证，可以通过参数来指定盐的长度、哈希输出长度、并行度、内存使用量以及迭代次数等参数：

```java
private final PasswordEncoder passwordEncoder = new Argon2PasswordEncoder(
        16,         // 每次编码随机生成 16 字节的盐。
        32,         // 输出 32 字节的哈希；存储时还会编码为 Base64 文本。
        1,          // 并行度，表示算法使用的内存通道数。
        19 * 1024,  // 单次计算的内存参数，单位 KiB，即 19 MiB。
        2           // 迭代次数；部署前应结合实际机器测量耗时和并发开销。
);
```

`encode()` 方法直接调用 `passwordEncoder.encode(rawPassword)` 即可:

```java
public String encode(String rawPassword) {
    Assert.notNull(rawPassword, "原始密码不能为空");
    return passwordEncoder.encode(rawPassword);
}
```

对于 `match()` 和 `needUpgrade()` 方法，我们需要**区分数据库中的哈希值是 MD5 还是 Argon2id**。MD5 通常是 32 个十六进制字符，而 Argon2id 的哈希值以 `$argon2id`开头 ，包含 `m=`,`t=`,`p=` 等字样来指定内存使用量、迭代次数和并行度等信息。因此，可以用正则表达式来区分这两种格式：

```Java
private static final Pattern LEGACY_MD5 = Pattern.compile("[0-9a-f]{32}");

private static final Pattern ARGON2ID_HASH = Pattern.compile(
        "\\$argon2id\\$(?:v=[0-9]+\\$)?m=[0-9]+,t=[0-9]+,p=[0-9]+"
                + "\\$[A-Za-z0-9+/]+\\$[A-Za-z0-9+/]+");

/** 判断存储的哈希是否为 MD5 格式 */
private boolean isLegacyMd5(String storedHash) {
    return storedHash != null && LEGACY_MD5.matcher(storedHash).matches();
}

/** 判断存储的哈希是否为 Argon2id 格式 */
private boolean isArgon2id(String storedHash) {
    return storedHash != null && ARGON2ID_HASH.matcher(storedHash).matches();
}                
```

`needsUpgrade()` 直接调用 `isLegacyMd5(storedHash)`即可：

```Java
public boolean needsUpgrade(String storedHash) {
    return isLegacyMd5(storedHash);
}
```

`matchs()` 方法先判断数据库中的哈希是否为 MD5，如果是，则将传入的密码也进行 MD5 加密，然后再进行匹配。

如果不是 Argon2id 类型的，则直接返回 false，否则调用 `passwordEncoder.matches()` 进行验证。

```java
public boolean matches(String rawPassword, String storedHash) {
    if (rawPassword == null || storedHash == null) {
        return false;
    }

    if (isLegacyMd5(storedHash)) {
        String actual = DigestUtils.md5DigestAsHex(
                rawPassword.getBytes(StandardCharsets.UTF_8));
        return actual.equals(storedHash);
    }

    if (!isArgon2id(storedHash)) {
        return false;
    }

    try {
        // 编码器从已保存的字符串中取出原来的盐和参数，再验证本次输入。
        return passwordEncoder.matches(rawPassword, storedHash);
    } catch (IllegalArgumentException e) {
        // 非法参数或损坏的编码验证失败；不记录密码或完整哈希。
        return false;
    }
}
```

### 修改业务代码

接下来修改业务中使用 MD5 加密的地方，首先是新建员工时，员工的默认密码为 123456，我们改用 `PasswordHasher` 进行加密：

```java
public void save(EmployeeDTO employeeDTO) {
    Employee employee = new Employee();
    // ...
    // 密码默认123456，使用 Argon2id 哈希算法加密，避免明文存储
    employee.setPassword(passwordHasher.encode(PasswordConstant.DEFAULT_PASSWORD));

    //...
}
```

然后是员工登录时的密码验证，首先用 `matchs()` 判断密码是否正确，然后**检查账号状态是否禁用**，最后再判断是否升级，避免禁用账号的登录修改数据库：

```java
String storedHash = employee.getPassword();
// 先检查密码是否正确，matches 方法能自动区分 MD5 和 Argon2id
if (!passwordHasher.matches(password, storedHash)) {
    throw new PasswordErrorException(MessageConstant.PASSWORD_ERROR);
}

if (!StatusConstant.ENABLE.equals(employee.getStatus())) {
    throw new AccountLockedException(MessageConstant.ACCOUNT_LOCKED);
}

// 如果密码正确，但数据库中存储的哈希是旧的 MD5，则升级为 Argon2id
if (passwordHasher.needsUpgrade(storedHash)) {
    employee.setPassword(passwordHasher.encode(password));
    // update 会自动填充，登录时 baseContext 里没有当前用户 ID，需要手动设置，避免切面填充错误。
    BaseContext.setCurrentId(employee.getId());
    try {
        employeeMapper.update(employee);
    } finally {
        BaseContext.removeCurrentId();
    }
}
```

需要注意，`update` 方法会自动填充时间字段，这需要用到 `BaseContext` 来手动设置当前用户 ID。但**用户登录时 BaseContext 里的用户 ID 还没有设置**，因此必须手动设置，避免切面填充错误。

最后是修改员工密码的接口，同样改为使用 `matchs()` 来验证输入的旧密码是否正确。

至此，员工密码的加密算法就由 MD5 升级到了 Argon2id。如果确认数据库中所有密码都已经迁移到了 Argon2id，则可以移除对 MD5 的兼容逻辑。
