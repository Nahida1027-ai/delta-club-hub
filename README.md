# Delta Club Hub

> 三角洲俱乐部管理系统——一个为三角洲游戏俱乐部打造的现代化运营管理后台。

Delta Club Hub 面向陪玩、护航和代练俱乐部的日常运营，覆盖打手管理、价格配置、订单派发、工资结算、财务统计与 Excel 数据归档。界面延续 Apple 扁平化与毛玻璃视觉风格，并通过流畅动效和拖拽交互提升高频运营效率。

在线站点（需要相应访问权限）：[Delta Force Club Hub](https://delta-force-club-hub.zd5m6m5fzy.chatgpt.site)

## 功能特性

### 打手管理

- 添加、编辑、删除打手，状态在空闲与忙碌之间自动联动。
- 普通打手支持 1档、2档、3档；娱乐陪玩不设档位。
- 支持普通打手、娱乐陪玩类型与男女标签。
- 看板支持筛选和拖拽排序，顺序持久保存。

### 价格表管理

- 支持固定价格的护航单和按小时计价的陪玩单。
- 支持统一抽成与按档位抽成，包含娱乐陪玩专属抽成比例。
- 支持单人全吃、双人平分等分配方式。
- 支持无限层级嵌套文件夹、跨层级移动与自定义排序。
- 删除服务前检查进行中订单，历史订单继续使用价格快照。

### 接单台

- 老板点单并从符合条件的空闲打手中选择接单人员。
- 支持自定义订单编号、临时抽成和临时折扣。
- 支持多条特殊需求与实时总价预览。
- 陪玩单支持 0.5 小时步进的自定义时长计价。
- 下单时保存价格、抽成、分配规则等完整快照。

### 订单管理

- 管理进行中与已完成订单，支持编辑展示时间和订单编号。
- 支持多次换人，每笔转单费独立记录并进入对应新打手的工资周期。
- 支持安全删除历史订单，并同步回退关联统计与结算数据。
- “全部时间”视图支持按时间排序与自定义拖拽排序。

### 打赏系统

- 订单结束时可分别为每位打手填写打赏金额。
- 打赏 100% 即时归对应打手，不参与俱乐部抽成。
- 打赏不进入工资结算周期，与订单工资分开统计。

### 工资结算

- 打手首次接单时自动创建独立工资结算周期。
- 管理员手动结束周期、生成结算记录并标记已发放。
- 支持删除活跃周期和历史结算记录，订单关联关系同步恢复。
- 支持超期未发放提醒、周期内订单明细与转单费明细。
- “全部时间”结算记录支持独立的自定义拖拽排序。

### 数据统计与导出

- 总览仪表盘、月度收入趋势、每日俱乐部抽成变化。
- 打手完成单量、订单工资、即时打赏和综合收入排行。
- 俱乐部收入、订单工资支出、打赏支出等财务汇总。
- 一键导出打手、价格表、订单、结算、周期、文件夹与汇总统计到多 Sheet Excel 文件。

### 交互与视觉

- Apple 风格的深色扁平化界面与毛玻璃卡片。
- Framer Motion 弹簧动画、数字变化与列表过渡。
- `@dnd-kit` 提供鼠标、触摸与键盘可访问的拖拽排序。
- 响应式布局适配桌面、平板和移动端。

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端框架 | Next.js 16、React 19、TypeScript |
| 构建与运行 | Vinext、Vite、Cloudflare Workers |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand 5 |
| 表单与校验 | React Hook Form、Zod |
| 动效 | Framer Motion |
| 拖拽 | `@dnd-kit/core`、`@dnd-kit/sortable` |
| 图表 | Recharts |
| Excel 导出 | ExcelJS |
| 数据库 | Cloudflare D1、Drizzle ORM |
| 本机偏好 | localStorage（排序模式、展开状态等） |

## 项目结构

本项目保留 Next.js App Router 的实际目录结构，没有为了形式改造成 `src/`，避免破坏现有导入路径和部署配置。

```text
delta-club-hub/
├── app/                    # 页面入口与服务端 API
├── components/             # 业务组件、弹窗、看板和 UI 组件
├── store/                  # Zustand 状态管理
├── lib/                    # 类型、财务、结算、导出与排序工具
├── utils/                  # 通用工具函数
├── db/                     # Drizzle 数据库定义与访问
├── drizzle/                # Cloudflare D1 数据库迁移
├── hooks/                  # React Hooks
├── public/                 # 静态资源
├── scripts/                # 构建与业务回归验证脚本
├── video/                  # 项目演示视频源码与素材（可选）
├── .openai/hosting.json    # Sites 部署配置
├── package.json
├── README.md
├── CHANGELOG.md
└── LICENSE
```

## 快速开始

### 环境要求

- Node.js `>= 22.13.0`
- npm

```bash
# 克隆仓库
git clone https://github.com/Nahida1027-ai/delta-club-hub.git
cd delta-club-hub

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

开发服务器默认使用 `5173` 端口。生产构建完成后，可使用 `npm start` 在本地预览 Worker 与 D1 环境。

## 验证命令

```bash
npm run lint
npm run verify:settlement
npm run verify:management
npm run verify:payroll
npm run verify:export
npm run build
```

## 使用说明

1. 首次使用：添加打手 → 配置价格表与抽成规则 → 在接单台创建订单。
2. 订单结束：填写每位打手的即时打赏 → 确认结束 → 订单工资进入对应结算周期。
3. 工资结算：选择打手当前周期 → 手动结算 → 核对后标记已发放。
4. 数据导出：点击页面右上角“导出所有数据”，下载多 Sheet Excel 文件。

## 数据与隐私

- 业务数据保存于部署环境的 Cloudflare D1 数据库。
- localStorage 仅保存本机 UI 偏好，不作为财务数据来源。
- `.env`、本地数据库、构建产物、依赖目录和视频输出均已加入 Git 忽略规则。

## 版本历史

当前版本：`v1.17.0`。完整迭代记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

本项目采用 [MIT License](./LICENSE)。
