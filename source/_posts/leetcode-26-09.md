---
title: 9 月 LeetCode 刷题笔记
date: 2026-10-07 15:00:00
tags:
  - leetcode
  - 算法
categories:
  - leetcode 刷题笔记
description: 2026 年 9 月的 leetcode 刷题笔记
---
# 9 月 LeetCode 刷题笔记

## 双指针

双指针是一种算法技巧，通过两个指针配合遍历数据结构，减少重复遍历。

### 左右指针

两个指针分别从头部和尾部出发，逐步向中间移动，常用于判断回文串、查找有序数组中和为目标值的两个数等。

#### 例 1：判断一个字符串是否为回文串

```java
int left = 0;
int right = s.length() - 1;
while (left < right) {
    if (s.charAt(left) != s.charAt(right)) {
        return false;
    }
    left++;
    right--;
}
```

#### 例 2：有序数组的两数之和

来源:[167 两数之和 II - 输入有序数组](https://leetcode.cn/problems/two-sum-ii-input-array-is-sorted/)
> 在非递减排列的整数数组中，找出和为 `target` 的两个数，并返回它们从 1 开始的下标。

下面的代码片段只演示如何判断**有序数组**中是否存在和为目标值的两个数。

```java
int left = 0;
int right = nums.length - 1;
while (left < right) {
    int sum = nums[left] + nums[right];
    if (sum == target) {
        return true;
    } else if (sum < target) {
        left++;
    } else {
        right--;
    }
}
```

两个指针只会向中间移动，每个元素最多被经过一次，时间复杂度从 $O(n^2)$ 降低为 $O(n)$。

三数之和也可以采用类似思路：先固定一个数，再用左右指针查找另外两个数，时间复杂度从 $O(n^3)$ 降低为 $O(n^2)$。

该方法要求数组有序；如果需要先排序，排序的时间复杂度为 $O(n \log n)$。

### 快慢指针

两个指针同向移动，一个快、一个慢，通常用于判断链表是否有环、寻找链表中点等。

#### 例 1：判断链表是否有环

来源:[141 环形链表](https://leetcode.cn/problems/linked-list-cycle/)
> 给定链表的头节点 `head`，判断链表中是否存在环。

```java
Node slow = head;
Node fast = head;
while (fast != null && fast.next != null) {
    slow = slow.next;
    fast = fast.next.next;
    if (slow == fast) {
        return true;
    }
}
return false;
```

核心原理是：如果链表没有环，`fast` 会先到达链表末尾；如果有环，`fast` 和 `slow` 最终都会进入环中。进入环后，`fast` 每轮比 `slow` **多走一个节点**，因此最终会追上 `slow`。

如果还要查找环的入口，可以在 `fast` 和 `slow` 第一次相遇后，让另一个指针 `ptr` 从链表头出发。此后 `ptr` 与 `slow` 每次都前进一步，它们再次相遇的位置就是环的入口。

### 滑动窗口

两个指针同向移动，分别表示窗口的左右边界。核心思想是每次移动时**只处理窗口新增或移出的元素**。对于窗口和等可以增量维护的统计量，时间复杂度可由 $O(nk)$ 降低为 $O(n)$，其中 $k$ 为窗口长度。

#### 固定长度窗口

定长窗口一般用于查找长度为 $k$ 的子数组的最大或最小元素和，或统计满足条件的子数组个数。

> 例：找出长度为 k 的子数组的最大元素和

```java
// 用前 k 个元素的和初始化 sum 和 maxSum
int left = 0;
int right = k;
while (right < nums.length) {
    sum += nums[right];
    sum -= nums[left];
    if (sum > maxSum) {
        maxSum = sum;
    }
    right++;
    left++;
}
```

#### 可变长度窗口

变长窗口一般用于查找满足条件的最长或最短子数组。

来源:[209 长度最小的子数组](https://leetcode.cn/problems/minimum-size-subarray-sum/)
> 在正整数数组中，返回元素和大于等于 `target` 的最短连续子数组长度，不存在则返回 0。

```java
while (right < nums.length) {
    sum += nums[right++];
    while (sum >= target) {
        if (minLength > right - left) {
            minLength = right - left;
        }
        sum -= nums[left++];
    }
}
```

## 优先队列与堆

优先队列是一种按优先级取出元素的数据结构，优先级最高的元素始终位于队头。

优先队列一般使用**堆**来实现。二叉堆是一种**完全二叉树**：父节点的值始终不小于子节点的值时，称为**大顶堆**；父节点的值始终不大于子节点的值时，称为**小顶堆**。

由于二叉堆是**完全二叉树**，通常可以用数组存储。数组下标从 0 开始时，对于下标为 `i` 的节点，其左子节点下标为 `2 * i + 1`，右子节点下标为 `2 * i + 2`；非根节点的父节点下标为 `(i - 1) / 2`，其中除法取整数部分。

插入新元素时，先将其放到数组末尾，再不断与父节点比较。如果**优先级高于父节点**，就交换二者；否则说明已经到达正确的位置。这个过程称为**上浮**。

优先队列的 `poll()` 操作会移除堆的根节点。此时将最后一个元素移到根节点的位置，再不断与优先级更高的子节点交换，直到到达正确的位置。这个过程称为**下沉**。

Java 提供了 `PriorityQueue` 类来实现优先队列，默认是小顶堆，也可以通过传入自定义比较器来实现大顶堆。

```java
// 默认小顶堆
PriorityQueue<Integer> pq1 = new PriorityQueue<>();
// 自定义比较器
PriorityQueue<Integer> pq2 = new PriorityQueue<>((a, b) -> Integer.compare(b, a));
PriorityQueue<int[]> pq3 = new PriorityQueue<>((a, b) -> Integer.compare(a[1], b[1]));
```

`PriorityQueue` 使用 `offer()` 插入元素，使用 `poll()` 移除并返回队头元素，使用 `peek()` 查看队头元素。

优先队列通常用于处理**前 $k$ 个元素**的问题。

来源:[347 前 K 个高频元素](https://leetcode.cn/problems/top-k-frequent-elements/)
> 给定整数数组 `nums` 和整数 `k`，返回出现频率最高的 `k` 个元素。

先使用 `HashMap` 统计每个元素的出现频率，再用数组保存元素及其频率，最后将这些数组放入大顶堆，依次取出频率最高的 $k$ 个元素。

```java
// 按照频率从大到小排序
PriorityQueue<int[]> maxHeap = new PriorityQueue<>(
    (a, b) -> b[1] - a[1]
);
for (Map.Entry<Integer, Integer> entry : map.entrySet()) {
    int[] num = new int[2];
    num[0] = entry.getKey();    // 元素
    num[1] = entry.getValue();  // 频率
    maxHeap.add(num);
}
int[] ans = new int[k];
for (int i = 0; i < k; i++) {
    int[] num = maxHeap.poll();
    ans[i] = num[0];
}
return ans;
```

## 树的相关算法

### 计算完全二叉树的节点个数

来源:[222 完全二叉树的节点个数](https://leetcode.cn/problems/count-complete-tree-nodes/)
> 给定一棵完全二叉树的根节点 `root`，计算树中的节点个数。

普通遍历的时间复杂度为 $O(n)$，但没有利用完全二叉树的性质。

#### 方法一：利用满二叉树的性质

对于完全二叉树，分别沿最左侧和最右侧路径计算高度。如果两侧高度都为 $h$，说明它是满二叉树，节点数为 $2^h - 1$；否则递归计算左右子树的节点数。这里的高度按层数计算，根节点所在层为第 1 层。

完全二叉树的左右子树中至少有一棵是满二叉树，因此递归时可以直接计算这棵子树的节点数。

```java
public int countNodes(TreeNode root) {
    if (root == null)
        return 0;
    TreeNode left = root.left;
    TreeNode right = root.right;
    int countLeft = 1;
    int countRight = 1;
    while (left != null) {
        countLeft++;
        left = left.left;
    }
    while (right != null) {
        countRight++;
        right = right.right;
    }
    // 判断是否是满二叉树
    if (countLeft == countRight) {
        return (int) (Math.pow(2, countLeft) - 1);
    }
    // 不是则继续递归计算左右子树的节点数
    return countNodes(root.left) + countNodes(root.right) + 1;
}
```

这种方法的时间复杂度为 $O((\log n)^2)$。

参考：[完全二叉树节点计数的思路](https://cloud.tencent.com/developer/article/1880865)

#### 方法二：二分查找

先沿最左侧路径遍历，得到树的高度 $h$。这里仍按层数计算高度，根节点所在层为第 1 层。

前 $h - 1$ 层均已填满，共有 $2^{h-1} - 1$ 个节点。

非空树最后一层的节点数为 $1$ 到 $2^{h-1}$。由于节点从左到右连续排列，可以通过**二分查找**确定最后一个存在的节点。

核心难点在于：如何根据节点的编号，从根节点出发到达对应位置，并判断该节点是否存在。

将根节点编号设为 1，编号为 $i$ 的节点，其左右子节点分别编号为 $2i$ 和 $2i + 1$。第 $h$ 层的编号范围为 $2^{h-1}$ 到 $2^h - 1$，二进制表示共有 $h$ 位。去掉最高位的 1 后，从左到右读取剩余的 $h - 1$ 位：0 表示向左走，1 表示向右走，即可到达对应位置。

```java
public int countNodes(TreeNode root) {
    if (root == null)
        return 0;
    int ans = 0;
    int h = 0;
    TreeNode node = root;
    while (node != null) {
        h++;
        node = node.left;
    }
    ans += (int) Math.pow(2, h - 1) - 1;
    int low = ans + 1;
    int high = (int) Math.pow(2, h) - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        int dir;
        node = root;
        // 位运算
        for (int i = 1; i < h; i++) {
            dir = (mid >> (h - i - 1)) & 1;
            node = (dir == 1) ? node.right : node.left;
        }
        // 根据 node 是否为 null 更新 low 和 high
        // 如果此时 low == high，可直接算出结果
        if (node == null) {
            if (low == high)
                return low - 1;
            high = mid - 1;
        } else {
            if (low == high)
                return low;
            low = mid + 1;
        }

    }
    return high;
}
```

### 判断一棵二叉树是否平衡

来源:[110 平衡二叉树](https://leetcode.cn/problems/balanced-binary-tree/)
> 给定一棵二叉树，判断每个节点的左右子树高度差是否都不超过 1。

平衡二叉树要求**每个节点**的左右子树高度差都不超过 1。

一种方法是自顶向下判断，类似于前序遍历：对每个节点分别计算左右子树的高度，判断高度差，再递归判断左右子树是否平衡。由于子树高度会被重复计算，最坏情况下时间复杂度为 $O(n^2)$。

另一种方法是自底向上判断，采用**后序遍历**，每个节点只需计算一次高度。如果任一子树已经不平衡，或左右子树高度差大于 1，就返回 `-1` 表示不平衡；否则返回当前子树的高度。时间复杂度为 $O(n)$。

```java
public boolean isBalanced(TreeNode root) {
    return height(root) >= 0;
}

public int height(TreeNode node) {
    if (node == null)
        return 0;
    int left = height(node.left);
    int right = height(node.right);
    if (left == -1 || right == -1 || Math.abs(left - right) > 1)
        return -1;
    return 1 + Math.max(left, right);
}
```

### 根据前序或后序遍历与中序遍历重建二叉树

来源:[105 从前序与中序遍历序列构造二叉树](https://leetcode.cn/problems/construct-binary-tree-from-preorder-and-inorder-traversal/)
> 给定同一棵二叉树的前序和中序遍历序列，重建二叉树并返回根节点。

来源:[106 从中序与后序遍历序列构造二叉树](https://leetcode.cn/problems/construct-binary-tree-from-inorder-and-postorder-traversal/)
> 给定同一棵二叉树的中序和后序遍历序列，重建二叉树并返回根节点。

前序遍历的第一个元素、后序遍历的最后一个元素都是根节点，因此可以直接确定根节点的值。

接着**在中序遍历中找到根节点的位置**，其左侧是左子树的中序遍历序列，右侧是右子树的中序遍历序列。

据此划分前序或后序遍历序列，构建根节点，再**递归构建**左右子树。

递归构建时，可以**传递数组区间的起止下标**，避免每次创建新的子数组，节省时间和空间。

```java
// 后序遍历 + 中序遍历
public TreeNode buildTree(int[] inorder, int[] postorder) {
    return recursive(0, inorder.length - 1, 0, postorder.length - 1, inorder, postorder);
}

private TreeNode recursive(int in_left, int in_right, int post_left, int post_right, int[] inorder, int[] postorder) {
    TreeNode root = new TreeNode(postorder[post_right]);
    int i = in_left;
    for (i = in_left; i <= in_right; i++) {
        if (inorder[i] == postorder[post_right])
            break;
    }
    if (i == in_left && i == in_right) {
        return root;
    } else if (i == in_left) {
        root.right = recursive(in_left + 1, in_right, post_left, post_right - 1, inorder, postorder);
    } else if (i == in_right) {
        root.left = recursive(in_left, in_right - 1, post_left, post_right - 1, inorder, postorder);
    } else {
        root.right = recursive(i + 1, in_right, post_left + (i - in_left), post_right - 1, inorder, postorder);
        root.left = recursive(in_left, i - 1, post_left, post_left + (i - in_left) - 1, inorder, postorder);
    }

    return root;
}
```

### 删除二叉搜索树的节点

来源:[450 删除二叉搜索树中的节点](https://leetcode.cn/problems/delete-node-in-a-bst/)
> 删除二叉搜索树中值为 `key` 的节点，保持二叉搜索树的性质，并返回更新后的根节点。

如果 `key` 不等于当前根节点的值，就根据大小关系判断目标节点位于左子树还是右子树，再**递归调用**删除函数。

如果要删除的是**当前根节点**，且至少一棵子树为空，直接返回另一棵子树的根节点即可；两棵子树均为空时返回 `null`。

如果左右子树均不为空，可以**用右子树最左侧节点的值替换当前根节点的值**，再删除该节点，仍然满足二叉搜索树的性质。

查找替代节点时，不断向左遍历，直到**左子树为空**，并记录该节点的值。删除该节点后，用它的右子树接替原位置。

```java
// 记录替代节点的值
int value;

public TreeNode deleteNode(TreeNode root, int key) {
    if (root == null)
        return null;
    // 目标不是当前根节点，递归查找对应子树
    if (root.val > key) {
        root.left = deleteNode(root.left, key);
        return root;
    }
    if (root.val < key) {
        root.right = deleteNode(root.right, key);
        return root;
    }
    // 目标是当前根节点；若至少一棵子树为空，则返回另一棵子树
    if (root.left == null)
        return root.right;
    if (root.right == null)
        return root.left;
    // 子树均非空，用右子树最左侧节点的值替换当前根节点的值
    root.right = deleteMostLeft(root.right);
    root.val = value;
    return root;
}

public TreeNode deleteMostLeft(TreeNode root) {
    if (root.left != null) {
        root.left = deleteMostLeft(root.left);
        return root;
    }
    value = root.val;
    return root.right;
}
```

### 查找二叉树的最近公共祖先

来源:[236 二叉树的最近公共祖先](https://leetcode.cn/problems/lowest-common-ancestor-of-a-binary-tree/)
> 给定二叉树的根节点 `root` 和两个节点 `p`、`q`，返回它们的最近公共祖先。

最近公共祖先有以下**两种情况**：

1. 当前节点是 `p` 或 `q`，且另一个节点位于它的子树中。
2. `p` 和 `q` 分别位于当前节点的左右子树中。

因此可以遍历整棵树，让每棵子树返回是否包含 `p` 或 `q`，再结合当前节点的值判断它是否为最近公共祖先。

```java
TreeNode ans;

public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
    dfs(root, p.val, q.val);
    return ans;
}

public boolean dfs(TreeNode root, int p, int q) {
    if (root == null) {
        return false;
    }
    boolean left = dfs(root.left, p, q);
    boolean right = dfs(root.right, p, q);
    if (left && right) {
        ans = root;
        return true;
    }
    if ((root.val == p || root.val == q) && (left || right)) {
        ans = root;
        return true;
    }
    return ((left || right) || (root.val == p || root.val == q));
}
```

这种**父节点的处理依赖于子节点结果**的情况，适合采用**后序遍历**：先处理子节点，再利用子树返回的结果处理父节点，避免重复遍历子树。

另一种思路是用哈希表记录每个节点的父节点，再分别沿父节点向上遍历，得到 **`p` 和 `q` 的祖先路径**，从而找到最近公共祖先。

## 回溯算法

回溯算法一般用于**寻找所有满足条件的解**。核心思想是先做出一个选择，再在此基础上继续搜索。当前分支搜索结束后，**撤销选择并回退到上一步**，尝试其他分支，直到遍历完所有可能的选择。

大致的代码框架如下：

```java
void dfs() {
    if (满足条件) {
        // 记录当前解;
        return;
    }
    for (选择 : 选择列表) {
        if (isValid(选择)) {
            // 做选择;
            dfs();
            // 撤销选择;
        }
    }
}
```

回溯过程可以看作一棵搜索树的深度优先搜索（DFS）：每条分支代表一个选择，通过递归遍历所有可能的分支。下图以 LeetCode 的“组合总和”为例，展示这一搜索过程。

![组合总和的回溯搜索树示例](/img/回溯算法示例.png)

为了提高效率，可以进行**剪枝**：当某个分支已经**不可能**得到满足条件的解时，停止搜索该分支，相当于剪掉对应的子树。

递归时通常需要传递参数，记录已经做出的选择和当前搜索状态。

### 例 1：组合问题

来源:[39 组合总和](https://leetcode.cn/problems/combination-sum/)
> 从无重复元素的正整数数组 `candidates` 中，找出所有和为 `target` 的不同组合，每个元素可以重复使用。

采用回溯算法时，每个元素都有**选择或不选择**两种情况。用 `index` 表示当前元素的位置：选择当前元素后，由于它可以重复使用，`index` 保持不变；不选择当前元素时，`index` 加 1。

用 `List<Integer>` 类型的 `curCombine` **记录当前组合中的元素**，选择时加入，回溯时移除。

用 `target` 表示**距离目标和还差多少**；当它为 0 时，当前组合就是一个有效解。

可以进行剪枝：如果当前元素大于剩余的 `target`，就跳过选择它的分支，继续考虑后续元素。

```java
public List<List<Integer>> combinationSum(int[] candidates, int target) {
    List<List<Integer>> ans = new ArrayList<>();
    List<Integer> curCombine = new ArrayList<>();
    dfs(candidates, target, curCombine, 0, ans);
    return ans;
}

public void dfs(int[] candidates, int target, List<Integer> curCombine, int index, List<List<Integer>> ans) {
    // 判断当前组合是否已经满足条件
    // 必须先于 index == candidates.length 处理，否则会漏解
    if (target == 0) {
        ArrayList<Integer> temp = new ArrayList<>();
        for (int i = 0; i < curCombine.size(); i++) {
            temp.add(curCombine.get(i));
        }
        ans.add(temp);
        return;
    }

    // 已经遍历到数组的末尾，不可能再有选择
    if (index == candidates.length) {
        return;
    }

    // 选择 1：不选择当前元素，递归处理下一个元素
    dfs(candidates, target, curCombine, index + 1, ans);

    // 剪枝：只有当前数小于等于剩余的 target 时才能选择
    if (candidates[index] <= target) {
        // 选择 2：选择当前元素
        curCombine.add(candidates[index]);
        dfs(candidates, target - candidates[index], curCombine, index, ans);
        // 撤销选择
        curCombine.remove(curCombine.size() - 1);
    }
}
```

如果题目改为每个元素只能使用一次，则选择当前元素后也需要将 `index` 加 1。

### 例 2：对数组或字符串进行分割

来源:[131 分割回文串](https://leetcode.cn/problems/palindrome-partitioning/)
> 将字符串 `s` 分割成若干回文子串，返回所有可能的分割方案。

这类问题可以看作在相邻字符之间插入分隔符。长度为 $n$ 的非空字符串共有 $n - 1$ 个可选位置，每个位置都有**分割或不分割**两种选择，因此共有 $2^{n-1}$ 种候选分割方案。

一种思路是利用整数的二进制表示，用每一位表示是否在对应位置分割，从而枚举所有候选方案。

另一种思路是回溯，依次尝试每个位置的分割或不分割两种选择。只有当前子串是回文串时，才进行分割。因此需要传递**上一个分割点和当前待选分割点**的位置，以及**已经分割出的子串列表**。

同一子串可能被多次判断是否为回文串，因此可以使用 `cache` 缓存已经确认是回文串的区间，减少重复计算。下面的代码用 `cache[pre][index] == 1` 表示区间 `[pre, index)` 是回文串。

```java
int[][] cache;

public List<List<String>> partition(String s) {
    cache = new int[s.length()][s.length() + 1];
    List<List<String>> ans = new ArrayList<>();
    List<String> curSplit = new ArrayList<>();
    // 开头是一个分割点，pre = 0
    dfs(s, 0, 1, curSplit, ans);
    return ans;
}

public void dfs(String s, int pre, int index, List<String> curSplit, List<List<String>> ans) {
    // 字符串末尾是固定分割点；若最后一个子串是回文串，则记录当前方案
    if (index == s.length()) {
        if (cache[pre][index] != 0 || isPalindrome(s.substring(pre, index))) {
            cache[pre][index] = 1;
            curSplit.add(s.substring(pre, index));
            ans.add(new ArrayList<String>(curSplit));
            curSplit.remove(curSplit.size() - 1);
        }
        return;
    }

    // 选择 1：不分割
    dfs(s, pre, index + 1, curSplit, ans);

    // 选择 2：在当前位置分割
    // 剪枝：只有当前子串是回文串时才能分割
    String sub = s.substring(pre, index);
    if (cache[pre][index] != 0 || isPalindrome(sub)) {
        cache[pre][index] = 1;
        curSplit.add(sub);
        pre = index;
        dfs(s, pre, index + 1, curSplit, ans);
        curSplit.remove(curSplit.size() - 1);
    }
}
```

## 其他收获

- 进行树的层序遍历时，先记录当前队列长度，再调用相应次数的 `poll()`，取出的节点就都属于同一层，便于逐层处理，例如求每层的最大值。
- 二叉搜索树的中序遍历结果是有序的，可以利用这一性质判断一棵树是否为二叉搜索树。
