import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { ClubData, Worker } from "../lib/club-types";
import {
  buildClubExportWorkbookData,
  createClubExportBuffer,
} from "../utils/exportDataToExcel";

const now = Date.parse("2026-09-25T05:00:00.000Z");
const workerA = {
  id: "worker-a",
  name: "甲打手",
  tier: "1档",
  workerType: "standard",
  order: 0,
  status: "idle",
  total_completed_orders: 1,
  joined_at: Date.parse("2026-09-01T00:00:00.000Z"),
  settlement_config: { interval_days: 3, reminder_hours: 72 },
  active_period_id: "period-a",
} as unknown as Worker;
const workerB: Worker = {
  id: "worker-b",
  name: "乙陪玩",
  gender: "female",
  tier: null,
  workerType: "entertainment",
  order: 1,
  status: "idle",
  total_completed_orders: 1,
  joined_at: Date.parse("2026-09-02T00:00:00.000Z"),
  settlement_config: { interval_days: 3, reminder_hours: 72 },
  active_period_id: null,
};

const data: ClubData = {
  workers: [workerA, workerB],
  folders: [
    { id: "folder-root", name: "热门推荐", parentId: null, order: 0, createdAt: now - 10_000 },
    { id: "folder-child", name: "高端代练", parentId: "folder-root", order: 0, createdAt: now - 9_000 },
  ],
  menu: [
    {
      id: "menu-companion",
      service_name: "双人陪玩",
      folderId: "folder-child",
      order: 0,
      order_type: "companion",
      base_price: 0,
      hourly_rate: 100,
      commission_mode: "by_tier",
      club_commission_rate: 0,
      tier_commission_rates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 20 },
      split_type: "equal",
      tiered_ratios: null,
      eligible_tiers: ["1档", "2档", "3档"],
    },
  ],
  orders: [
    {
      id: "order-1",
      menu_item_id: "menu-companion",
      assigned_worker_ids: ["worker-a", "worker-b"],
      order_type: "companion",
      hours: 2,
      hourly_rate_snapshot: 100,
      split_type: "equal",
      status: "completed",
      tip: 10,
      tips_by_worker: { "worker-a": 10, "worker-b": 0 },
      final_club_income: 51.75,
      final_worker_incomes: [
        { workerId: "worker-a", amount: 96.25 },
        { workerId: "worker-b", amount: 92 },
      ],
      special_requirements: [{ name: "指定英雄", price: 30 }],
      base_price_snapshot: 200,
      special_total: 30,
      total_price: 230,
      order_original_total: 230,
      created_at: "2026-09-24T08:00:00.000Z",
      completed_at: "2026-09-24T10:00:00.000Z",
      pricing_snapshot: {
        service_name: "双人陪玩",
        order_type: "companion",
        hourly_rate: 100,
        base_price: 200,
        commission_mode: "by_tier",
        club_commission_rate: 0,
        tier_commission_rates: { "1档": 25, "2档": 20, "3档": 15, "娱乐陪玩": 20 },
        split_type: "equal",
        tiered_ratios: null,
        payout_weights: [
          { workerId: "worker-a", workerName: "甲打手", workerType: "standard", tier: "1档", weight: 50 },
          { workerId: "worker-b", workerName: "乙陪玩", workerType: "entertainment", tier: null, weight: 50 },
        ],
      },
      settled: false,
      settlement_id: null,
      settlement_ids_by_worker: {},
      settlement_period_id: "period-a",
      settlement_period_ids_by_worker: { "worker-a": "period-a", "worker-b": "period-b" },
    },
  ],
  settlementPeriods: [
    {
      id: "period-a",
      worker_id: "worker-a",
      started_at: now - 5 * 24 * 60 * 60 * 1_000,
      ended_at: now - 4 * 24 * 60 * 60 * 1_000,
      status: "settled",
      settlement_record_id: "settlement-a",
    },
  ],
  settlementRecords: [
    {
      id: "settlement-a",
      period_id: "period-a",
      worker_id: "worker-a",
      worker_name_snapshot: "甲打手",
      worker_type_snapshot: "standard",
      period_start: now - 5 * 24 * 60 * 60 * 1_000,
      period_end: now - 4 * 24 * 60 * 60 * 1_000,
      order_ids: ["order-1"],
      order_details: [{
        order_id: "order-1",
        service_name: "双人陪玩",
        completed_at: "2026-09-24T10:00:00.000Z",
        worker_amount: 96.25,
      }],
      total_orders: 1,
      total_amount: 96.25,
      status: "pending",
      paid_at: null,
      note: "",
      created_at: now - 80 * 60 * 60 * 1_000,
    },
  ],
};

const exportData = buildClubExportWorkbookData(data, now);
const emptyExportData = buildClubExportWorkbookData({
  workers: [],
  menu: [],
  folders: [],
  orders: [],
  settlementPeriods: [],
  settlementRecords: [],
}, now);
assert.equal(emptyExportData.sheets.length, 7, "空数据也必须能够完整导出七个 Sheet");
assert.equal(emptyExportData.summary.totalOrders, 0, "空数据汇总必须保持为零");
assert.deepEqual(
  exportData.sheets.map((sheet) => sheet.name),
  ["打手信息", "价格表", "订单记录", "结算记录", "结算周期", "文件夹结构", "汇总统计"],
  "必须生成全部七个中文 Sheet",
);
assert.equal(exportData.sheets[0].rows[0][2], "男", "旧打手缺失 gender 时应按男导出");
assert.equal(exportData.sheets[0].rows[1][2], "女", "女性标签应正确导出");
assert.equal(exportData.sheets[0].rows[0][7], 96.25, "打手累计收入应包含个人打赏");
assert.equal(exportData.sheets[1].rows[0][15], "热门推荐 / 高端代练", "应递归生成完整文件夹路径");
assert.match(String(exportData.sheets[2].rows[0][14]), /甲打手:¥10\.00/, "应导出个人打赏明细");
assert.match(String(exportData.sheets[2].rows[0][16]), /乙陪玩:¥92\.00/, "应导出每名打手最终收入");
assert.equal(exportData.summary.totalClubIncome, 51.75);
assert.equal(exportData.summary.totalWorkerExpense, 188.25);
assert.equal(exportData.summary.monthOrders, 1);
assert.equal(exportData.summary.pendingSettlementAmount, 96.25);
assert.equal(exportData.summary.overdueSettlementCount, 1);

const generated = await createClubExportBuffer(data, now);
assert.equal(generated.fileName, "DeltaClub_数据导出_2026-09-25_13-00.xlsx");
assert.ok(generated.buffer.byteLength > 10_000, "导出的 xlsx 不应为空");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(generated.buffer as never);
assert.equal(workbook.worksheets.length, 7, "生成后的文件应能被重新读取且包含七个 Sheet");
assert.equal(workbook.getWorksheet("订单记录")?.getCell("A2").value, "order-1");
assert.equal(workbook.getWorksheet("价格表")?.getCell("P2").value, "热门推荐 / 高端代练");
assert.equal(workbook.getWorksheet("打手信息")?.getCell("H2").numFmt, '"¥"#,##0.00');
assert.equal(
  workbook.getWorksheet("打手信息")?.getCell("A1").fill.type,
  "pattern",
  "表头应带有扁平化背景样式",
);

console.log("Excel export verification passed: 7 sheets, readable details, totals, styles, and legacy defaults.");
