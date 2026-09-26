import assert from "node:assert/strict";
import type {
  Folder,
  OrderPricingSnapshot,
  PriceMenuItem,
  Worker,
} from "../lib/club-types";
import {
  buildFolderTree,
  getDescendantFolderIds,
  isDescendant,
} from "../lib/folder-tree";
import { calculateSettlement } from "../lib/settlement";
import { isWorkerEligibleForMenuItem } from "../lib/worker-eligibility";
import { normalizeWorkerGender } from "../lib/worker-profile";

const folders: Folder[] = [
  { id: "root-b", name: "根 B", parentId: null, order: 0, createdAt: 2 },
  { id: "root-a", name: "根 A", parentId: null, order: 1, createdAt: 1 },
  { id: "child", name: "子级", parentId: "root-a", order: 0, createdAt: 3 },
  { id: "grandchild", name: "孙级", parentId: "child", order: 0, createdAt: 4 },
  { id: "orphan", name: "孤儿", parentId: "missing", order: 2, createdAt: 5 },
  { id: "legacy", name: "旧文件夹", order: 3, createdAt: 6 } as Folder,
];

const tree = buildFolderTree(folders);
assert.deepEqual(
  tree.map((folder) => folder.id),
  ["root-b", "root-a", "orphan", "legacy"],
  "根级、孤儿与旧数据应按同级顺序构建",
);
assert.equal(tree[1].children[0].id, "child", "应构建第一层子文件夹");
assert.equal(tree[1].children[0].children[0].id, "grandchild", "应支持继续递归嵌套");
assert.equal(tree[1].children[0].children[0].depth, 2, "递归节点应记录可视深度");
assert.deepEqual(
  getDescendantFolderIds(folders, "root-a"),
  ["child", "grandchild"],
  "应返回全部子孙文件夹",
);
assert.equal(isDescendant(folders, "root-a", "grandchild"), true, "应识别孙级非法投放目标");
assert.equal(isDescendant(folders, "grandchild", "root-a"), false, "父级不是子级的子孙");

const cyclicTree = buildFolderTree([
  { id: "cycle-a", name: "A", parentId: "cycle-b", order: 0, createdAt: 1 },
  { id: "cycle-b", name: "B", parentId: "cycle-a", order: 1, createdAt: 2 },
]);
assert.deepEqual(
  cyclicTree.map((folder) => folder.id),
  ["cycle-a", "cycle-b"],
  "异常循环数据应安全回退到根目录而不是无限递归",
);

const uniformItem: PriceMenuItem = {
  id: "uniform",
  service_name: "统一抽成服务",
  folderId: null,
  order: 0,
  order_type: "escort",
  base_price: 100,
  hourly_rate: 0,
  commission_mode: "uniform",
  club_commission_rate: 20,
  tier_commission_rates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 10 },
  split_type: "single",
  tiered_ratios: null,
  eligible_tiers: ["1档", "2档", "3档"],
};
const entertainmentWorker: Worker = {
  id: "entertainment",
  name: "娱乐陪玩",
  gender: "female",
  tier: null,
  workerType: "entertainment",
  order: 0,
  status: "idle",
  total_completed_orders: 0,
  total_tip_earnings: 0,
  joined_at: 0,
  settlement_config: {
    interval_days: 3,
    reminder_hours: 72,
  },
  active_period_id: null,
};
const standardWorker: Worker = {
  ...entertainmentWorker,
  id: "standard",
  name: "普通打手",
  gender: "male",
  tier: "1档",
  workerType: "standard",
};

assert.equal(normalizeWorkerGender(undefined), "male", "旧打手缺失性别时应兼容为男");
assert.equal(normalizeWorkerGender("female"), "female", "应保留有效的女性标签");
assert.throws(() => normalizeWorkerGender("unknown"), /有效性别/, "应拒绝非法性别值");

assert.equal(
  isWorkerEligibleForMenuItem(uniformItem, entertainmentWorker),
  true,
  "娱乐陪玩应可参加统一抽成订单",
);
assert.equal(
  isWorkerEligibleForMenuItem({ ...uniformItem, split_type: "equal" }, entertainmentWorker),
  true,
  "娱乐陪玩应可参加统一抽成的双人平分订单",
);
assert.equal(
  isWorkerEligibleForMenuItem({ ...uniformItem, commission_mode: "by_tier" }, entertainmentWorker),
  true,
  "娱乐陪玩应可参加按档位抽成订单并使用专属比例",
);
assert.equal(
  isWorkerEligibleForMenuItem({ ...uniformItem, split_type: "tiered" }, entertainmentWorker),
  false,
  "娱乐陪玩不能参加依赖档位权重的旧 tiered 订单",
);
assert.equal(
  isWorkerEligibleForMenuItem(uniformItem, standardWorker),
  true,
  "普通打手仍按原档位规则参与",
);

const entertainmentSnapshot: OrderPricingSnapshot = {
  service_name: "娱乐陪玩统一抽成",
  order_type: "escort",
  hourly_rate: 0,
  base_price: 100,
  commission_mode: "uniform",
  club_commission_rate: 20,
  tier_commission_rates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 10 },
  split_type: "single",
  tiered_ratios: null,
  payout_weights: [{
    workerId: entertainmentWorker.id,
    workerName: entertainmentWorker.name,
    workerType: "entertainment",
    tier: null,
    weight: 100,
  }],
};
const settlement = calculateSettlement(
  entertainmentSnapshot,
  { [entertainmentWorker.id]: 10 },
  100,
);
assert.equal(settlement.club_income, 20, "娱乐陪玩统一抽成仍使用服务统一比例");
assert.deepEqual(
  settlement.worker_incomes,
  [{ workerId: entertainmentWorker.id, amount: 90 }],
  "娱乐陪玩工资公式与个人打赏规则必须保持不变",
);
const mixedByTierSettlement = calculateSettlement(
  {
    ...entertainmentSnapshot,
    service_name: "一档与娱乐陪玩双人单",
    base_price: 168,
    commission_mode: "by_tier",
    split_type: "equal",
    payout_weights: [
      {
        workerId: standardWorker.id,
        workerName: standardWorker.name,
        workerType: "standard",
        tier: "1档",
        weight: 50,
      },
      {
        workerId: entertainmentWorker.id,
        workerName: entertainmentWorker.name,
        workerType: "entertainment",
        tier: null,
        weight: 50,
      },
    ],
  },
  {},
  168,
);
assert.deepEqual(
  mixedByTierSettlement.worker_incomes,
  [
    { workerId: standardWorker.id, amount: 63 },
    { workerId: entertainmentWorker.id, amount: 75.6 },
  ],
  "168 元按档位双人单必须分别使用一档与娱乐陪玩抽成率",
);
assert.equal(
  mixedByTierSettlement.club_income,
  29.4,
  "168 元样例俱乐部抽成必须严格等于 29.4 元",
);

console.log("Management verification passed: nested folders, cycle guards, gender compatibility, entertainment eligibility, and dedicated commission.");
