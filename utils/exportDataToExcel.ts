import type {
  ClubData,
  Folder,
  Order,
  PriceMenuItem,
  SettlementRecord,
  Worker,
} from "@/lib/club-types";
import { isSettlementOverdue } from "@/lib/payroll-settlement";
import {
  normalizeOrderType,
  splitLabel,
} from "@/lib/settlement";
import {
  resolveWorkerOrderEarnings,
  resolveWorkerTipEarnings,
  totalEarningsMap,
} from "@/lib/order-earnings";

type ExportCell = string | number | boolean;

interface ExportSheetDefinition {
  name: string;
  headers: string[];
  rows: ExportCell[][];
  currencyColumns?: number[];
  integerColumns?: number[];
  wrapColumns?: number[];
}

export interface ClubExportWorkbookData {
  sheets: ExportSheetDefinition[];
  summary: {
    totalClubIncome: number;
    totalOrderWageExpense: number;
    totalTipExpense: number;
    totalWorkerExpense: number;
    totalOrders: number;
    totalWorkers: number;
    monthClubIncome: number;
    monthOrderWageExpense: number;
    monthTipExpense: number;
    monthWorkerExpense: number;
    monthOrders: number;
    pendingSettlementAmount: number;
    overdueSettlementCount: number;
  };
}

const MONEY_FORMAT = '"¥"#,##0.00';
const INTEGER_FORMAT = "#,##0";
const DEFAULT_INTERVAL_DAYS = 3;
const DEFAULT_REMINDER_HOURS = 72;

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function displayMoney(value: number): string {
  return `¥${roundMoney(value).toFixed(2)}`;
}

function safeNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dateParts(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatExcelDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const parts = dateParts(value);
  if (!parts) return "-";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function monthKey(value: string | number | Date): string {
  const parts = dateParts(value);
  return parts ? `${parts.year}-${parts.month}` : "";
}

function buildExportFileName(now: number): string {
  const parts = dateParts(now);
  if (!parts) return "DeltaClub_数据导出.xlsx";
  return `DeltaClub_数据导出_${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}.xlsx`;
}

function serializeExtraFields(
  value: object,
  knownFields: readonly string[],
): string {
  const known = new Set(knownFields);
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, entry]) => !known.has(key) && typeof entry !== "function" && entry !== undefined,
  );
  if (!entries.length) return "";
  try {
    return JSON.stringify(
      Object.fromEntries(entries),
      (_, entry) => typeof entry === "bigint" ? String(entry) : entry,
    );
  } catch {
    return "存在无法序列化的扩展字段";
  }
}

function folderPathResolver(folders: Folder[]) {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));

  return (folderId: string | null | undefined, includeRoot = false): string => {
    if (!folderId) return includeRoot ? "根" : "未分类";
    const names: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null | undefined = folderId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const folder = foldersById.get(currentId);
      if (!folder) break;
      names.push(folder.name || "未命名文件夹");
      currentId = folder.parentId ?? null;
    }
    const path = names.reverse().join(" / ");
    if (!path) return includeRoot ? "根" : "未分类";
    return includeRoot ? `根 / ${path}` : path;
  };
}

function workerNameResolver(workers: Worker[]) {
  const workersById = new Map(workers.map((worker) => [worker.id, worker]));
  return (workerId: string, order?: Order): string => (
    workersById.get(workerId)?.name ??
    order?.pricing_snapshot?.payout_weights?.find((weight) => weight.workerId === workerId)?.workerName ??
    workerId ??
    "未知打手"
  );
}

function settlementIds(order: Order): string {
  return [...new Set([
    ...Object.values(order.settlement_ids_by_worker ?? {}),
    order.settlement_id,
  ].filter((value): value is string => Boolean(value)))].join(", ");
}

function settlementPeriodIds(order: Order): string {
  return [...new Set([
    ...Object.values(order.settlement_period_ids_by_worker ?? {}),
    order.settlement_period_id,
  ].filter((value): value is string => Boolean(value)))].join(", ");
}

function specialRequirementsText(order: Order): string {
  return (order.special_requirements ?? [])
    .map((requirement) => `${requirement.name || "未命名需求"}+${displayMoney(safeNumber(requirement.price))}`)
    .join("; ");
}

function pricingSnapshotText(item: PriceMenuItem | undefined, order: Order): string {
  const snapshot = order.pricing_snapshot;
  if (!snapshot) return "";
  if (snapshot.commission_mode === "by_tier") {
    const rates = snapshot.tier_commission_rates ?? item?.tier_commission_rates;
    return `按档位抽成：1档 ${safeNumber(rates?.["1档"])}%；2档 ${safeNumber(rates?.["2档"])}%；3档 ${safeNumber(rates?.["3档"])}%；娱乐陪玩 ${safeNumber(rates?.["娱乐陪玩"])}%`;
  }
  return `统一抽成 ${safeNumber(snapshot.club_commission_rate, item?.club_commission_rate ?? 0)}%`;
}

function payoutWeightsText(order: Order): string {
  return (order.pricing_snapshot?.payout_weights ?? [])
    .map((weight) => `${weight.workerName || weight.workerId}:${safeNumber(weight.weight)}%`)
    .join("; ");
}

export function buildClubExportWorkbookData(
  data: ClubData,
  now = Date.now(),
): ClubExportWorkbookData {
  const workers = data.workers ?? [];
  const menu = data.menu ?? [];
  const folders = data.folders ?? [];
  const orders = data.orders ?? [];
  const settlementRecords = data.settlementRecords ?? [];
  const settlementPeriods = data.settlementPeriods ?? [];
  const completedOrders = orders.filter((order) => order.status === "completed");
  const resolveFolderPath = folderPathResolver(folders);
  const resolveWorkerName = workerNameResolver(workers);
  const menuById = new Map(menu.map((item) => [item.id, item]));
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));

  const workerRows = workers.map((worker) => {
    const orderIncome = completedOrders.reduce(
      (sum, order) => sum + safeNumber(resolveWorkerOrderEarnings(order)[worker.id]),
      0,
    );
    const tipIncome = completedOrders.reduce(
      (sum, order) => sum + safeNumber(resolveWorkerTipEarnings(order)[worker.id]),
      0,
    );
    return [
      worker.id,
      worker.name || "-",
      worker.gender === "female" ? "女" : "男",
      worker.workerType === "entertainment" ? "娱乐陪玩" : "普通打手",
      worker.workerType === "entertainment" || !worker.tier ? "无" : worker.tier,
      worker.status === "busy" ? "忙碌" : "空闲",
      safeNumber(worker.total_completed_orders),
      roundMoney(orderIncome),
      roundMoney(tipIncome),
      roundMoney(orderIncome + tipIncome),
      safeNumber(worker.settlement_config?.interval_days, DEFAULT_INTERVAL_DAYS),
      safeNumber(worker.settlement_config?.reminder_hours, DEFAULT_REMINDER_HOURS),
      worker.active_period_id ?? "",
      formatExcelDateTime(worker.joined_at),
      safeNumber(worker.order),
      serializeExtraFields(worker, [
        "id", "name", "gender", "workerType", "tier", "status",
        "total_completed_orders", "total_tip_earnings", "settlement_config", "active_period_id",
        "joined_at", "order",
      ]),
    ];
  });

  const menuRows = menu.map((item) => {
    const orderType = normalizeOrderType(item.order_type);
    const rates = item.tier_commission_rates ?? {
      "1档": 0,
      "2档": 0,
      "3档": 0,
      "娱乐陪玩": 0,
    };
    return [
      item.id,
      item.service_name || "-",
      orderType === "companion" ? "陪玩单" : "护航单",
      orderType === "escort" ? roundMoney(safeNumber(item.base_price)) : "",
      orderType === "companion" ? roundMoney(safeNumber(item.hourly_rate)) : "",
      item.commission_mode === "by_tier" ? "按档位抽成" : "统一抽成",
      item.commission_mode === "uniform" ? safeNumber(item.club_commission_rate) : "",
      safeNumber(rates["1档"]),
      safeNumber(rates["2档"]),
      safeNumber(rates["3档"]),
      safeNumber(rates["娱乐陪玩"]),
      splitLabel(item.split_type),
      item.tiered_ratios
        ? `1档 ${safeNumber(item.tiered_ratios["1档"])}%；2档 ${safeNumber(item.tiered_ratios["2档"])}%`
        : "",
      (item.eligible_tiers ?? []).join(", "),
      item.folderId ?? "",
      resolveFolderPath(item.folderId),
      safeNumber(item.order),
      "-",
      serializeExtraFields(item, [
        "id", "service_name", "folderId", "order", "order_type", "base_price",
        "hourly_rate", "commission_mode", "club_commission_rate",
        "tier_commission_rates", "split_type", "tiered_ratios", "eligible_tiers",
      ]),
    ];
  });

  const orderRows = orders.map((order) => {
    const tipsByWorker = resolveWorkerTipEarnings(order);
    const orderEarnings = resolveWorkerOrderEarnings(order);
    const item = menuById.get(order.menu_item_id);
    const assignedNames = (order.assigned_worker_ids ?? []).map((id) => resolveWorkerName(id, order));
    const tipDetails = Object.entries(tipsByWorker)
      .map(([workerId, amount]) => `${resolveWorkerName(workerId, order)}:${displayMoney(amount)}`)
      .join("; ");
    const incomeDetails = (order.final_worker_incomes ?? [])
      .map((income) => `${resolveWorkerName(income.workerId, order)}:${displayMoney(income.amount)}`)
      .join("; ");
    const orderIncomeDetails = Object.entries(orderEarnings)
      .map(([workerId, amount]) => `${resolveWorkerName(workerId, order)}:${displayMoney(amount)}`)
      .join("; ");
    const tipIncomeDetails = Object.entries(tipsByWorker)
      .map(([workerId, amount]) => `${resolveWorkerName(workerId, order)}:${displayMoney(amount)}`)
      .join("; ");
    const totalTip = Object.values(tipsByWorker).reduce((sum, amount) => sum + safeNumber(amount), 0);
    const orderType = normalizeOrderType(order.order_type);
    return [
      order.id,
      order.menu_item_id ?? "",
      order.pricing_snapshot?.service_name ?? item?.service_name ?? "-",
      orderType === "companion" ? "陪玩单" : "护航单",
      orderType === "companion" ? safeNumber(order.hours, 1) : "",
      orderType === "companion" ? roundMoney(safeNumber(order.hourly_rate_snapshot)) : "",
      formatExcelDateTime(order.created_at),
      formatExcelDateTime(order.completed_at),
      order.status === "completed" ? "已完成" : "进行中",
      assignedNames.join(", "),
      roundMoney(safeNumber(order.base_price_snapshot)),
      specialRequirementsText(order),
      roundMoney(safeNumber(order.special_total)),
      roundMoney(safeNumber(order.total_price, order.order_original_total)),
      tipDetails,
      roundMoney(totalTip),
      orderIncomeDetails,
      tipIncomeDetails,
      incomeDetails,
      order.final_club_income === null || order.final_club_income === undefined
        ? ""
        : roundMoney(order.final_club_income),
      splitLabel(order.split_type ?? order.pricing_snapshot?.split_type ?? "single"),
      pricingSnapshotText(item, order),
      payoutWeightsText(order),
      order.settled ? "是" : "否",
      settlementIds(order),
      settlementPeriodIds(order),
      serializeExtraFields(order, [
        "id", "menu_item_id", "assigned_worker_ids", "order_type", "hours",
        "hourly_rate_snapshot", "split_type", "status", "tip", "tips_by_worker",
        "worker_order_earnings", "worker_tip_earnings", "final_club_income",
        "final_worker_incomes", "special_requirements",
        "base_price_snapshot", "special_total", "total_price", "order_original_total",
        "created_at", "completed_at", "pricing_snapshot", "settled", "settlement_id",
        "settlement_ids_by_worker", "settlement_period_id", "settlement_period_ids_by_worker",
      ]),
    ];
  });

  const settlementRecordRows = settlementRecords.map((record) => {
    const detailTipTotal = (record.order_details ?? []).reduce(
      (sum, detail) => sum + safeNumber(detail.tip_amount),
      0,
    );
    const fallbackTipTotal = (record.order_ids ?? []).reduce((sum, orderId) => {
      const order = orders.find((candidate) => candidate.id === orderId);
      return sum + (order ? safeNumber(resolveWorkerTipEarnings(order)[record.worker_id]) : 0);
    }, 0);
    return [
      record.id,
      record.worker_id,
      record.worker_name_snapshot || workerById.get(record.worker_id)?.name || record.worker_id,
      record.worker_type_snapshot === "entertainment" ? "娱乐陪玩" : "普通打手",
      record.period_id ?? "",
      formatExcelDateTime(record.period_start),
      formatExcelDateTime(record.period_end),
      safeNumber(record.total_orders, record.order_ids?.length ?? 0),
      roundMoney(safeNumber(record.total_amount)),
      roundMoney(detailTipTotal || fallbackTipTotal),
      record.status === "paid" ? "已发放" : "待发放",
      formatExcelDateTime(record.paid_at),
      record.note ?? "",
      (record.order_ids ?? []).join(", "),
      formatExcelDateTime(record.created_at),
      serializeExtraFields(record, [
        "id", "period_id", "worker_id", "worker_name_snapshot", "worker_type_snapshot",
        "period_start", "period_end", "order_ids", "order_details", "total_orders",
        "total_amount", "status", "paid_at", "note", "created_at",
      ]),
    ];
  });

  const settlementPeriodRows = settlementPeriods.map((period) => [
    period.id,
    period.worker_id,
    workerById.get(period.worker_id)?.name ?? period.worker_id,
    formatExcelDateTime(period.started_at),
    formatExcelDateTime(period.ended_at),
    period.status === "settled" ? "已结算" : "进行中",
    period.settlement_record_id ?? "",
    serializeExtraFields(period, [
      "id", "worker_id", "started_at", "ended_at", "status", "settlement_record_id",
    ]),
  ]);

  const folderRows = folders.map((folder) => {
    const parentId = folder.parentId ?? null;
    return [
      folder.id,
      folder.name || "-",
      parentId ?? "",
      parentId ? folders.find((candidate) => candidate.id === parentId)?.name ?? "未知文件夹" : "根",
      resolveFolderPath(folder.id, true),
      safeNumber(folder.order),
      formatExcelDateTime(folder.createdAt),
      serializeExtraFields(folder, ["id", "name", "parentId", "order", "createdAt"]),
    ];
  });

  const currentMonth = monthKey(now);
  const completedThisMonth = completedOrders.filter(
    (order) => Boolean(order.completed_at) && monthKey(order.completed_at!) === currentMonth,
  );
  const totalClubIncome = completedOrders.reduce(
    (sum, order) => sum + safeNumber(order.final_club_income),
    0,
  );
  const totalOrderWageExpense = completedOrders.reduce(
    (sum, order) => sum + totalEarningsMap(resolveWorkerOrderEarnings(order)),
    0,
  );
  const totalTipExpense = completedOrders.reduce(
    (sum, order) => sum + totalEarningsMap(resolveWorkerTipEarnings(order)),
    0,
  );
  const totalWorkerExpense = totalOrderWageExpense + totalTipExpense;
  const monthClubIncome = completedThisMonth.reduce(
    (sum, order) => sum + safeNumber(order.final_club_income),
    0,
  );
  const monthOrderWageExpense = completedThisMonth.reduce(
    (sum, order) => sum + totalEarningsMap(resolveWorkerOrderEarnings(order)),
    0,
  );
  const monthTipExpense = completedThisMonth.reduce(
    (sum, order) => sum + totalEarningsMap(resolveWorkerTipEarnings(order)),
    0,
  );
  const monthWorkerExpense = monthOrderWageExpense + monthTipExpense;
  const pendingSettlementRecords = settlementRecords.filter((record) => record.status === "pending");
  const pendingSettlementAmount = pendingSettlementRecords.reduce(
    (sum, record) => sum + safeNumber(record.total_amount),
    0,
  );
  const overdueSettlementCount = pendingSettlementRecords.filter((record) =>
    isSettlementOverdue(
      record,
      workerById.get(record.worker_id)?.settlement_config?.reminder_hours ?? DEFAULT_REMINDER_HOURS,
      now,
    ),
  ).length;
  const ranking = workers
    .map((worker) => {
      const workerOrders = completedOrders.filter((order) =>
        (order.assigned_worker_ids ?? []).includes(worker.id),
      );
      return {
        id: worker.id,
        name: worker.name || worker.id,
        orders: workerOrders.length,
        orderIncome: roundMoney(workerOrders.reduce(
          (sum, order) => sum + safeNumber(resolveWorkerOrderEarnings(order)[worker.id]),
          0,
        )),
        tipIncome: roundMoney(workerOrders.reduce(
          (sum, order) => sum + safeNumber(resolveWorkerTipEarnings(order)[worker.id]),
          0,
        )),
      };
    })
    .map((worker) => ({
      ...worker,
      income: roundMoney(worker.orderIncome + worker.tipIncome),
    }))
    .sort((a, b) => b.income - a.income || b.orders - a.orders || a.name.localeCompare(b.name, "zh-CN"));

  const summary = {
    totalClubIncome: roundMoney(totalClubIncome),
    totalOrderWageExpense: roundMoney(totalOrderWageExpense),
    totalTipExpense: roundMoney(totalTipExpense),
    totalWorkerExpense: roundMoney(totalWorkerExpense),
    totalOrders: orders.length,
    totalWorkers: workers.length,
    monthClubIncome: roundMoney(monthClubIncome),
    monthOrderWageExpense: roundMoney(monthOrderWageExpense),
    monthTipExpense: roundMoney(monthTipExpense),
    monthWorkerExpense: roundMoney(monthWorkerExpense),
    monthOrders: completedThisMonth.length,
    pendingSettlementAmount: roundMoney(pendingSettlementAmount),
    overdueSettlementCount,
  };
  const summaryRows: ExportCell[][] = [
    ["汇总指标", "数值", "说明", ""],
    ["俱乐部总收入", summary.totalClubIncome, "全部已完成订单俱乐部抽成之和", ""],
    ["订单工资支出", summary.totalOrderWageExpense, "全部已完成订单、进入工资周期的订单收入", ""],
    ["即时打赏支出", summary.totalTipExpense, "全部已完成订单、已直接归打手的打赏", ""],
    ["打手总支出", summary.totalWorkerExpense, "订单工资支出 + 即时打赏支出", ""],
    ["总订单数", summary.totalOrders, "包含进行中及已完成订单", ""],
    ["总打手数", summary.totalWorkers, "当前打手档案数量", ""],
    ["本月俱乐部收入", summary.monthClubIncome, `${currentMonth} 已完成订单`, ""],
    ["本月订单工资支出", summary.monthOrderWageExpense, `${currentMonth} 进入工资周期的订单收入`, ""],
    ["本月即时打赏支出", summary.monthTipExpense, `${currentMonth} 已直接归打手的打赏`, ""],
    ["本月打手总支出", summary.monthWorkerExpense, `${currentMonth} 订单工资 + 即时打赏`, ""],
    ["本月订单数", summary.monthOrders, `${currentMonth} 已完成订单`, ""],
    ["待发放结算总额", summary.pendingSettlementAmount, "只含订单工资，不含即时打赏", ""],
    ["超期未发放笔数", summary.overdueSettlementCount, "按每名打手的提醒小时判断", ""],
    ["数据导出时间", formatExcelDateTime(now), "北京时间", ""],
    ["", "", "", ""],
    ["打手收入排行", "", "", ""],
    ["排名", "姓名", "总单数", "订单工资累计", "打赏累计", "总收入"],
    ...ranking.map((worker, index) => [
      index + 1,
      worker.name,
      worker.orders,
      worker.orderIncome,
      worker.tipIncome,
      worker.income,
    ]),
  ];

  return {
    summary,
    sheets: [
      {
        name: "打手信息",
        headers: [
          "打手ID", "姓名", "性别", "打手类型", "档位", "当前状态", "累计完成单数",
          "订单工资累计", "即时打赏累计", "累计总收入", "结算间隔天数", "提醒小时",
          "当前活跃周期ID", "加入时间", "排序权重", "其他字段",
        ],
        rows: workerRows,
        currencyColumns: [8, 9, 10],
        integerColumns: [7, 11, 12, 15],
        wrapColumns: [16],
      },
      {
        name: "价格表",
        headers: [
          "服务ID", "服务名称", "订单类型", "基础价格（元）", "每小时价格（元/小时）",
          "抽成模式", "统一抽成比例（%）", "1档抽成（%）", "2档抽成（%）",
          "3档抽成（%）", "娱乐陪玩抽成（%）", "分配模式", "档位分配权重",
          "允许档位", "文件夹ID", "所属文件夹路径", "排序权重", "创建时间", "其他字段",
        ],
        rows: menuRows,
        currencyColumns: [4, 5],
        integerColumns: [17],
        wrapColumns: [13, 14, 16, 19],
      },
      {
        name: "订单记录",
        headers: [
          "订单ID", "服务ID", "服务名称", "订单类型", "陪玩时长（小时）",
          "每小时价格快照", "下单时间", "完成时间", "订单状态", "涉及打手",
          "基础价格快照", "特殊需求明细", "特殊需求总加价", "订单总价", "打赏明细",
          "总打赏", "各打手订单收入（进周期）", "各打手打赏收入（即时）",
          "各打手最终收入", "俱乐部抽成", "分配模式", "抽成规则快照",
          "分配权重快照", "是否已结算", "所属结算记录ID", "所属结算周期ID", "其他字段",
        ],
        rows: orderRows,
        currencyColumns: [6, 11, 13, 14, 16, 20],
        wrapColumns: [10, 12, 15, 17, 18, 19, 22, 23, 25, 26, 27],
      },
      {
        name: "结算记录",
        headers: [
          "结算记录ID", "打手ID", "打手姓名", "打手类型", "结算周期ID",
          "结算周期开始时间", "结算周期结束时间", "包含订单数", "应发工资总额",
          "周期内打赏（即时，不计入工资）", "状态", "发放时间", "备注",
          "关联订单ID列表", "创建时间", "其他字段",
        ],
        rows: settlementRecordRows,
        currencyColumns: [9, 10],
        integerColumns: [8],
        wrapColumns: [13, 14, 16],
      },
      {
        name: "结算周期",
        headers: [
          "周期ID", "打手ID", "打手姓名", "周期开始时间", "周期结束时间",
          "状态", "关联结算记录ID", "其他字段",
        ],
        rows: settlementPeriodRows,
        wrapColumns: [8],
      },
      {
        name: "文件夹结构",
        headers: [
          "文件夹ID", "文件夹名称", "父文件夹ID", "父文件夹名称", "层级路径",
          "排序权重", "创建时间", "其他字段",
        ],
        rows: folderRows,
        integerColumns: [6],
        wrapColumns: [5, 8],
      },
      {
        name: "汇总统计",
        headers: summaryRows[0].map(String),
        rows: summaryRows.slice(1),
        wrapColumns: [1, 3],
      },
    ],
  };
}

function visualLength(value: ExportCell): number {
  const text = String(value ?? "");
  return Array.from(text).reduce(
    (length, character) => length + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1),
    0,
  );
}

function styleWorksheet(
  worksheet: import("exceljs").Worksheet,
  definition: ExportSheetDefinition,
) {
  const headerRows = definition.name === "汇总统计" ? [1, 18] : [1];
  const sectionRows = definition.name === "汇总统计" ? [17] : [];
  const currencyColumns = new Set(definition.currencyColumns ?? []);
  const integerColumns = new Set(definition.integerColumns ?? []);
  const wrapColumns = new Set(definition.wrapColumns ?? []);

  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.properties.defaultRowHeight = 20;
  worksheet.eachRow((row, rowNumber) => {
    row.height = headerRows.includes(rowNumber) ? 28 : 22;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "Arial", size: 10, color: { argb: "FF1C1C1E" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: typeof cell.value === "number" ? "right" : "left",
        wrapText: wrapColumns.has(columnNumber),
      };
      if (!headerRows.includes(rowNumber) && rowNumber % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F8FA" } };
      }
    });
  });

  for (const rowNumber of headerRows) {
    const row = worksheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1C1C1E" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: "FFB8BDC5" } } };
    });
  }
  for (const rowNumber of sectionRows) {
    const row = worksheet.getRow(rowNumber);
    row.height = 26;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF0A5CC0" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF3FF" } };
    });
  }

  if (definition.name !== "汇总统计" && definition.headers.length) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: definition.headers.length },
    };
  }
  worksheet.columns.forEach((column, index) => {
    let width = visualLength(definition.headers[index] ?? "") + 3;
    definition.rows.forEach((row) => {
      width = Math.max(width, visualLength(row[index] ?? "") + 2);
    });
    column.width = Math.min(Math.max(width, 10), wrapColumns.has(index + 1) ? 48 : 36);
    if (currencyColumns.has(index + 1)) column.numFmt = MONEY_FORMAT;
    if (integerColumns.has(index + 1)) column.numFmt = INTEGER_FORMAT;
  });

  if (definition.name === "汇总统计") {
    worksheet.getColumn(1).width = 24;
    worksheet.getColumn(2).width = 22;
    worksheet.getColumn(3).width = 46;
    worksheet.getColumn(4).width = 20;
    worksheet.getColumn(5).width = 18;
    worksheet.getColumn(6).width = 18;
    [2, 3, 4, 5, 8, 9, 10, 11, 13].forEach((rowNumber) => {
      worksheet.getCell(rowNumber, 2).numFmt = MONEY_FORMAT;
    });
    for (let rowNumber = 19; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      worksheet.getCell(rowNumber, 3).numFmt = INTEGER_FORMAT;
      worksheet.getCell(rowNumber, 4).numFmt = MONEY_FORMAT;
      worksheet.getCell(rowNumber, 5).numFmt = MONEY_FORMAT;
      worksheet.getCell(rowNumber, 6).numFmt = MONEY_FORMAT;
    }
  }
}

export async function createClubExportBuffer(data: ClubData, now = Date.now()) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Delta Force Club Hub";
  workbook.company = "Delta Force Club";
  workbook.created = new Date(now);
  workbook.modified = new Date(now);
  workbook.calcProperties.fullCalcOnLoad = true;

  const exportData = buildClubExportWorkbookData(data, now);
  for (const definition of exportData.sheets) {
    const worksheet = workbook.addWorksheet(definition.name, {
      properties: { defaultColWidth: 14, defaultRowHeight: 20 },
      views: [{ state: "frozen", ySplit: 1 }],
    });
    worksheet.addRow(definition.headers);
    worksheet.addRows(definition.rows);
    styleWorksheet(worksheet, definition);
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Uint8Array.from(rawBuffer as unknown as ArrayLike<number>),
    fileName: buildExportFileName(now),
    workbookData: exportData,
  };
}

export async function exportDataToExcel(data: ClubData): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("Excel 导出只能在浏览器中执行");
  }
  const { buffer, fileName } = await createClubExportBuffer(data);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return fileName;
}
