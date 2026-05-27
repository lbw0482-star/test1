# JobRight Greenhouse 自动填表技术文档

## 1. 目标与范围

本任务目标是基于现有浏览器扩展框架，实现 Greenhouse 页面自动填表能力，满足如下要求：

1. 提取页面表单字段（文本、下拉、教育列表）
2. 根据 mock 数据执行自动填充
3. 输出填充统计信息（成功与未填充字段）

当前实现范围聚焦 `contents/crawler/greenhouse.ts`，并复用已有工具模块：

- `contents/crawler/utils/executor.ts`
- `contents/crawler/utils/input/index.ts`
- `contents/crawler/utils/select.ts`
- `contents/crawler/utils/index.ts`

## 2. 核心执行链路

用户点击内容脚本按钮后，执行如下链路：

1. `fillForm()` 触发流程
2. `extractFields()` 扫描当前页面并生成字段规则
3. 根据 URL 选择对应 mock 数据
4. 针对每条规则构造执行器 `getFormElementExecutor()`
5. 通过 `executeSequentially()` 串行执行，降低事件冲突
6. `handleFilledInfo()` 输出统计日志

## 3. 数据结构设计

### 3.1 字段规则

```ts
type TRule = {
  label: string
  type: "input" | "textarea" | "select" | "education"
  options?: string[]
}
```

### 3.2 mock 索引

将 mock 列表统一映射为：

```ts
Map<normalizedLabel, value>
```

其中 `value` 支持：

- `string`：文本输入
- `string[]`：单选/下拉类字段
- `Education[]`：教育列表

## 4. 字段提取策略

1. 选择 Greenhouse 申请表主体节点（`form#application_form`，不足时回退全局）
2. 读取 `label` 文本并做清洗（去 `*`、空白、特殊符号）
3. 从同一字段容器识别控件类型：
   - `input/textarea` -> 文本类
   - `select` -> 下拉类，附带 option 列表
4. 识别教育区块：
   - 根据标题关键字（education/school/degree/discipline）
   - 归类为 `education` 复合字段
5. 字段去重并打印结果到控制台

## 5. 填充策略

### 5.1 文本填充

- 按 label 从 mock map 取值
- 调用 `fillDefaultInputField()` 触发 input/change/blur 事件

### 5.2 下拉填充

- 从 mock 取值（优先数组首项）
- 用 `findMatchOption()` 做最佳匹配
- 设置 `select.value` 并派发 change 事件

### 5.3 教育列表填充

- 从 mock 读取 `Education` 数组
- 按每条教育经历逐项填 School/Degree/Discipline/Start/End
- 支持页面已有项填充；如果页面暴露新增按钮则尝试补充新增项

## 6. 统计与日志

记录三类集合：

- `totalFields`
- `filledFields`
- `unfilledFields`

输出：

1. 填充总数与成功数
2. 未填充字段列表
3. 关键失败原因（找不到元素/找不到 mock 值）

## 7. 边界与降级策略

1. 同名字段：按就近容器选择第一个可见元素
2. mock 未命中：写入未填充列表，不中断全流程
3. 页面异步渲染：执行器串行 + 默认延迟
4. 复杂自定义组件：无法直接定位时仅记录日志，不强行操作

## 8. 验收标准

针对 `README.md` 指定的两条链接：

1. 点击按钮后页面出现自动填充行为
2. 文本和下拉字段有可见填充值
3. 控制台输出字段提取与统计信息
4. 未能匹配字段必须在未填充列表中出现

