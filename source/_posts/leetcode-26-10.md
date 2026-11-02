---
title: 10 月 LeetCode 刷题笔记
date: 2026-11-02 12:30:00
tags:
  - leetcode
  - 算法
categories:
  - leetcode 刷题笔记
description: 2026 年 10 月的 leetcode 刷题笔记
---
# 10 月 LeetCode 刷题笔记

## 区间问题

区间问题通常给定若干个区间，要求判断重叠关系、合并区间或选择互不重叠的区间，常与贪心思想结合。

这类题目一般**先按左端点或右端点排序，再依次遍历**，根据题目要求进行处理。

按左端点升序排序常用于**区间的合并**；按右端点升序排序则常**与贪心算法结合**，优先保留结束较早的区间，为后续区间留出更多空间。有些题目两种排序方式都能使用，但需要配合不同的贪心策略。

### 例 1：合并区间

来源:[56 合并区间](https://leetcode.cn/problems/merge-intervals/)

> 合并 `intervals` 中所有重叠的区间，返回恰好覆盖原区间且互不重叠的区间数组。

先按左端点升序排序，再依次遍历，维护当前待合并区间的左右端点 `left` 和 `right`。

如果新区间的左端点**小于等于 `right`**，就可以合并，将 `right` 更新为两个右端点中的较大值。

如果新区间的左端点大于 `right`，说明无法合并。此时将 `[left, right]` 加入结果，再用新区间更新 `left` 和 `right`。遍历结束后，还需要将**最后一个待合并区间**加入结果。

```java
public int[][] merge(int[][] intervals) {
    // 按左端点排序
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[0], b[0]));
    int left = intervals[0][0];
    int right = intervals[0][1];
    List<int[]> ans = new ArrayList<>();
    for (int i = 1; i < intervals.length; i++) {
        // 左端点大于当前右端点，无法合并
        if (intervals[i][0] > right) {
            int[] temp = new int[2];
            temp[0] = left;
            temp[1] = right;
            ans.add(temp);
            left = intervals[i][0];
            right = intervals[i][1];
        } else {
            left = Math.min(left, intervals[i][0]);
            right = Math.max(right, intervals[i][1]);
        }
    }
    int[] temp = new int[2];
    temp[0] = left;
    temp[1] = right;
    ans.add(temp);
    return ans.toArray(new int[ans.size()][2]);
}
```

### 例 2：无重叠区间

来源:[435 无重叠区间](https://leetcode.cn/problems/non-overlapping-intervals/)

> 移除最少的区间，使 `intervals` 中剩余区间互不重叠，并返回移除数量，其中仅端点接触不算重叠。

按右端点升序排序，**优先保留结束最早的区间**，这样可以为后续区间留出最多空间。按左端点降序排序、从右向左选择，也可以采用类似的贪心思路。

用 `right` 记录最后一个保留区间的右端点。如果新区间的左端点**小于 `right`**，就删除新区间；否则保留它，并更新 `right`。因为区间已按右端点升序排列，保留当前结束更早的区间不会减少后续可选区间的数量。

```java
public int eraseOverlapIntervals(int[][] intervals) {
    Arrays.sort(intervals, (a, b) -> Integer.compare(a[1], b[1]));
    int count = 0;
    int right = Integer.MIN_VALUE;
    for (int i = 0; i < intervals.length; i++) {
        if (intervals[i][0] >= right) {
            right = intervals[i][1];
        } else {
            count++;
        }
    }
    return count;
}
```

## 动态规划

动态规划（Dynamic Programming，DP）的核心思想是将一个大问题拆成相互关联的子问题，**保存已经计算过的结果，避免重复计算**，再利用这些结果求解原问题。

动态规划通常分为以下几个步骤：

1. **定义状态**：明确每个状态表示什么、保存什么结果。
2. **推导状态转移方程**：找出当前状态与其他状态之间的关系。
3. **确定初始状态**：设置初始值，并处理边界情况。
4. **确定计算顺序**：确保计算当前状态时，所依赖的状态已经求出。

### 线性 DP

线性 DP 通常按照**线性顺序**划分子问题，根据之前的状态计算当前状态。最简单的形式可以用一维数组 `dp[]` 保存各个位置的计算结果。

以斐波那契数列为例，定义 `dp[i]` 表示第 `i` 个斐波那契数，状态转移方程为：

$$
dp[i] = dp[i - 1] + dp[i - 2]
$$

如果只需要第 $n$ 个数，由于每次更新只依赖**前两个状态**，就不必保存整个数组，用两个变量记录前两个状态即可。

#### 例题：买卖股票的最佳时机 III

来源:[123 买卖股票的最佳时机 III](https://leetcode.cn/problems/best-time-to-buy-and-sell-stock-iii/)

> 给定每日股票价格 `prices`，求最多完成两笔交易的最大利润，且不能同时参与多笔交易。

对每一天，分别记录**四种状态**下的最大利润：第一次买入后、第一次卖出后、第二次买入后和第二次卖出后，用四个数组 `dp1`、`dp2`、`dp3`、`dp4` 表示。状态转移方程为：

$$
\begin{aligned}
\mathrm{dp1}[i] &= \max(\mathrm{dp1}[i - 1], -\mathrm{prices}[i]) \\
\mathrm{dp2}[i] &= \max(\mathrm{dp2}[i - 1], \mathrm{dp1}[i - 1] + \mathrm{prices}[i]) \\
\mathrm{dp3}[i] &= \max(\mathrm{dp3}[i - 1], \mathrm{dp2}[i - 1] - \mathrm{prices}[i]) \\
\mathrm{dp4}[i] &= \max(\mathrm{dp4}[i - 1], \mathrm{dp3}[i - 1] + \mathrm{prices}[i])
\end{aligned}
$$

每个状态都可以选择沿用**前一天的同一状态**，或在今天进行买卖操作。后三个状态的买卖操作还依赖于**前一天的前一个状态**。因此，可以将四个数组压缩为四个变量，并通过合理的更新顺序或临时变量保留所需的旧值，节省空间。

最终的最大利润为 `dp4[n - 1]`，压缩状态后对应 `sellTwo`。

```java
public int maxProfit(int[] prices) {
    if (prices.length <= 1)
        return 0;
    int buyOne = -prices[0];
    int sellOne = 0;
    int buyTwo = -prices[0];
    int sellTwo = 0;

    for (int i = 1; i < prices.length; i++) {
        int price = prices[i];
        int oldSellOne = sellOne;
        sellOne = Math.max(sellOne, price + buyOne);
        sellTwo = Math.max(sellTwo, price + buyTwo);
        buyOne = Math.max(buyOne, -price);
        buyTwo = Math.max(buyTwo, oldSellOne - price);
    }

    return sellTwo;
}
```

#### 扩展：买卖股票的最佳时机 IV

来源:[188 买卖股票的最佳时机 IV](https://leetcode.cn/problems/best-time-to-buy-and-sell-stock-iv/)

> 给定每日股票价格 `prices` 和整数 `k`，求最多完成 `k` 笔交易的最大利润，且不能同时参与多笔交易。

思路与上一题类似，只是**交易次数上限变为 $k$**。按天迭代并压缩天数维度后，可以用二维数组 `dp[t][s]` 保存状态，其中 `t` 表示交易序号，`s` 表示持股状态：`dp[t][0]` 表示第 `t` 次买入后的最大利润，`dp[t][1]` 表示第 `t` 次卖出后的最大利润。

### 背包 DP

背包 DP 是一种经典的动态规划问题，其核心问题是：

> 给定容量有限的背包和若干件具有重量、价值的物品，如何选择物品，使总重量不超过背包容量且总价值最大？

#### 0-1 背包

在 0-1 背包问题中，每件物品**最多选择一次**。

对于求最大价值的问题，定义 `dp[i][j]` 表示从前 `i` 件物品中选择、总重量不超过 `j` 时的最大价值。

设第 $i$ 件物品的重量为 $w_i$、价值为 $v_i$。状态转移对应**选择或不选择**这件物品：

$$
dp[i][j] =
\begin{cases}
dp[i - 1][j], & w_i > j \\
\max(dp[i - 1][j], dp[i - 1][j - w_i] + v_i), & w_i \leq j
\end{cases}
$$

当前状态只依赖前一行，因此可以**省去 `i` 这一维度**，并**从后往前**遍历容量 `j`。这样读取的仍是上一轮的状态，可以避免同一件物品被重复选择。

##### 例题：目标和

来源:[494 目标和](https://leetcode.cn/problems/target-sum/)

> 为非负整数数组 `nums` 中的每个数添加 `+` 或 `-` 符号，统计表达式结果等于 `target` 的方案数。

设数组元素总和为 `sum`，**加负号的元素之和**为 `neg`，则表达式的值为 `sum - 2 * neg`。要使它等于 `target`，就需要 `neg = (sum - target) / 2`。因此，`sum - target` 必须**非负且为偶数**，否则无解。

问题由此转化为 0-1 背包：从 `nums` 中选择若干个元素，使其和为 `(sum - target) / 2`，求不同选法的数量，每个数组位置最多选择一次。

定义 `dp[i][j]` 表示从数组前 `i` 个数中选出若干个、使其和 **恰好为 `j`** 的方案数。第 `i` 个数对应 `nums[i - 1]`，状态转移方程为：

$$
dp[i][j] =
\begin{cases}
dp[i - 1][j], & \mathrm{nums}[i - 1] > j \\
dp[i - 1][j] + dp[i - 1][j - \mathrm{nums}[i - 1]], & \mathrm{nums}[i - 1] \leq j
\end{cases}
$$

初始状态为 **`dp[0][0] = 1`**，表示不选择任何数、得到和为 0 的方案只有一种；其余 `dp[0][j]` 均为 0。

实现时，从后往前遍历目标和，省去 `i` 这一维度：

```java
public int findTargetSumWays(int[] nums, int target) {
    int sum = 0;
    int n = nums.length;
    for (int num : nums) {
        sum += num;
    }
    // sum - target 必须非负且为偶数
    if ((sum - target) % 2 != 0 || sum < target)
        return 0;
    int max = (sum - target) / 2;
    int[] dp = new int[max + 1];
    dp[0] = 1;
    for (int num : nums) {
        // 从后往前遍历，避免同一个元素被重复选择
        for (int i = max; i >= num; i--) {
            dp[i] += dp[i - num];
        }
    }
    return dp[max];
}
```

#### 完全背包

在完全背包问题中，每种物品都可以**选择任意多次**。

状态定义与 0-1 背包类似，但选择当前物品时，可以继续使用本轮已经更新的状态。因此，压缩成一维数组后，需要**从前往后**遍历容量 `j`，使同一种物品可以被重复选择。

##### 例题：零钱兑换

来源:[322 零钱兑换](https://leetcode.cn/problems/coin-change/)

> 使用数量不限的各面额硬币 `coins` 凑成金额 `amount`，返回所需的最少硬币数，无法凑成则返回 -1。

每种硬币可以重复选择，因此可以采用完全背包的思路。

定义 `dp[i][j]` 表示使用前 `i` 种硬币凑成金额 `j` 所需的最少硬币数。第 `i` 种硬币对应 `coins[i - 1]`，状态转移方程为：

$$
dp[i][j] =
\begin{cases}
dp[i - 1][j], & \mathrm{coins}[i - 1] > j \\
\min(dp[i - 1][j], dp[i][j - \mathrm{coins}[i - 1]] + 1), & \mathrm{coins}[i - 1] \leq j
\end{cases}
$$

与 0-1 背包不同，选择当前硬币后，剩余金额仍可由前 `i` 种硬币凑成，因此转移式使用 **`dp[i][j - coins[i - 1]]`**。压缩成一维数组时，从前往后遍历金额，即可保留重复选择当前硬币的效果。

由于求的是最小值，先将数组初始化为 **`amount + 1`**，表示尚不可达，再设置 `dp[0] = 0`。面额均为正整数，所以可行方案的硬币数不会超过 `amount`，可以用 `amount + 1` 作为不可达的标记。

实现如下：

```java
public int coinChange(int[] coins, int amount) {
    if (amount == 0) {
        return 0;
    }
    int[] dp = new int[amount + 1];
    Arrays.fill(dp, amount + 1);
    dp[0] = 0;
    for (int coin : coins) {
        // 从前往后遍历，允许重复选择当前面额的硬币
        for (int i = coin; i <= amount; i++) {
            if (dp[i] > dp[i - coin] + 1)
                dp[i] = Math.min(dp[i], dp[i - coin] + 1);
        }
    }
    return dp[amount] > amount ? -1 : dp[amount];
}
```

## Hierholzer 算法

**Hierholzer 算法（希尔霍尔泽算法）**用于寻找图中的**欧拉路径（Eulerian Path）**或**欧拉回路（Eulerian Circuit）**。

### 相关知识

经过图中**每条边恰好一次**的路径称为欧拉路径；如果起点和终点相同，则称为欧拉回路。

包含欧拉回路的图称为欧拉图；包含欧拉路径但不包含欧拉回路的图称为半欧拉图。

判断时，先**忽略孤立节点，并要求图连通**；对于有向图，这里指忽略边的方向后连通。在此前提下：

- **无向图**：所有节点的度数均为偶数时，是欧拉图；恰有两个节点的度数为奇数时，是半欧拉图。
- **有向图**：所有节点的出度与入度相等时，是欧拉图；恰有一个节点的出度比入度大 1、另一个节点的入度比出度大 1，其余节点的出度与入度相等时，是半欧拉图。

### 基本流程

1. **选择起点**：欧拉图可从任意非孤立节点出发；无向半欧拉图从任意一个奇度节点出发；有向半欧拉图从出度比入度大 1 的节点出发。
2. 从起点进行 **DFS**，每经过一条边，就将其**删除或标记为已使用**；无向图中，同一条边的两个方向需要同时处理。
3. 当前节点没有尚未使用的边可走时，将其加入**节点序列**，并回溯到上一个节点。
4. 在回溯过程中继续处理尚未使用的边，直到搜索结束。
5. **反转节点序列**，得到欧拉路径或欧拉回路。

### 例题：重新安排行程

来源:[332 重新安排行程](https://leetcode.cn/problems/reconstruct-itinerary/)

> 给定机票列表 `tickets`，返回从 `JFK` 出发、恰好使用每张机票一次且字典序最小的行程。

将机场视为节点、每张机票视为一条有向边。题目保证存在有效行程，因此可以从指定起点 `JFK` 进行 DFS，**在回溯时记录机场**，最后反转节点序列。

为了得到字典序最小的行程，DFS 时优先选择目的机场字典序最小的边。可以用**优先队列**保存每个机场尚未使用的出边所指向的目的机场，每次取出队头，相当于使用并删除一张机票。

```java
List<String> ans;

public List<String> findItinerary(List<List<String>> tickets) {
    Map<String, PriorityQueue<String>> map = new HashMap<>();
    for (List<String> ticket : tickets) {
        if (map.containsKey(ticket.get(0))) {
            map.get(ticket.get(0)).offer(ticket.get(1));
        } else {
            PriorityQueue<String> temp = new PriorityQueue<>();
            temp.offer(ticket.get(1));
            map.put(ticket.get(0), temp);
        }
    }
    ans = new LinkedList<>();
    dfs(map, "JFK");
    int len = ans.size();
    for (int i = 0; i < len; i++) {
        ans.add(ans.remove(len - i - 1));
    }
    return ans;
}

public void dfs(Map<String, PriorityQueue<String>> map, String cur) {
    while (map.containsKey(cur) && !map.get(cur).isEmpty()) {
        String next = map.get(cur).poll();
        dfs(map, next);
    }
    ans.add(cur);
}
```

## 岛屿问题

岛屿问题通常用二维数组 `grid` 表示地图，其中 1 代表陆地，0 代表水域。

这类问题可以用图的遍历算法解决，但**网格数组并不是图的邻接矩阵**：每个单元格对应一个节点，上下左右相邻的单元格对应它的邻居。

通常可以从某个陆地单元格出发，通过 DFS 或 BFS 遍历所在的连通区域，进而计算岛屿面积等。

### 例 1：岛屿的最大面积

来源:[695 岛屿的最大面积](https://leetcode.cn/problems/max-area-of-island/)

> 给定由 0 和 1 组成的网格 `grid`，返回由上下左右相连的陆地构成的最大岛屿面积。

遍历所有单元格，用二维数组 `visit` 记录访问状态。每遇到一个**未访问过的陆地单元格**，就进行 DFS，标记并统计与它相连的所有陆地单元格，得到该岛屿的面积，最后取最大值。

DFS 时，可以用**方向数组** `dirs = {{0, 1}, {0, -1}, {1, 0}, {-1, 0}}` 记录上下左右四种位移，统一处理邻居，减少重复代码。

```java
int count;
int[][] dirs = {{0, 1}, {0, -1}, {1, 0}, {-1, 0}};

public int maxAreaOfIsland(int[][] grid) {
    int max = 0;
    boolean[][] visit = new boolean[grid.length][grid[0].length];
    for (int i = 0; i < grid.length; i++) {
        for (int j = 0; j < grid[i].length; j++) {
            if (grid[i][j] == 1 && !visit[i][j]) {
                count = 0;
                dfs(visit, grid, i, j);
                if (count > max)
                    max = count;
            }
        }
    }
    return max;
}

public void dfs(boolean[][] visit, int[][] grid, int row, int col) {
    int m = grid.length;
    int n = grid[0].length;
    if (visit[row][col])
        return;
    if (grid[row][col] == 0)
        return;
    visit[row][col] = true;
    count++;
    for (int[] dir : dirs) {
        int newRow = row + dir[0];
        int newCol = col + dir[1];
        // 邻居的行列下标均在网格范围内
        if (newRow >= 0 && newRow < m && newCol >= 0 && newCol < n) {
            dfs(visit, grid, newRow, newCol);
        }
    }
}
```

### 例 2：太平洋大西洋水流问题

来源:[417 太平洋大西洋水流问题](https://leetcode.cn/problems/pacific-atlantic-water-flow/)

> 给定高度矩阵 `heights`，返回雨水既能流向太平洋、又能流向大西洋的所有单元格坐标。

太平洋位于网格的左边和上边，大西洋位于右边和下边。水可以流向上下左右相邻且高度不高于当前位置的单元格。

最直接的思路是从每个位置出发，用 DFS 判断水能否到达两个海洋，但重复搜索较多。

可以**反向搜索**：分别从与两个海洋相邻的边界单元格出发，只向高度**大于等于**当前单元格的邻居移动。这样访问到的单元格，都能沿正向水流到达对应的海洋。用二维数组 `pacific` 和 `atlantic` 分别记录两次搜索的访问结果。

最终，两个数组中**均为 `true`** 的位置，就是水能流向两个海洋的单元格。

```java
int[][] dirs = {{0, 1}, {0, -1}, {1, 0}, {-1, 0}};

public List<List<Integer>> pacificAtlantic(int[][] heights) {
    int m = heights.length;
    int n = heights[0].length;
    List<List<Integer>> ans = new ArrayList<>();
    boolean[][] pacific = new boolean[m][n];
    boolean[][] atlantic = new boolean[m][n];
    for (int i = 0; i < n; i++) {
        dfs(0, i, heights, pacific);
        dfs(m - 1, i, heights, atlantic);
    }
    for (int i = 0; i < m; i++) {
        dfs(i, 0, heights, pacific);
        dfs(i, n - 1, heights, atlantic);
    }

    for (int i = 0; i < m; i++) {
        for (int j = 0; j < n; j++) {
            if (pacific[i][j] && atlantic[i][j]) {
                List<Integer> temp = new ArrayList<>();
                temp.add(i);
                temp.add(j);
                ans.add(temp);
            }
        }
    }
    return ans;
}

public void dfs(int row, int col, int[][] heights, boolean[][] ocean) {
    int m = heights.length;
    int n = heights[0].length;
    if (ocean[row][col])
        return;
    ocean[row][col] = true;
    int height = heights[row][col];
    for (int[] dir : dirs) {
        int newRow = row + dir[0];
        int newCol = col + dir[1];
        if (newRow >= 0 && newRow < m && newCol >= 0 && newCol < n && height <= heights[newRow][newCol])
            dfs(newRow, newCol, heights, ocean);
    }
}
```

## 其他收获

- 对 `List` 按下标插入时，`ArrayList` 需要移动后续元素，但数组存储可能带来更好的缓存局部性；`LinkedList` 则需要先遍历定位节点。比较性能时，需要**同时考虑元素移动和节点定位的开销**，并结合访问方式和数据规模判断。
