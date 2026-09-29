import { getD1 } from "@/db";
import type {
  ClubData,
  CommissionMode,
  Folder,
  Order,
  OrderPricingSnapshot,
  OrderType,
  PriceMenuItem,
  ReassignmentLog,
  SettlementPeriod,
  SettlementPeriodStatus,
  SettlementOrderSnapshot,
  SettlementRecord,
  SettlementStatus,
  SpecialRequirement,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  TipsByWorker,
  Worker,
  WorkerEarningsByWorker,
  WorkerIncome,
  WorkerTier,
  WorkerType,
} from "@/lib/club-types";
import {
  calculateWorkerEarningForOrder,
  defaultSettlementConfig,
  getOrdersForSettlementPeriod,
  normalizeSettlementIntervalDays,
  normalizeSettlementReminderHours,
} from "@/lib/payroll-settlement";
import {
  deriveWorkerOrderEarnings,
  resolveWorkerTipEarnings,
  workerTipEarningForOrder,
} from "@/lib/order-earnings";
import {
  buildPayoutWeights,
  calculateOrderBasePrice,
  calculateSettlement,
  calculateSettlementWithTransferFees,
  defaultTierCommissionRates,
  fromCents,
  legacyTipsByWorker,
  normalizeSpecialRequirements,
  normalizeCompanionHours,
  normalizeOrderType,
  normalizeTipsByWorker,
  specialRequirementsTotal,
  tipsByWorkerTotal,
  toCents,
  toSignedCents,
  validateMenuRule,
} from "@/lib/settlement";
import { getDescendantFolderIds, isDescendant } from "@/lib/folder-tree";
import { normalizeWorkerGender } from "@/lib/worker-profile";
import {
  isWorkerEligibleForMenuItem,
  isWorkerEligibleForRule,
} from "@/lib/worker-eligibility";

export const runtime = "edge";

interface WorkerRow {
  id: string;
  name: string;
  gender: string;
  tier: string;
  worker_type: string;
  sort_order: number;
  status: "idle" | "busy";
  total_completed_orders: number;
  total_tip_earnings_cents: number;
  joined_at: number;
  settlement_interval_days: number;
  settlement_reminder_hours: number;
  active_period_id: string | null;
}

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface MenuRow {
  id: string;
  service_name: string;
  folder_id: string | null;
  sort_order: number;
  order_type: string;
  base_price_cents: number;
  hourly_rate_cents: number;
  commission_mode: string;
  club_commission_bps: number;
  tier_commission_rates_json: string;
  split_type: SplitType;
  tiered_ratios_json: string | null;
  eligible_tiers_json: string;
}

interface OrderRow {
  id: string;
  menu_item_id: string;
  assigned_worker_ids_json: string;
  order_type: string;
  hours_half_units: number;
  hourly_rate_snapshot_cents: number;
  split_type: SplitType;
  status: "active" | "completed";
  tip_cents: number;
  tips_by_worker_json: string;
  worker_order_earnings_json: string;
  worker_tip_earnings_json: string;
  transfer_fees_by_worker_json: string;
  reassignment_history_json: string;
  final_club_income_cents: number | null;
  final_worker_incomes_json: string;
  special_requirements_json: string;
  base_price_snapshot_cents: number;
  special_total_cents: number;
  total_price_cents: number;
  order_original_total_cents: number;
  pricing_snapshot_json: string;
  created_at: string;
  completed_at: string | null;
  settled: number;
  settlement_id: string | null;
  settlement_ids_by_worker_json: string;
  settlement_period_id: string | null;
  settlement_period_ids_by_worker_json: string;
}

interface SettlementPeriodRow {
  id: string;
  worker_id: string;
  started_at: number;
  ended_at: number | null;
  status: SettlementPeriodStatus;
  settlement_record_id: string | null;
}

interface SettlementRecordRow {
  id: string;
  period_id: string;
  worker_id: string;
  worker_name_snapshot: string;
  worker_type_snapshot: string;
  period_start: number;
  period_end: number;
  order_ids_json: string;
  order_details_json: string;
  total_orders: number;
  total_amount_cents: number;
  status: SettlementStatus;
  paid_at: number | null;
  note: string;
  created_at: number;
}

const WORKER_SELECT =
  "SELECT id, name, gender, tier, worker_type, sort_order, status, total_completed_orders, total_tip_earnings_cents, joined_at, settlement_interval_days, settlement_reminder_hours, active_period_id FROM workers";
const ORDER_SELECT =
  "SELECT id, menu_item_id, assigned_worker_ids_json, order_type, hours_half_units, hourly_rate_snapshot_cents, split_type, status, tip_cents, tips_by_worker_json, worker_order_earnings_json, worker_tip_earnings_json, transfer_fees_by_worker_json, reassignment_history_json, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at, settled, settlement_id, settlement_ids_by_worker_json, settlement_period_id, settlement_period_ids_by_worker_json FROM orders";
const SETTLEMENT_PERIOD_SELECT =
  "SELECT id, worker_id, started_at, ended_at, status, settlement_record_id FROM settlement_periods";
const SETTLEMENT_RECORD_SELECT =
  "SELECT id, period_id, worker_id, worker_name_snapshot, worker_type_snapshot, period_start, period_end, order_ids_json, order_details_json, total_orders, total_amount_cents, status, paid_at, note, created_at FROM settlement_records";

function normalizeCommissionMode(value: unknown): CommissionMode {
  return value === "by_tier" ? "by_tier" : "uniform";
}

function normalizeWorkerType(value: unknown): WorkerType {
  if (value === undefined || value === null || value === "standard") return "standard";
  if (value === "entertainment") return "entertainment";
  throw new Error("请选择有效打手类型");
}

function normalizeWorkerTier(value: unknown, workerType: WorkerType): WorkerTier | null {
  if (workerType === "entertainment") return null;
  if (value === "1档" || value === "2档" || value === "3档") return value;
  throw new Error("普通打手必须选择档位");
}

function normalizeSnapshotTier(value: unknown): WorkerTier | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "1档" || value === "2档" || value === "3档") return value;
  throw new Error("订单打手档位快照无效");
}

function workerFromRow(row: WorkerRow): Worker {
  const workerType = normalizeWorkerType(row.worker_type);
  const defaults = defaultSettlementConfig();
  return {
    id: row.id,
    name: row.name,
    gender: normalizeWorkerGender(row.gender),
    tier: normalizeWorkerTier(row.tier, workerType),
    workerType,
    order: row.sort_order,
    status: row.status,
    total_completed_orders: row.total_completed_orders,
    total_tip_earnings: fromCents(row.total_tip_earnings_cents ?? 0),
    joined_at: row.joined_at,
    settlement_config: {
      interval_days: normalizeSettlementIntervalDays(
        row.settlement_interval_days ?? defaults.interval_days,
      ),
      reminder_hours: normalizeSettlementReminderHours(
        row.settlement_reminder_hours ?? defaults.reminder_hours,
      ),
    },
    active_period_id: row.active_period_id ?? null,
  };
}

function parseSettlementIdsByWorker(value: string | null | undefined) {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function settlementRecordFromRow(row: SettlementRecordRow): SettlementRecord {
  const status: SettlementStatus = row.status === "paid" ? "paid" : "pending";
  return {
    id: row.id,
    period_id: row.period_id || `legacy:${row.id}`,
    worker_id: row.worker_id,
    worker_name_snapshot: row.worker_name_snapshot,
    worker_type_snapshot: normalizeWorkerType(row.worker_type_snapshot),
    period_start: row.period_start,
    period_end: row.period_end,
    order_ids: JSON.parse(row.order_ids_json || "[]") as string[],
    order_details: JSON.parse(row.order_details_json || "[]") as SettlementOrderSnapshot[],
    total_orders: row.total_orders,
    total_amount: fromCents(row.total_amount_cents),
    status,
    paid_at: row.paid_at ?? null,
    note: row.note ?? "",
    created_at: row.created_at,
  };
}

function hydrateSettlementRecord(
  record: SettlementRecord,
  orders: Order[],
): SettlementRecord {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const snapshotById = new Map(
    record.order_details.map((detail) => [detail.order_id, detail]),
  );
  const orderDetails = record.order_ids.flatMap((orderId) => {
    const order = ordersById.get(orderId);
    if (order?.completed_at) {
      return [{
        order_id: order.id,
        service_name: order.pricing_snapshot.service_name,
        completed_at: order.completed_at,
        worker_amount: calculateWorkerEarningForOrder(order, record.worker_id),
        tip_amount: workerTipEarningForOrder(order, record.worker_id),
      } satisfies SettlementOrderSnapshot];
    }
    const frozen = snapshotById.get(orderId);
    return frozen ? [frozen] : [];
  });
  return {
    ...record,
    order_details: orderDetails,
    total_orders: record.order_ids.length,
    total_amount: fromCents(
      orderDetails.reduce((sum, detail) => sum + toCents(detail.worker_amount), 0),
    ),
  };
}

function settlementPeriodFromRow(row: SettlementPeriodRow): SettlementPeriod {
  return {
    id: row.id,
    worker_id: row.worker_id,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    status: row.status === "settled" ? "settled" : "active",
    settlement_record_id: row.settlement_record_id ?? null,
  };
}

function normalizeFolderName(value: unknown) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("请输入文件夹名称");
  if (Array.from(name).length > 20) throw new Error("文件夹名称最多 20 个字符");
  return name;
}

function parseOrderedIds(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error(`${label}排序数据无效`);
  }
  const ids = value.map((id) => String(id));
  if (new Set(ids).size !== ids.length) throw new Error(`${label}排序数据不能重复`);
  return ids;
}

function normalizeCommissionRate(value: unknown, label: string) {
  const rate = Number(value ?? 0);
  const basisPoints = Math.round(rate * 100);
  if (!Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(basisPoints)) {
    throw new Error(`${label}必须是非负数字`);
  }
  return basisPoints / 100;
}

function normalizeTierCommissionRates(value: unknown): TierCommissionRates {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === undefined || parsed === null) return defaultTierCommissionRates();
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("按档位抽成配置无效");
  }
  const rates = parsed as Partial<Record<WorkerTier | "娱乐陪玩", unknown>>;
  return {
    "1档": normalizeCommissionRate(rates["1档"], "1档抽成"),
    "2档": normalizeCommissionRate(rates["2档"], "2档抽成"),
    "3档": normalizeCommissionRate(rates["3档"], "3档抽成"),
    "娱乐陪玩": normalizeCommissionRate(rates["娱乐陪玩"], "娱乐陪玩抽成"),
  };
}

function normalizePricingSnapshot(value: unknown): OrderPricingSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("订单价格快照无效");
  }
  const snapshot = value as Partial<OrderPricingSnapshot>;
  const orderType = normalizeOrderType(snapshot.order_type);
  if (!Array.isArray(snapshot.payout_weights)) throw new Error("订单打手快照无效");
  return {
    ...(snapshot as OrderPricingSnapshot),
    order_type: orderType,
    hourly_rate: orderType === "companion"
      ? fromCents(toCents(Number(snapshot.hourly_rate ?? 0)))
      : 0,
    base_price: fromCents(toCents(Number(snapshot.base_price ?? 0))),
    commission_mode: normalizeCommissionMode(snapshot.commission_mode),
    club_commission_rate: normalizeCommissionRate(
      snapshot.club_commission_rate,
      "统一抽成",
    ),
    tier_commission_rates: normalizeTierCommissionRates(
      snapshot.tier_commission_rates,
    ),
    payout_weights: snapshot.payout_weights.map((entry) => ({
      ...entry,
      tier: normalizeSnapshotTier(entry.tier),
      workerType:
        entry.workerType === "entertainment" || entry.tier === null
          ? "entertainment"
          : "standard",
    })),
  };
}

function parsePricingSnapshot(json: string) {
  return normalizePricingSnapshot(JSON.parse(json) as unknown);
}

function parseSpecialRequirements(value: unknown) {
  return normalizeSpecialRequirements(
    (value ?? []) as SpecialRequirement[],
  );
}

function parseStoredSpecialRequirements(json: string) {
  return parseSpecialRequirements(JSON.parse(json) as unknown);
}

function parseStoredTipsByWorker(
  json: string,
  snapshot: OrderPricingSnapshot,
): TipsByWorker {
  const parsed = JSON.parse(json || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("订单按打手打赏数据无效");
  }
  return Object.keys(parsed).length
    ? normalizeTipsByWorker(snapshot, parsed)
    : {};
}

function parseStoredWorkerEarnings(json: string | null | undefined): WorkerEarningsByWorker {
  const parsed = JSON.parse(json || "{}") as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("订单收入拆分数据无效");
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([workerId, amount]) => [
      workerId,
      fromCents(Math.max(0, toCents(Number(amount ?? 0)))),
    ]),
  );
}

function parseReassignmentHistory(json: string | null | undefined): ReassignmentLog[] {
  const parsed = JSON.parse(json || "[]") as unknown;
  if (!Array.isArray(parsed)) throw new Error("订单换人记录无效");
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Partial<ReassignmentLog>;
    const transferFee = fromCents(toCents(Number(value.transfer_fee ?? 0)));
    if (
      !value.changed_at ||
      !value.old_worker_id ||
      !value.new_worker_id
    ) return [];
    return [{
      changed_at: String(value.changed_at),
      old_worker_id: String(value.old_worker_id),
      old_worker_name: String(value.old_worker_name ?? value.old_worker_id),
      new_worker_id: String(value.new_worker_id),
      new_worker_name: String(value.new_worker_name ?? value.new_worker_id),
      transfer_fee: transferFee,
    }];
  });
}

function orderAmountsFromRow(row: OrderRow, snapshot: OrderPricingSnapshot) {
  const basePriceSnapshotCents = row.base_price_snapshot_cents > 0
    ? row.base_price_snapshot_cents
    : toCents(snapshot.base_price);
  const specialTotalCents = row.special_total_cents;
  const totalPriceCents = row.total_price_cents > 0
    ? row.total_price_cents
    : basePriceSnapshotCents + specialTotalCents;
  const orderOriginalTotalCents = row.order_original_total_cents > 0
    ? row.order_original_total_cents
    : totalPriceCents;

  return {
    basePriceSnapshotCents,
    specialTotalCents,
    totalPriceCents,
    orderOriginalTotalCents,
  };
}

function orderFromRow(row: OrderRow): Order {
  const pricingSnapshot = parsePricingSnapshot(row.pricing_snapshot_json);
  const amounts = orderAmountsFromRow(row, pricingSnapshot);
  const assignedWorkerIds = JSON.parse(row.assigned_worker_ids_json) as string[];
  const orderType = normalizeOrderType(row.order_type ?? pricingSnapshot.order_type);
  const settlementIdsByWorker = parseSettlementIdsByWorker(
    row.settlement_ids_by_worker_json,
  );
  const tipsByWorker = parseStoredTipsByWorker(
    row.tips_by_worker_json,
    pricingSnapshot,
  );
  const finalWorkerIncomes = JSON.parse(row.final_worker_incomes_json) as WorkerIncome[];
  const storedTipEarnings = parseStoredWorkerEarnings(row.worker_tip_earnings_json);
  const workerTipEarnings = Object.keys(storedTipEarnings).length
    ? storedTipEarnings
    : resolveWorkerTipEarnings({
        pricing_snapshot: pricingSnapshot,
        tip: fromCents(row.tip_cents),
        tips_by_worker: tipsByWorker,
        worker_tip_earnings: {},
      });
  const storedOrderEarnings = parseStoredWorkerEarnings(row.worker_order_earnings_json);
  const workerOrderEarnings = Object.keys(storedOrderEarnings).length
    ? storedOrderEarnings
    : deriveWorkerOrderEarnings(finalWorkerIncomes, workerTipEarnings);
  return {
    id: row.id,
    menu_item_id: row.menu_item_id,
    assigned_worker_ids: assignedWorkerIds,
    order_type: orderType,
    hours:
      orderType === "companion"
        ? normalizeCompanionHours(row.hours_half_units / 2)
        : null,
    hourly_rate_snapshot:
      orderType === "companion"
        ? fromCents(row.hourly_rate_snapshot_cents)
        : null,
    split_type: row.split_type ?? pricingSnapshot.split_type,
    status: row.status,
    tip: fromCents(row.tip_cents),
    tips_by_worker: tipsByWorker,
    worker_order_earnings: workerOrderEarnings,
    worker_tip_earnings: workerTipEarnings,
    transfer_fees_by_worker: parseStoredWorkerEarnings(
      row.transfer_fees_by_worker_json,
    ),
    reassignment_history: parseReassignmentHistory(row.reassignment_history_json),
    final_club_income:
      row.final_club_income_cents === null
        ? null
        : fromCents(row.final_club_income_cents),
    final_worker_incomes: finalWorkerIncomes,
    special_requirements: parseStoredSpecialRequirements(row.special_requirements_json),
    base_price_snapshot: fromCents(amounts.basePriceSnapshotCents),
    special_total: fromCents(amounts.specialTotalCents),
    total_price: fromCents(amounts.totalPriceCents),
    order_original_total: fromCents(amounts.orderOriginalTotalCents),
    pricing_snapshot: pricingSnapshot,
    created_at: row.created_at,
    completed_at: row.completed_at,
    settled: Boolean(row.settled),
    settlement_id: row.settlement_id ?? null,
    settlement_ids_by_worker: settlementIdsByWorker,
    settlement_period_id: row.settlement_period_id ?? null,
    settlement_period_ids_by_worker: parseSettlementIdsByWorker(
      row.settlement_period_ids_by_worker_json,
    ),
  };
}

function chinaMonthDate(day: number, hour = 12) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, day, hour - 8)).toISOString();
}

function seedSnapshot(
  serviceName: string,
  basePrice: number,
  commission: number,
  splitType: SplitType,
  workers: Array<{ id: string; name: string; tier: WorkerTier; weight: number }>,
  ratios: TieredRatios | null = null,
): OrderPricingSnapshot {
  return {
    service_name: serviceName,
    order_type: "escort",
    hourly_rate: 0,
    base_price: basePrice,
    commission_mode: "uniform",
    club_commission_rate: commission,
    tier_commission_rates: defaultTierCommissionRates(),
    split_type: splitType,
    tiered_ratios: ratios,
    payout_weights: workers.map((worker) => ({
      workerId: worker.id,
      workerName: worker.name,
      workerType: "standard",
      tier: worker.tier,
      weight: worker.weight,
    })),
  };
}

async function ensureSeeded() {
  const db = getD1();
  const existingMenu = await db
    .prepare("SELECT COUNT(*) AS count FROM price_menu")
    .first<{ count: number }>();
  if ((existingMenu?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  const allTiers = JSON.stringify(["1档", "2档", "3档"]);
  const tieredTiers = JSON.stringify(["1档", "2档"]);
  const emptyTierCommissions = JSON.stringify(defaultTierCommissionRates());
  const noSpecialRequirements = JSON.stringify([]);

  const snapshots = {
    single: seedSnapshot("排位代练 · 单排", 200, 30, "single", [
      { id: "worker-hanxing", name: "寒星", tier: "1档", weight: 100 },
    ]),
    equal: seedSnapshot("护航双排", 360, 10, "equal", [
      { id: "worker-muye", name: "牧野", tier: "2档", weight: 50 },
      { id: "worker-beichen", name: "北辰", tier: "2档", weight: 50 },
    ]),
    tiered: seedSnapshot(
      "巅峰冲刺 · 档位协作",
      500,
      20,
      "tiered",
      [
        { id: "worker-hanxing", name: "寒星", tier: "1档", weight: 60 },
        { id: "worker-muye", name: "牧野", tier: "2档", weight: 40 },
      ],
      { "1档": 60, "2档": 40 },
    ),
  };

  await db.batch([
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-hanxing", "寒星", "1档", 0, 2),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-muye", "牧野", "2档", 1, 2),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-lingfeng", "凌风", "1档", 2, 0),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-beichen", "北辰", "2档", 3, 1),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-shangui", "山鬼", "3档", 4, 0),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders) VALUES (?, ?, ?, 'standard', ?, 'idle', ?)").bind("worker-luoshen", "洛神", "3档", 5, 0),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, folder_id, sort_order, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-single", "排位代练 · 单排", 0, 20_000, "uniform", 3_000, emptyTierCommissions, "single", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, folder_id, sort_order, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-equal", "护航双排", 1, 36_000, "uniform", 1_000, emptyTierCommissions, "equal", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, folder_id, sort_order, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-tiered", "巅峰冲刺 · 档位协作", 2, 50_000, "uniform", 2_000, emptyTierCommissions, "tiered", JSON.stringify({ "1档": 60, "2档": 40 }), tieredTiers, now),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-single", "menu-single", JSON.stringify(["worker-hanxing"]), "single", 0, 6_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 140 }]), noSpecialRequirements, 20_000, 0, 20_000, 20_000, JSON.stringify(snapshots.single), chinaMonthDate(2, 20), chinaMonthDate(2, 21)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-equal", "menu-equal", JSON.stringify(["worker-muye", "worker-beichen"]), "equal", 4_000, 3_600, JSON.stringify([{ workerId: "worker-muye", amount: 182 }, { workerId: "worker-beichen", amount: 182 }]), noSpecialRequirements, 36_000, 0, 36_000, 36_000, JSON.stringify(snapshots.equal), chinaMonthDate(4, 19), chinaMonthDate(4, 22)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-tiered", "menu-tiered", JSON.stringify(["worker-hanxing", "worker-muye"]), "tiered", 5_000, 10_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 270 }, { workerId: "worker-muye", amount: 180 }]), noSpecialRequirements, 50_000, 0, 50_000, 50_000, JSON.stringify(snapshots.tiered), chinaMonthDate(7, 20), chinaMonthDate(7, 23)),
  ]);
}

async function readClubData(): Promise<ClubData> {
  const db = getD1();
  const [workerResult, menuResult, folderResult, orderResult, periodResult, settlementResult] = await Promise.all([
    db.prepare(`${WORKER_SELECT} ORDER BY sort_order, id`).all<WorkerRow>(),
    db.prepare("SELECT id, service_name, folder_id, sort_order, order_type, base_price_cents, hourly_rate_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu ORDER BY sort_order, id").all<MenuRow>(),
    db.prepare("SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY parent_id, sort_order, created_at, id").all<FolderRow>(),
    db.prepare(`${ORDER_SELECT} ORDER BY created_at DESC`).all<OrderRow>(),
    db.prepare(`${SETTLEMENT_PERIOD_SELECT} ORDER BY started_at DESC, id`).all<SettlementPeriodRow>(),
    db.prepare(`${SETTLEMENT_RECORD_SELECT} ORDER BY period_end DESC, created_at DESC`).all<SettlementRecordRow>(),
  ]);

  const orders = orderResult.results.map(orderFromRow);
  const tipTotalsByWorker = new Map<string, number>();
  orders
    .filter((order) => order.status === "completed")
    .forEach((order) => {
      Object.entries(resolveWorkerTipEarnings(order)).forEach(([workerId, amount]) => {
        tipTotalsByWorker.set(
          workerId,
          fromCents(toCents(tipTotalsByWorker.get(workerId) ?? 0) + toCents(amount)),
        );
      });
    });
  // 历史数据可能还没有累计字段，读取时始终以订单快照重建，避免重复或漏算。
  const workers: Worker[] = workerResult.results.map((row) => ({
    ...workerFromRow(row),
    total_tip_earnings: tipTotalsByWorker.get(row.id) ?? 0,
  }));
  const menu: PriceMenuItem[] = menuResult.results.map((row) => ({
    id: row.id,
    service_name: row.service_name,
    folderId: row.folder_id,
    order: row.sort_order,
    order_type: normalizeOrderType(row.order_type),
    base_price: fromCents(row.base_price_cents),
    hourly_rate: fromCents(row.hourly_rate_cents),
    commission_mode: normalizeCommissionMode(row.commission_mode),
    club_commission_rate: row.club_commission_bps / 100,
    tier_commission_rates: normalizeTierCommissionRates(row.tier_commission_rates_json),
    split_type: row.split_type,
    tiered_ratios: row.tiered_ratios_json ? JSON.parse(row.tiered_ratios_json) : null,
    eligible_tiers: JSON.parse(row.eligible_tiers_json),
  }));
  const folders: Folder[] = folderResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? null,
    order: row.sort_order,
    createdAt: row.created_at,
  }));
  const settlementPeriods = periodResult.results.map(settlementPeriodFromRow);
  const settlementRecords = settlementResult.results.map((row) =>
    hydrateSettlementRecord(settlementRecordFromRow(row), orders),
  );

  return { workers, menu, folders, orders, settlementPeriods, settlementRecords };
}

function normalizeSettlementNote(value: unknown) {
  const note = String(value ?? "").trim();
  if (Array.from(note).length > 500) throw new Error("结算备注最多 500 个字符");
  return note;
}

function workerSettlementConfigFromInput(
  value: unknown,
  fallback: Worker["settlement_config"],
) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    interval_days: normalizeSettlementIntervalDays(
      input.interval_days ?? fallback.interval_days,
    ),
    reminder_hours: normalizeSettlementReminderHours(
      input.reminder_hours ?? fallback.reminder_hours,
    ),
  };
}

function settlementJsonPath(workerId: string) {
  return `$."${workerId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function attachUnassignedOrdersToPeriod(
  workerId: string,
  periodId: string,
) {
  const db = getD1();
  const path = settlementJsonPath(workerId);
  await db
    .prepare(
      "UPDATE orders SET settlement_period_ids_by_worker_json = json_set(COALESCE(NULLIF(settlement_period_ids_by_worker_json, ''), '{}'), ?, ?), settlement_period_id = COALESCE(settlement_period_id, ?) WHERE EXISTS (SELECT 1 FROM json_each(assigned_worker_ids_json) AS assigned WHERE assigned.value = ?) AND json_extract(COALESCE(NULLIF(settlement_period_ids_by_worker_json, ''), '{}'), ?) IS NULL AND json_extract(COALESCE(NULLIF(settlement_ids_by_worker_json, ''), '{}'), ?) IS NULL",
    )
    .bind(path, periodId, periodId, workerId, path, path)
    .run();
}

async function ensureActivePeriodForWorkerOnServer(
  workerId: string,
  startedAt = Date.now(),
): Promise<{ period: SettlementPeriod; created: boolean }> {
  const db = getD1();
  const worker = await db
    .prepare("SELECT id, active_period_id FROM workers WHERE id = ?")
    .bind(workerId)
    .first<{ id: string; active_period_id: string | null }>();
  if (!worker) throw new Error("未找到该打手");

  if (worker.active_period_id) {
    const active = await db
      .prepare(`${SETTLEMENT_PERIOD_SELECT} WHERE id = ? AND worker_id = ? AND status = 'active'`)
      .bind(worker.active_period_id, workerId)
      .first<SettlementPeriodRow>();
    if (active) {
      await attachUnassignedOrdersToPeriod(workerId, active.id);
      return { period: settlementPeriodFromRow(active), created: false };
    }
  }

  const existing = await db
    .prepare(`${SETTLEMENT_PERIOD_SELECT} WHERE worker_id = ? AND status = 'active' ORDER BY started_at DESC, id LIMIT 1`)
    .bind(workerId)
    .first<SettlementPeriodRow>();
  if (existing) {
    await db
      .prepare("UPDATE workers SET active_period_id = ? WHERE id = ?")
      .bind(existing.id, workerId)
      .run();
    await attachUnassignedOrdersToPeriod(workerId, existing.id);
    return { period: settlementPeriodFromRow(existing), created: false };
  }

  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new Error("结算周期开始时间无效");
  }
  const periodId = crypto.randomUUID();
  const normalizedStartedAt = Math.trunc(startedAt);
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO settlement_periods (id, worker_id, started_at, ended_at, status, settlement_record_id) SELECT ?, ?, ?, NULL, 'active', NULL WHERE EXISTS (SELECT 1 FROM workers WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM settlement_periods WHERE worker_id = ? AND status = 'active')",
      )
      .bind(periodId, workerId, normalizedStartedAt, workerId, workerId),
    db
      .prepare(
        "UPDATE workers SET active_period_id = (SELECT id FROM settlement_periods WHERE worker_id = ? AND status = 'active' ORDER BY started_at DESC, id LIMIT 1) WHERE id = ?",
      )
      .bind(workerId, workerId),
  ]);
  const active = await db
    .prepare(`${SETTLEMENT_PERIOD_SELECT} WHERE worker_id = ? AND status = 'active' ORDER BY started_at DESC, id LIMIT 1`)
    .bind(workerId)
    .first<SettlementPeriodRow>();
  if (!active) throw new Error("结算周期创建失败，请重试");
  await attachUnassignedOrdersToPeriod(workerId, active.id);
  return { period: settlementPeriodFromRow(active), created: active.id === periodId };
}

/**
 * 管理员手动关闭当前周期。订单原始金额、即时打赏、俱乐部收入和经营报表均不改动；
 * 此处只冻结该打手在 [started_at, ended_at] 内已经完成的订单工资。
 */
async function settleWorkerPeriodOnServer(
  workerId: string,
  endedAtValue: unknown,
  now = Date.now(),
): Promise<SettlementRecord> {
  const db = getD1();
  const workerRow = await db
    .prepare(`${WORKER_SELECT} WHERE id = ?`)
    .bind(workerId)
    .first<WorkerRow>();
  if (!workerRow) throw new Error("未找到该打手");
  const worker = workerFromRow(workerRow);
  if (!worker.active_period_id) throw new Error("该打手暂无进行中的结算周期");
  const periodRow = await db
    .prepare(`${SETTLEMENT_PERIOD_SELECT} WHERE id = ? AND worker_id = ? AND status = 'active'`)
    .bind(worker.active_period_id, worker.id)
    .first<SettlementPeriodRow>();
  if (!periodRow) throw new Error("该打手暂无进行中的结算周期");
  const period = settlementPeriodFromRow(periodRow);
  const endedAt = Math.trunc(Number(endedAtValue));
  if (!Number.isFinite(endedAt) || endedAt < period.started_at) {
    throw new Error("结算结束时间不能早于周期开始时间");
  }
  if (endedAt > now) {
    throw new Error("结算结束时间不能晚于当前时间");
  }

  const orderResult = await db.prepare(ORDER_SELECT).all<OrderRow>();
  const allOrders = orderResult.results.map(orderFromRow);
  const periodOrders = getOrdersForSettlementPeriod(
    allOrders,
    worker.id,
    period,
    endedAt,
  );
  const orderDetails: SettlementOrderSnapshot[] = periodOrders.map((order) => ({
    order_id: order.id,
    service_name: order.pricing_snapshot.service_name,
    completed_at: order.completed_at!,
    worker_amount: calculateWorkerEarningForOrder(order, workerId),
    tip_amount: workerTipEarningForOrder(order, workerId),
  }));
  const totalAmountCents = orderDetails.reduce(
    (sum, detail) => sum + toCents(detail.worker_amount),
    0,
  );
  if (!Number.isSafeInteger(totalAmountCents)) throw new Error("工资结算金额超出安全范围");

  const recordId = crypto.randomUUID();
  const nextPeriodId = crypto.randomUUID();
  const createdAt = now;
  const orderIds = orderDetails.map((detail) => detail.order_id);
  const path = settlementJsonPath(workerId);
  const statements = [
    db
      .prepare(
        "INSERT INTO settlement_records (id, period_id, worker_id, worker_name_snapshot, worker_type_snapshot, period_start, period_end, order_ids_json, order_details_json, total_orders, total_amount_cents, status, paid_at, note, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ? WHERE EXISTS (SELECT 1 FROM settlement_periods WHERE id = ? AND worker_id = ? AND status = 'active') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND active_period_id = ?)",
      )
      .bind(
        recordId,
        period.id,
        worker.id,
        worker.name,
        worker.workerType,
        period.started_at,
        endedAt,
        JSON.stringify(orderIds),
        JSON.stringify(orderDetails),
        orderIds.length,
        totalAmountCents,
        createdAt,
        period.id,
        worker.id,
        worker.id,
        period.id,
      ),
    db
      .prepare(
        "UPDATE settlement_periods SET status = 'settled', ended_at = ?, settlement_record_id = ? WHERE id = ? AND worker_id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM settlement_records WHERE id = ?)",
      )
      .bind(endedAt, recordId, period.id, worker.id, recordId),
    db
      .prepare(
        "INSERT INTO settlement_periods (id, worker_id, started_at, ended_at, status, settlement_record_id) SELECT ?, ?, ?, NULL, 'active', NULL WHERE EXISTS (SELECT 1 FROM settlement_periods WHERE id = ? AND status = 'settled' AND settlement_record_id = ?)",
      )
      .bind(nextPeriodId, worker.id, endedAt, period.id, recordId),
    db
      .prepare(
        "UPDATE workers SET active_period_id = ? WHERE id = ? AND active_period_id = ? AND EXISTS (SELECT 1 FROM settlement_periods WHERE id = ? AND status = 'active')",
      )
      .bind(nextPeriodId, worker.id, period.id, nextPeriodId),
  ];

  for (const order of periodOrders) {
    statements.push(
      db
        .prepare(
          "UPDATE orders SET settlement_ids_by_worker_json = json_set(COALESCE(NULLIF(settlement_ids_by_worker_json, ''), '{}'), ?, ?), settlement_id = ?, settled = CASE WHEN json_array_length(assigned_worker_ids_json) <= (SELECT COUNT(*) FROM json_each(json_set(COALESCE(NULLIF(settlement_ids_by_worker_json, ''), '{}'), ?, ?))) THEN 1 ELSE 0 END WHERE id = ? AND status = 'completed' AND json_extract(COALESCE(NULLIF(settlement_ids_by_worker_json, ''), '{}'), ?) IS NULL AND EXISTS (SELECT 1 FROM settlement_records WHERE id = ?)",
      )
      .bind(path, recordId, recordId, path, recordId, order.id, path, recordId),
    );
  }

  // 在同一事务末尾把旧周期中尚未被本次结算锁定的订单统一移入新周期。
  // 该集合同时覆盖 ended_at 之后完成的订单、仍在执行的订单，以及读取预览后
  // 才并发创建的订单，避免它们遗留在已经关闭的周期中。
  statements.push(
    db
      .prepare(
        "UPDATE orders SET settlement_period_ids_by_worker_json = json_set(COALESCE(NULLIF(settlement_period_ids_by_worker_json, ''), '{}'), ?, ?), settlement_period_id = CASE WHEN settlement_period_id = ? THEN ? ELSE settlement_period_id END WHERE json_extract(COALESCE(NULLIF(settlement_period_ids_by_worker_json, ''), '{}'), ?) = ? AND json_extract(COALESCE(NULLIF(settlement_ids_by_worker_json, ''), '{}'), ?) IS NULL AND EXISTS (SELECT 1 FROM settlement_periods WHERE id = ? AND status = 'active')",
      )
      .bind(
        path,
        nextPeriodId,
        period.id,
        nextPeriodId,
        path,
        period.id,
        path,
        nextPeriodId,
      ),
  );

  const results = await db.batch(statements);
  if (
    !results[0]?.meta.changes ||
    !results[1]?.meta.changes ||
    !results[2]?.meta.changes ||
    !results[3]?.meta.changes
  ) {
    throw new Error("结算周期状态刚刚发生变化，请刷新后重试");
  }

  return {
    id: recordId,
    period_id: period.id,
    worker_id: worker.id,
    worker_name_snapshot: worker.name,
    worker_type_snapshot: worker.workerType,
    period_start: period.started_at,
    period_end: endedAt,
    order_ids: orderIds,
    order_details: orderDetails,
    total_orders: orderIds.length,
    total_amount: fromCents(totalAmountCents),
    status: "pending",
    paid_at: null,
    note: "",
    created_at: createdAt,
  };
}

async function deleteSettlementRecordOnServer(settlementId: string) {
  const db = getD1();
  const recordRow = await db
    .prepare(`${SETTLEMENT_RECORD_SELECT} WHERE id = ?`)
    .bind(settlementId)
    .first<SettlementRecordRow>();
  if (!recordRow) throw new Error("未找到该结算记录");
  const record = settlementRecordFromRow(recordRow);

  const orderResult = record.order_ids.length
    ? await db
        .prepare(`${ORDER_SELECT} WHERE id IN (${record.order_ids.map(() => "?").join(", ")})`)
        .bind(...record.order_ids)
        .all<OrderRow>()
    : { results: [] as OrderRow[] };
  const affectedOrders = orderResult.results
    .map(orderFromRow)
    .filter(
      (order) =>
        order.settlement_ids_by_worker?.[record.worker_id] === record.id ||
        (order.settlement_id === record.id && order.assigned_worker_ids.includes(record.worker_id)),
    );

  const workerExists = await db
    .prepare("SELECT id FROM workers WHERE id = ?")
    .bind(record.worker_id)
    .first<{ id: string }>();
  let activePeriod: SettlementPeriod | null = null;
  let activePeriodStartChanged = false;
  if (workerExists && affectedOrders.length) {
    const earliestCompletedAt = affectedOrders.reduce((earliest, order) => {
      const completedAt = order.completed_at ? Date.parse(order.completed_at) : Number.NaN;
      return Number.isFinite(completedAt) ? Math.min(earliest, completedAt) : earliest;
    }, Number.POSITIVE_INFINITY);
    activePeriod = (
      await ensureActivePeriodForWorkerOnServer(
        record.worker_id,
        Number.isFinite(earliestCompletedAt) ? earliestCompletedAt : record.period_start,
      )
    ).period;
    // 删除旧结算后，历史订单必须重新进入现有活跃周期。若这些订单早于当前
    // 周期起点，则把起点安全地向前扩展，否则下一次按 [start, end] 筛选会漏单。
    if (
      Number.isFinite(earliestCompletedAt) &&
      earliestCompletedAt < activePeriod.started_at
    ) {
      activePeriod = { ...activePeriod, started_at: earliestCompletedAt };
      activePeriodStartChanged = true;
    }
  }

  const statements = [];
  if (activePeriod && activePeriodStartChanged) {
    statements.push(
      db
        .prepare(
          "UPDATE settlement_periods SET started_at = ? WHERE id = ? AND worker_id = ? AND status = 'active'",
        )
        .bind(activePeriod.started_at, activePeriod.id, record.worker_id),
    );
  }
  statements.push(...affectedOrders.map((order) => {
    const nextSettlementIds = { ...order.settlement_ids_by_worker };
    delete nextSettlementIds[record.worker_id];
    const nextPeriodIds = { ...order.settlement_period_ids_by_worker };
    if (activePeriod) nextPeriodIds[record.worker_id] = activePeriod.id;
    const fullySettled = order.assigned_worker_ids.every(
      (workerId) => Boolean(nextSettlementIds[workerId]),
    );
    const remainingSettlementId = Object.values(nextSettlementIds).at(-1) ?? null;
    return db
      .prepare(
        "UPDATE orders SET settled = ?, settlement_id = ?, settlement_ids_by_worker_json = ?, settlement_period_id = ?, settlement_period_ids_by_worker_json = ? WHERE id = ?",
      )
      .bind(
        fullySettled ? 1 : 0,
        remainingSettlementId,
        JSON.stringify(nextSettlementIds),
        activePeriod?.id ?? order.settlement_period_id,
        JSON.stringify(nextPeriodIds),
        order.id,
      );
  }));
  statements.push(
    db
      .prepare("DELETE FROM settlement_periods WHERE id = ? AND settlement_record_id = ? AND status = 'settled'")
      .bind(record.period_id, record.id),
    db.prepare("DELETE FROM settlement_records WHERE id = ?").bind(record.id),
  );
  const results = await db.batch(statements);
  if (!results.at(-1)?.meta.changes) {
    throw new Error("结算记录状态刚刚发生变化，请刷新后重试");
  }
  return affectedOrders.length;
}

async function deleteSettlementPeriodOnServer(periodId: string) {
  const db = getD1();
  const periodRow = await db
    .prepare(`${SETTLEMENT_PERIOD_SELECT} WHERE id = ?`)
    .bind(periodId)
    .first<SettlementPeriodRow>();
  if (!periodRow || periodRow.status !== "active" || periodRow.settlement_record_id) {
    throw new Error("只允许删除进行中的结算周期");
  }
  const worker = await db
    .prepare("SELECT id, active_period_id FROM workers WHERE id = ?")
    .bind(periodRow.worker_id)
    .first<{ id: string; active_period_id: string | null }>();
  if (!worker || worker.active_period_id !== periodId) {
    throw new Error("该周期已不是打手的当前活跃周期");
  }

  const orderResult = await db
    .prepare(`${ORDER_SELECT} WHERE settlement_period_id = ? OR EXISTS (SELECT 1 FROM json_each(settlement_period_ids_by_worker_json) AS period_map WHERE period_map.value = ?)`)
    .bind(periodId, periodId)
    .all<OrderRow>();
  const statements = orderResult.results.map((row) => {
    const periodIds = parseSettlementIdsByWorker(
      row.settlement_period_ids_by_worker_json,
    );
    delete periodIds[periodRow.worker_id];
    return db
      .prepare("UPDATE orders SET settled = 0, settlement_period_id = CASE WHEN settlement_period_id = ? THEN NULL ELSE settlement_period_id END, settlement_period_ids_by_worker_json = ? WHERE id = ?")
      .bind(periodId, JSON.stringify(periodIds), row.id);
  });
  statements.push(
    db
      .prepare("UPDATE workers SET active_period_id = NULL WHERE id = ? AND active_period_id = ?")
      .bind(periodRow.worker_id, periodId),
    db
      .prepare("DELETE FROM settlement_periods WHERE id = ? AND worker_id = ? AND status = 'active' AND settlement_record_id IS NULL")
      .bind(periodId, periodRow.worker_id),
  );
  const results = await db.batch(statements);
  if (!results.at(-1)?.meta.changes) {
    throw new Error("结算周期状态刚刚发生变化，请刷新后重试");
  }
}

async function cleanupUnusedPeriod(period: SettlementPeriod | null) {
  if (!period) return;
  const db = getD1();
  const usage = await db
    .prepare(
      "SELECT id FROM orders WHERE EXISTS (SELECT 1 FROM json_each(settlement_period_ids_by_worker_json) AS period_map WHERE period_map.value = ?) LIMIT 1",
    )
    .bind(period.id)
    .first<{ id: string }>();
  if (!usage) {
    await db.batch([
      db
        .prepare("UPDATE workers SET active_period_id = NULL WHERE id = ? AND active_period_id = ?")
        .bind(period.worker_id, period.id),
      db
        .prepare("DELETE FROM settlement_periods WHERE id = ? AND status = 'active' AND settlement_record_id IS NULL")
        .bind(period.id),
    ]);
  }
}

async function ensureOrderPeriodsForWorkers(
  workerIds: string[],
  startedAt: number,
) {
  const periods = new Map<string, SettlementPeriod>();
  const created: SettlementPeriod[] = [];
  for (const workerId of workerIds) {
    const result = await ensureActivePeriodForWorkerOnServer(workerId, startedAt);
    periods.set(workerId, result.period);
    if (result.created) created.push(result.period);
  }
  return { periods, created };
}

async function cleanupUnusedPeriods(periods: SettlementPeriod[]) {
  for (const period of periods) {
    await cleanupUnusedPeriod(period);
  }
}

function periodMapFrom(periods: Map<string, SettlementPeriod>) {
  return Object.fromEntries(
    [...periods.entries()].map(([workerId, period]) => [workerId, period.id]),
  );
}

function normalizeSettlementEndedAt(value: unknown) {
  const endedAt = Math.trunc(Number(value));
  if (!Number.isFinite(endedAt) || endedAt < 0) {
    throw new Error("结算结束时间无效");
  }
  return endedAt;
}

function jsonError(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "请求处理失败";
  const unavailable = message.includes("D1 binding") || message.includes("no such table");
  return Response.json(
    { error: unavailable ? "数据服务尚未就绪，请稍后刷新。" : message },
    { status: unavailable ? 503 : status },
  );
}

export async function GET() {
  try {
    await ensureSeeded();
    return Response.json(await readClubData());
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSeeded();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = payload.action;
    const db = getD1();

    if (action === "add_worker") {
      const rawWorker = (payload.worker ?? {}) as Record<string, unknown>;
      const workerId = String(rawWorker.id ?? "").trim();
      const name = String(rawWorker.name ?? "").trim();
      const gender = normalizeWorkerGender(rawWorker.gender);
      const workerType = normalizeWorkerType(rawWorker.workerType);
      const tier = normalizeWorkerTier(rawWorker.tier, workerType);
      if (!workerId || workerId.length > 128) throw new Error("打手 ID 无效");
      if (!name) throw new Error("请输入打手姓名");
      if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");

      const joinedAt = Date.now();
      const settlementConfig = defaultSettlementConfig();

      const result = await db
        .prepare("INSERT INTO workers (id, name, gender, tier, worker_type, sort_order, status, total_completed_orders, joined_at, settlement_interval_days, settlement_reminder_hours, active_period_id) SELECT ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM workers), 0), 'idle', 0, ?, ?, ?, NULL WHERE NOT EXISTS (SELECT 1 FROM workers WHERE name = ? COLLATE NOCASE)")
        .bind(
          workerId,
          name,
          gender,
          tier ?? "",
          workerType,
          joinedAt,
          settlementConfig.interval_days,
          settlementConfig.reminder_hours,
          name,
        )
        .run();
      if (!result.meta.changes) {
        return Response.json(
          { error: "已存在同名打手，请使用其他姓名" },
          { status: 409 },
        );
      }
      const data = await readClubData();
      const createdWorker = data.workers.find((worker) => worker.id === workerId);
      if (!createdWorker) throw new Error("打手创建后读取失败");
      return Response.json({
        ...data,
        created_worker: createdWorker,
      });
    }

    if (action === "ensure_active_period_for_worker") {
      const workerId = String(payload.worker_id ?? "").trim();
      const startedAt = payload.started_at === undefined
        ? Date.now()
        : normalizeSettlementEndedAt(payload.started_at);
      const result = await ensureActivePeriodForWorkerOnServer(workerId, startedAt);
      return Response.json({
        ...(await readClubData()),
        created_period_id: result.period.id,
      });
    }

    if (action === "settle_worker_period") {
      const workerId = String(payload.worker_id ?? "").trim();
      const record = await settleWorkerPeriodOnServer(
        workerId,
        normalizeSettlementEndedAt(payload.ended_at),
      );
      return Response.json({
        ...(await readClubData()),
        created_settlement_id: record?.id,
      });
    }

    if (action === "delete_settlement_record") {
      const settlementId = String(payload.settlement_id ?? "").trim();
      if (!settlementId) throw new Error("结算记录 ID 无效");
      await deleteSettlementRecordOnServer(settlementId);
      return Response.json(await readClubData());
    }

    if (action === "delete_settlement_period") {
      const periodId = String(payload.period_id ?? "").trim();
      if (!periodId) throw new Error("结算周期 ID 无效");
      await deleteSettlementPeriodOnServer(periodId);
      return Response.json(await readClubData());
    }

    if (action === "mark_settlement_paid") {
      const settlementId = String(payload.settlement_id ?? "").trim();
      if (!settlementId) throw new Error("结算记录 ID 无效");
      const paidAt = Date.now();
      const noteProvided = Object.prototype.hasOwnProperty.call(payload, "note");
      const note = noteProvided ? normalizeSettlementNote(payload.note) : null;
      const result = noteProvided
        ? await db
            .prepare(
              "UPDATE settlement_records SET status = 'paid', paid_at = ?, note = ? WHERE id = ? AND status = 'pending'",
            )
            .bind(paidAt, note, settlementId)
            .run()
        : await db
            .prepare(
              "UPDATE settlement_records SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'",
            )
            .bind(paidAt, settlementId)
            .run();
      if (!result.meta.changes) {
        return Response.json(
          { error: "该结算已发放或记录不存在，未重复处理" },
          { status: 409 },
        );
      }
      return Response.json(await readClubData());
    }

    if (action === "update_settlement_note") {
      const settlementId = String(payload.settlement_id ?? "").trim();
      const note = normalizeSettlementNote(payload.note);
      const result = await db
        .prepare("UPDATE settlement_records SET note = ? WHERE id = ?")
        .bind(note, settlementId)
        .run();
      if (!result.meta.changes) throw new Error("未找到该结算记录");
      return Response.json(await readClubData());
    }

    if (action === "update_worker_settlement_config") {
      const workerId = String(payload.worker_id ?? "").trim();
      const row = await db
        .prepare(`${WORKER_SELECT} WHERE id = ?`)
        .bind(workerId)
        .first<WorkerRow>();
      if (!row) throw new Error("未找到该打手");
      const worker = workerFromRow(row);
      const config = workerSettlementConfigFromInput(
        payload.config,
        worker.settlement_config,
      );
      await db
        .prepare(
          "UPDATE workers SET settlement_interval_days = ?, settlement_reminder_hours = ? WHERE id = ?",
        )
        .bind(
          config.interval_days,
          config.reminder_hours,
          workerId,
        )
        .run();
      return Response.json(await readClubData());
    }

    if (action === "add_menu_item") {
      const rawItem = (payload.item ?? {}) as Record<string, unknown>;
      const itemId = String(rawItem.id ?? "").trim();
      const serviceName = String(rawItem.service_name ?? "").trim();
      const folderId = typeof rawItem.folderId === "string" && rawItem.folderId.trim()
        ? rawItem.folderId.trim()
        : null;
      const splitType = String(rawItem.split_type ?? "") as SplitType;
      const rawOrderType = rawItem.order_type ?? "escort";
      if (rawOrderType !== "escort" && rawOrderType !== "companion") {
        throw new Error("请选择有效订单类型");
      }
      const orderType = rawOrderType as OrderType;
      const rawCommissionMode = rawItem.commission_mode ?? "uniform";
      if (rawCommissionMode !== "uniform" && rawCommissionMode !== "by_tier") {
        throw new Error("请选择有效抽成模式");
      }
      const commissionMode = rawCommissionMode as CommissionMode;
      if (!itemId || itemId.length > 128) throw new Error("服务 ID 无效");
      if (Array.from(serviceName).length > 60) throw new Error("服务名称最多 60 个字符");
      if (!["single", "equal", "tiered"].includes(splitType)) {
        throw new Error("请选择有效分配模式");
      }

      const rawRatios = (rawItem.tiered_ratios ?? null) as Partial<TieredRatios> | null;
      const providedTiers = Array.isArray(rawItem.eligible_tiers)
        ? rawItem.eligible_tiers.map(String)
        : [];
      if (providedTiers.some((tier) => !["1档", "2档", "3档"].includes(tier))) {
        throw new Error("可接档位配置无效");
      }
      const eligibleTiers = splitType === "tiered"
        ? (["1档", "2档"] as WorkerTier[])
        : ([...new Set(providedTiers)] as WorkerTier[]);
      const item: PriceMenuItem = {
        id: itemId,
        service_name: serviceName,
        folderId,
        order: 0,
        order_type: orderType,
        base_price: orderType === "escort"
          ? fromCents(toCents(Number(rawItem.base_price)))
          : 0,
        hourly_rate: orderType === "companion"
          ? fromCents(toCents(Number(rawItem.hourly_rate)))
          : 0,
        commission_mode: commissionMode,
        club_commission_rate: normalizeCommissionRate(
          rawItem.club_commission_rate,
          "统一抽成",
        ),
        tier_commission_rates: normalizeTierCommissionRates(
          rawItem.tier_commission_rates,
        ),
        split_type: splitType,
        tiered_ratios: splitType === "tiered"
          ? {
              "1档": Number(rawRatios?.["1档"]),
              "2档": Number(rawRatios?.["2档"]),
            }
          : null,
        eligible_tiers: eligibleTiers,
      };
      if (
        item.split_type === "tiered" &&
        (!Number.isFinite(item.tiered_ratios?.["1档"]) ||
          !Number.isFinite(item.tiered_ratios?.["2档"]))
      ) {
        throw new Error("请填写有效的档位占比");
      }
      validateMenuRule(item);

      if (folderId) {
        const folder = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first<{ id: string }>();
        if (!folder) throw new Error("目标文件夹不存在");
      }
      const nextOrder = await db
        .prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM price_menu WHERE folder_id IS ?")
        .bind(folderId)
        .first<{ value: number }>();
      item.order = nextOrder?.value ?? 0;

      const result = await db
        .prepare("INSERT INTO price_menu (id, service_name, folder_id, sort_order, order_type, base_price_cents, hourly_rate_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM price_menu WHERE service_name = ? COLLATE NOCASE)")
        .bind(
          item.id,
          item.service_name,
          item.folderId,
          item.order,
          item.order_type,
          toCents(item.base_price),
          toCents(item.hourly_rate),
          item.commission_mode,
          Math.round(item.club_commission_rate * 100),
          JSON.stringify(item.tier_commission_rates),
          item.split_type,
          item.split_type === "tiered" ? JSON.stringify(item.tiered_ratios) : null,
          JSON.stringify(item.eligible_tiers),
          new Date().toISOString(),
          item.service_name,
        )
        .run();
      if (!result.meta.changes) {
        return Response.json(
          { error: "已存在同名服务，请使用其他名称" },
          { status: 409 },
        );
      }
      return Response.json({
        ...(await readClubData()),
        created_menu_item: item,
      });
    }

    if (action === "reorder_workers") {
      const ids = parseOrderedIds(payload.worker_ids, "打手");
      const existing = await db.prepare("SELECT id FROM workers").all<{ id: string }>();
      if (
        ids.length !== existing.results.length ||
        existing.results.some((worker) => !ids.includes(worker.id))
      ) {
        throw new Error("打手排序数据无效，请刷新后重试");
      }
      if (ids.length) {
        await db.batch(ids.map((id, index) =>
          db.prepare("UPDATE workers SET sort_order = ? WHERE id = ?").bind(index, id),
        ));
      }
      return Response.json(await readClubData());
    }

    if (action === "reorder_menu_items") {
      const ids = parseOrderedIds(payload.item_ids, "服务");
      if (!ids.length) return Response.json(await readClubData());
      const first = await db.prepare("SELECT folder_id FROM price_menu WHERE id = ?").bind(ids[0]).first<{ folder_id: string | null }>();
      if (!first) throw new Error("服务排序数据无效，请刷新后重试");
      const existing = await db
        .prepare("SELECT id FROM price_menu WHERE folder_id IS ?")
        .bind(first.folder_id)
        .all<{ id: string }>();
      if (
        ids.length !== existing.results.length ||
        existing.results.some((item) => !ids.includes(item.id))
      ) {
        throw new Error("服务排序数据无效，请刷新后重试");
      }
      await db.batch(ids.map((id, index) =>
        db.prepare("UPDATE price_menu SET sort_order = ? WHERE id = ? AND folder_id IS ?")
          .bind(index, id, first.folder_id),
      ));
      return Response.json(await readClubData());
    }

    if (action === "reorder_folders") {
      const ids = parseOrderedIds(payload.folder_ids, "文件夹");
      const parentId = typeof payload.parent_id === "string" && payload.parent_id.trim()
        ? payload.parent_id.trim()
        : null;
      const existing = await db
        .prepare("SELECT id FROM folders WHERE parent_id IS ?")
        .bind(parentId)
        .all<{ id: string }>();
      if (
        ids.length !== existing.results.length ||
        existing.results.some((folder) => !ids.includes(folder.id))
      ) {
        throw new Error("文件夹排序数据无效，请刷新后重试");
      }
      if (ids.length) {
        await db.batch(ids.map((id, index) =>
          db.prepare("UPDATE folders SET sort_order = ? WHERE id = ? AND parent_id IS ?")
            .bind(index, id, parentId),
        ));
      }
      return Response.json(await readClubData());
    }

    if (action === "add_folder") {
      const rawFolder = (payload.folder ?? {}) as Record<string, unknown>;
      const id = String(rawFolder.id ?? "").trim();
      const name = normalizeFolderName(rawFolder.name);
      const parentId = typeof rawFolder.parentId === "string" && rawFolder.parentId.trim()
        ? rawFolder.parentId.trim()
        : null;
      const createdAt = Number(rawFolder.createdAt ?? Date.now());
      if (!id || id.length > 128) throw new Error("文件夹 ID 无效");
      if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw new Error("文件夹创建时间无效");
      if (parentId) {
        const parent = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(parentId).first<{ id: string }>();
        if (!parent) throw new Error("父文件夹不存在");
      }
      const result = await db
        .prepare("INSERT INTO folders (id, name, parent_id, sort_order, created_at) SELECT ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM folders WHERE parent_id IS ?), 0), ? WHERE NOT EXISTS (SELECT 1 FROM folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE)")
        .bind(id, name, parentId, parentId, createdAt, parentId, name)
        .run();
      if (!result.meta.changes) {
        return Response.json({ error: "同一层级已存在同名文件夹" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "rename_folder") {
      const folderId = String(payload.folder_id ?? "").trim();
      const name = normalizeFolderName(payload.name);
      const existing = await db
        .prepare("SELECT id, parent_id FROM folders WHERE id = ?")
        .bind(folderId)
        .first<{ id: string; parent_id: string | null }>();
      if (!existing) throw new Error("未找到该文件夹");
      const result = await db
        .prepare("UPDATE folders SET name = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM folders AS duplicate WHERE duplicate.parent_id IS ? AND duplicate.name = ? COLLATE NOCASE AND duplicate.id <> ?)")
        .bind(name, folderId, existing.parent_id, name, folderId)
        .run();
      if (!result.meta.changes) {
        return Response.json({ error: "同一层级已存在同名文件夹" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "delete_folder") {
      const folderId = String(payload.folder_id ?? "").trim();
      const folderRows = await db
        .prepare("SELECT id, name, parent_id, sort_order, created_at FROM folders")
        .all<FolderRow>();
      const folder = folderRows.results.find((row) => row.id === folderId);
      if (!folder) throw new Error("未找到该文件夹");
      const folderData: Folder[] = folderRows.results.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id ?? null,
        order: row.sort_order,
        createdAt: row.created_at,
      }));
      const descendantIds = getDescendantFolderIds(folderData, folderId);
      const subtreeIds = [folderId, ...descendantIds];
      const placeholders = subtreeIds.map(() => "?").join(", ");
      const [rootItemOrder, rootFolderOrder, itemResult] = await Promise.all([
        db.prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM price_menu WHERE folder_id IS NULL").first<{ value: number }>(),
        db.prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM folders WHERE parent_id IS NULL").first<{ value: number }>(),
        db.prepare(`SELECT id FROM price_menu WHERE folder_id IN (${placeholders}) ORDER BY folder_id, sort_order, id`)
          .bind(...subtreeIds)
          .all<{ id: string }>(),
      ]);
      const nextItemOrder = rootItemOrder?.value ?? 0;
      const nextFolderOrder = rootFolderOrder?.value ?? 0;
      const statements = itemResult.results.map((item, index) =>
        db.prepare("UPDATE price_menu SET folder_id = NULL, sort_order = ? WHERE id = ?")
          .bind(nextItemOrder + index, item.id),
      );
      const descendants = folderData
        .filter((candidate) => descendantIds.includes(candidate.id))
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      descendants.forEach((candidate, index) => {
        statements.push(
          db.prepare("UPDATE folders SET parent_id = NULL, sort_order = ? WHERE id = ?")
            .bind(nextFolderOrder + index, candidate.id),
        );
      });
      statements.push(db.prepare("DELETE FROM folders WHERE id = ?").bind(folderId));
      await db.batch(statements);
      return Response.json(await readClubData());
    }

    if (action === "move_folder_to_folder") {
      const folderId = String(payload.folder_id ?? "").trim();
      const targetParentId = typeof payload.target_parent_id === "string" && payload.target_parent_id.trim()
        ? payload.target_parent_id.trim()
        : null;
      const folderRows = await db
        .prepare("SELECT id, name, parent_id, sort_order, created_at FROM folders")
        .all<FolderRow>();
      const folders: Folder[] = folderRows.results.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id ?? null,
        order: row.sort_order,
        createdAt: row.created_at,
      }));
      const folder = folders.find((candidate) => candidate.id === folderId);
      if (!folder) throw new Error("未找到该文件夹");
      if (targetParentId !== null && !folders.some((candidate) => candidate.id === targetParentId)) {
        throw new Error("目标文件夹不存在");
      }
      if (targetParentId === folderId || isDescendant(folders, folderId, targetParentId)) {
        return Response.json({ error: "不能把文件夹移动到自身或其子文件夹中" }, { status: 409 });
      }
      if ((folder.parentId ?? null) === targetParentId) return Response.json(await readClubData());
      const duplicate = folders.some((candidate) =>
        candidate.id !== folderId &&
        (candidate.parentId ?? null) === targetParentId &&
        candidate.name.toLocaleLowerCase("zh-CN") === folder.name.toLocaleLowerCase("zh-CN")
      );
      if (duplicate) {
        return Response.json({ error: "目标层级已存在同名文件夹" }, { status: 409 });
      }
      const nextOrder = await db
        .prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM folders WHERE parent_id IS ?")
        .bind(targetParentId)
        .first<{ value: number }>();
      await db.prepare("UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?")
        .bind(targetParentId, nextOrder?.value ?? 0, folderId)
        .run();
      return Response.json(await readClubData());
    }

    if (action === "move_item_to_folder") {
      const itemId = String(payload.item_id ?? "").trim();
      const folderId = typeof payload.folder_id === "string" && payload.folder_id.trim()
        ? payload.folder_id.trim()
        : null;
      const item = await db.prepare("SELECT id, folder_id FROM price_menu WHERE id = ?").bind(itemId).first<{ id: string; folder_id: string | null }>();
      if (!item) throw new Error("未找到该服务项目");
      if (folderId) {
        const folder = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first<{ id: string }>();
        if (!folder) throw new Error("目标文件夹不存在");
      }
      if (item.folder_id === folderId) return Response.json(await readClubData());
      const nextOrder = await db
        .prepare("SELECT COALESCE(MAX(sort_order) + 1, 0) AS value FROM price_menu WHERE folder_id IS ?")
        .bind(folderId)
        .first<{ value: number }>();
      await db.prepare("UPDATE price_menu SET folder_id = ?, sort_order = ? WHERE id = ?")
        .bind(folderId, nextOrder?.value ?? 0, itemId)
        .run();
      return Response.json(await readClubData());
    }

    if (action === "delete_menu_item") {
      const menuItemId = String(payload.menu_item_id ?? "").trim();
      if (!menuItemId || menuItemId.length > 128) throw new Error("服务 ID 无效");

      // 同一条 DELETE 内再次检查 active 订单，避免校验与删除之间出现竞态。
      const result = await db
        .prepare("DELETE FROM price_menu WHERE id = ? AND NOT EXISTS (SELECT 1 FROM orders WHERE status = 'active' AND menu_item_id = ?)")
        .bind(menuItemId, menuItemId)
        .run();
      if (!result.meta.changes) {
        const [existing, activeOrder] = await Promise.all([
          db.prepare("SELECT id FROM price_menu WHERE id = ?").bind(menuItemId).first<{ id: string }>(),
          db.prepare("SELECT id FROM orders WHERE status = 'active' AND menu_item_id = ? LIMIT 1").bind(menuItemId).first<{ id: string }>(),
        ]);
        if (activeOrder) {
          return Response.json(
            { error: "该服务有正在进行的订单，无法删除，请先完结订单" },
            { status: 409 },
          );
        }
        if (!existing) throw new Error("未找到该服务项目");
        throw new Error("服务删除失败，请稍后重试");
      }

      // 历史订单只保留 menu_item_id 与完整价格快照，不随价格表项目一起删除。
      return Response.json(await readClubData());
    }

    if (action === "update_worker") {
      const workerId = String(payload.worker_id ?? "");
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const name = String(data.name ?? "").trim();
      const workerType = normalizeWorkerType(data.workerType);
      const tier = normalizeWorkerTier(data.tier, workerType);
      if (!name) throw new Error("请输入打手姓名");
      if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");

      const existing = await db
        .prepare(`${WORKER_SELECT} WHERE id = ?`)
        .bind(workerId)
        .first<WorkerRow>();
      if (!existing) throw new Error("未找到该打手");
      const gender = Object.prototype.hasOwnProperty.call(data, "gender")
        ? normalizeWorkerGender(data.gender)
        : normalizeWorkerGender(existing.gender);
      const existingType = normalizeWorkerType(existing.worker_type);
      const existingTier = normalizeWorkerTier(existing.tier, existingType);
      if (
        existing.status === "busy" &&
        (tier !== existingTier || workerType !== existingType)
      ) {
        return Response.json({ error: "该打手正在接单，只能修改姓名、性别和结算配置" }, { status: 409 });
      }

      const existingWorker = workerFromRow(existing);
      const config = Object.prototype.hasOwnProperty.call(data, "settlement_config")
        ? workerSettlementConfigFromInput(
            data.settlement_config,
            existingWorker.settlement_config,
          )
        : existingWorker.settlement_config;

      const result = await db
        .prepare("UPDATE workers SET name = ?, gender = ?, tier = ?, worker_type = ?, settlement_interval_days = ?, settlement_reminder_hours = ? WHERE id = ? AND (status = 'idle' OR (tier = ? AND worker_type = ?))")
        .bind(
          name,
          gender,
          tier ?? "",
          workerType,
          config.interval_days,
          config.reminder_hours,
          workerId,
          tier ?? "",
          workerType,
        )
        .run();
      if (!result.meta.changes) {
        return Response.json({ error: "打手状态刚刚发生变化，请重试" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "delete_historical_order") {
      const orderId = String(payload.order_id ?? "");
      const row = await db
        .prepare(`${ORDER_SELECT} WHERE id = ?`)
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "completed") {
        return Response.json({ error: "只允许删除已完成的历史订单" }, { status: 409 });
      }

      const settlementIds = [...new Set([
        ...Object.values(parseSettlementIdsByWorker(row.settlement_ids_by_worker_json)),
        ...(row.settlement_id ? [row.settlement_id] : []),
      ])];
      const pendingRecords = settlementIds.length
        ? await db
            .prepare(
              `${SETTLEMENT_RECORD_SELECT} WHERE id IN (${settlementIds.map(() => "?").join(", ")}) AND status = 'pending'`,
            )
            .bind(...settlementIds)
            .all<SettlementRecordRow>()
        : { results: [] as SettlementRecordRow[] };
      const order = orderFromRow(row);
      const allOrderResult = await db.prepare(ORDER_SELECT).all<OrderRow>();
      const allOrders = allOrderResult.results.map(orderFromRow);
      const statements = pendingRecords.results.map((recordRow) => {
        const record = hydrateSettlementRecord(
          settlementRecordFromRow(recordRow),
          allOrders,
        );
        const remainingDetails = record.order_details.filter(
          (detail) => detail.order_id !== orderId,
        );
        const remainingOrderIds = record.order_ids.filter((id) => id !== orderId);
        const remainingAmountCents = remainingDetails.length
          ? remainingDetails.reduce(
              (sum, detail) => sum + toCents(detail.worker_amount),
              0,
            )
          : Math.max(
              0,
              toCents(record.total_amount) -
                toCents(calculateWorkerEarningForOrder(order, record.worker_id)),
            );
        return db
          .prepare(
            "UPDATE settlement_records SET order_ids_json = ?, order_details_json = ?, total_orders = ?, total_amount_cents = ? WHERE id = ? AND status = 'pending'",
          )
          .bind(
            JSON.stringify(remainingOrderIds),
            JSON.stringify(remainingDetails),
            remainingOrderIds.length,
            remainingAmountCents,
            record.id,
          );
      });
      const tipEarnings = resolveWorkerTipEarnings(order);
      statements.push(
        ...Object.entries(tipEarnings).map(([workerId, amount]) =>
          db
            .prepare(
              "UPDATE workers SET total_tip_earnings_cents = MAX(0, total_tip_earnings_cents - ?) WHERE id = ?",
            )
            .bind(toCents(amount), workerId),
        ),
      );
      // 待发放批次随订单回退；已发放批次保留生成时快照与金额，不做追溯扣减。
      const deleteStatementIndex = statements.length;
      statements.push(
        db.prepare("DELETE FROM orders WHERE id = ? AND status = 'completed'").bind(orderId),
        db.prepare("UPDATE workers SET total_completed_orders = (SELECT COUNT(*) FROM orders AS completed_order WHERE completed_order.status = 'completed' AND EXISTS (SELECT 1 FROM json_each(completed_order.assigned_worker_ids_json) AS assigned WHERE assigned.value = workers.id))"),
      );
      const results = await db.batch(statements);
      const deleteResult = results[deleteStatementIndex];
      if (!deleteResult?.meta.changes) {
        return Response.json({ error: "订单状态刚刚发生变化，未执行删除" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "delete_worker") {
      const workerId = String(payload.worker_id ?? "");
      const worker = await db
        .prepare(`${WORKER_SELECT} WHERE id = ?`)
        .bind(workerId)
        .first<WorkerRow>();
      if (!worker) throw new Error("未找到该打手");
      if (worker.status === "busy") {
        return Response.json({ error: "该打手正在接单，无法删除" }, { status: 409 });
      }
      const pendingSettlement = await db
        .prepare(
          "SELECT id FROM settlement_records WHERE worker_id = ? AND status = 'pending' LIMIT 1",
        )
        .bind(workerId)
        .first<{ id: string }>();
      if (pendingSettlement) {
        return Response.json(
          { error: "该打手有待发放结算，请先处理" },
          { status: 409 },
        );
      }

      const orderResult = await db
        .prepare(ORDER_SELECT)
        .all<OrderRow>();
      const allOrderModels = orderResult.results.map(orderFromRow);
      const relatedOrders = orderResult.results.filter((order) =>
        (JSON.parse(order.assigned_worker_ids_json) as string[]).includes(workerId),
      );
      const relatedOrderModels = allOrderModels.filter((order) =>
        order.assigned_worker_ids.includes(workerId),
      );
      if (relatedOrders.some((order) => order.status === "active")) {
        return Response.json({ error: "该打手正在接单，无法删除" }, { status: 409 });
      }

      const relatedOrderIds = new Set(relatedOrders.map((order) => order.id));
      const pendingRelatedRecords = relatedOrders.length
        ? await db
            .prepare(`${SETTLEMENT_RECORD_SELECT} WHERE status = 'pending'`)
            .all<SettlementRecordRow>()
        : { results: [] as SettlementRecordRow[] };
      const statements = pendingRelatedRecords.results
        .map((row) => hydrateSettlementRecord(settlementRecordFromRow(row), allOrderModels))
        .filter((record) => record.order_ids.some((id) => relatedOrderIds.has(id)))
        .map((record) => {
          const remainingOrderIds = record.order_ids.filter(
            (id) => !relatedOrderIds.has(id),
          );
          const remainingDetails = record.order_details.filter(
            (detail) => !relatedOrderIds.has(detail.order_id),
          );
          const remainingAmountCents = remainingDetails.reduce(
            (sum, detail) => sum + toCents(detail.worker_amount),
            0,
          );
          return db
            .prepare(
              "UPDATE settlement_records SET order_ids_json = ?, order_details_json = ?, total_orders = ?, total_amount_cents = ? WHERE id = ? AND status = 'pending'",
            )
            .bind(
              JSON.stringify(remainingOrderIds),
              JSON.stringify(remainingDetails),
              remainingOrderIds.length,
              remainingAmountCents,
              record.id,
            );
        });
      const tipDeductions = new Map<string, number>();
      relatedOrderModels
        .filter((order) => order.status === "completed")
        .forEach((order) => {
          Object.entries(resolveWorkerTipEarnings(order)).forEach(([relatedWorkerId, amount]) => {
            if (relatedWorkerId === workerId) return;
            tipDeductions.set(
              relatedWorkerId,
              fromCents(
                toCents(tipDeductions.get(relatedWorkerId) ?? 0) + toCents(amount),
              ),
            );
          });
        });
      statements.push(
        ...[...tipDeductions.entries()].map(([relatedWorkerId, amount]) =>
          db
            .prepare(
              "UPDATE workers SET total_tip_earnings_cents = MAX(0, total_tip_earnings_cents - ?) WHERE id = ?",
            )
            .bind(toCents(amount), relatedWorkerId),
        ),
      );
      if (relatedOrders.length) {
        // 删除关联订单会一并移除 final_worker_incomes、tips_by_worker_json 与
        // final_club_income；共享订单中其他打手的业绩随后也会按剩余订单重算。
        const placeholders = relatedOrders.map(() => "?").join(", ");
        statements.push(
          db
            .prepare(`DELETE FROM orders WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'idle')`)
            .bind(...relatedOrders.map((order) => order.id), workerId),
        );
      }
      statements.push(
        db.prepare("UPDATE workers SET total_completed_orders = (SELECT COUNT(*) FROM orders AS completed_order WHERE completed_order.status = 'completed' AND EXISTS (SELECT 1 FROM json_each(completed_order.assigned_worker_ids_json) AS assigned WHERE assigned.value = workers.id)) WHERE EXISTS (SELECT 1 FROM workers AS target WHERE target.id = ? AND target.status = 'idle')").bind(workerId),
      );
      statements.push(
        db.prepare("DELETE FROM workers WHERE id = ? AND status = 'idle'").bind(workerId),
      );
      const results = await db.batch(statements);
      if (!results.at(-1)?.meta.changes) {
        return Response.json({ error: "该打手正在接单，无法删除" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "replace_worker_with_fee") {
      const orderId = String(payload.order_id ?? "");
      const oldWorkerId = String(payload.old_worker_id ?? "");
      const newWorkerId = String(payload.new_worker_id ?? "");
      const transferFee = fromCents(toCents(Number(payload.transfer_fee ?? 0)));
      if (!newWorkerId || newWorkerId === oldWorkerId) {
        throw new Error("请选择另一名空闲打手");
      }
      const row = await db
        .prepare(`${ORDER_SELECT} WHERE id = ?`)
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "active") {
        return Response.json({ error: "订单已结束或不存在" }, { status: 409 });
      }

      const assignedWorkerIds = JSON.parse(row.assigned_worker_ids_json) as string[];
      if (!assignedWorkerIds.includes(oldWorkerId)) throw new Error("该打手不属于当前订单");
      const snapshot = parsePricingSnapshot(row.pricing_snapshot_json);
      const amounts = orderAmountsFromRow(row, snapshot);
      const oldWeight = snapshot.payout_weights.find(
        (entry) => entry.workerId === oldWorkerId,
      );
      if (!oldWeight) throw new Error("订单缺少该打手的分配权重");

      const [menuRow, workerResult] = await Promise.all([
        db
          .prepare("SELECT id, service_name, folder_id, sort_order, order_type, base_price_cents, hourly_rate_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu WHERE id = ?")
          .bind(row.menu_item_id)
          .first<MenuRow>(),
        db
          .prepare(`${WORKER_SELECT} ORDER BY sort_order, id`)
          .all<WorkerRow>(),
      ]);
      if (!menuRow) throw new Error("服务项目不存在");
      const oldWorker = workerResult.results.map(workerFromRow).find((worker) => worker.id === oldWorkerId);
      if (!oldWorker || oldWorker.status !== "busy") {
        return Response.json({ error: "原打手当前不在接单" }, { status: 409 });
      }
      const replacement = workerResult.results.map(workerFromRow).find(
        (worker) => worker.id === newWorkerId,
      );
      if (!replacement || replacement.status !== "idle") {
        return Response.json({ error: "所选新打手当前不是空闲状态" }, { status: 409 });
      }
      if (assignedWorkerIds.includes(replacement.id)) {
        throw new Error("所选打手已经在本订单中");
      }

      const assignmentRule = {
        commission_mode: snapshot.commission_mode,
        split_type: snapshot.split_type,
        eligible_tiers:
          snapshot.split_type === "tiered" && oldWeight.tier
            ? [oldWeight.tier]
            : (JSON.parse(menuRow.eligible_tiers_json) as WorkerTier[]),
      };
      if (!isWorkerEligibleForRule(assignmentRule, replacement)) {
        throw new Error("所选新打手不符合该订单的档位或抽成规则");
      }

      const newAssignedWorkerIds = assignedWorkerIds.map((workerId) =>
        workerId === oldWorkerId ? replacement.id : workerId,
      );
      const newSnapshot: OrderPricingSnapshot = {
        ...snapshot,
        payout_weights: snapshot.payout_weights.map((entry) =>
          entry.workerId === oldWorkerId
            ? {
                ...entry,
                workerId: replacement.id,
                workerName: replacement.name,
                workerType: replacement.workerType,
                tier: replacement.tier,
              }
            : entry,
        ),
      };
      const transferFeesByWorker = parseStoredWorkerEarnings(
        row.transfer_fees_by_worker_json,
      );
      delete transferFeesByWorker[oldWorkerId];
      transferFeesByWorker[replacement.id] = transferFee;
      // 换人后继续沿用原订单冻结价格。新打手的订单份额按其档位重新计算，
      // 转单费作为工资直接加给新打手，并从俱乐部抽成中等额扣除；负抽成允许保留。
      calculateSettlementWithTransferFees(
        newSnapshot,
        {},
        fromCents(amounts.orderOriginalTotalCents),
        transferFeesByWorker,
      );
      const changedAt = new Date().toISOString();
      const reassignmentHistory = parseReassignmentHistory(
        row.reassignment_history_json,
      );
      reassignmentHistory.push({
        changed_at: changedAt,
        old_worker_id: oldWorker.id,
        old_worker_name: oldWorker.name,
        new_worker_id: replacement.id,
        new_worker_name: replacement.name,
        transfer_fee: transferFee,
      });
      const settlementPeriodIdsByWorker = parseSettlementIdsByWorker(
        row.settlement_period_ids_by_worker_json,
      );
      delete settlementPeriodIdsByWorker[oldWorkerId];
      const periodSetup = await ensureOrderPeriodsForWorkers(
        [replacement.id],
        Date.parse(changedAt),
      );
      settlementPeriodIdsByWorker[replacement.id] = periodSetup.periods.get(
        replacement.id,
      )!.id;
      try {
        const [orderResult, replacementResult, oldWorkerResult] = await db.batch([
          db
            .prepare("UPDATE orders SET assigned_worker_ids_json = ?, pricing_snapshot_json = ?, transfer_fees_by_worker_json = ?, reassignment_history_json = ?, settlement_period_id = ?, settlement_period_ids_by_worker_json = ? WHERE id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'busy') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'idle')")
            .bind(
              JSON.stringify(newAssignedWorkerIds),
              JSON.stringify(newSnapshot),
              JSON.stringify(transferFeesByWorker),
              JSON.stringify(reassignmentHistory),
              settlementPeriodIdsByWorker[newAssignedWorkerIds[0]] ?? null,
              JSON.stringify(settlementPeriodIdsByWorker),
              orderId,
              oldWorkerId,
              replacement.id,
            ),
          db.prepare("UPDATE workers SET status = 'busy' WHERE id = ? AND status = 'idle' AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM json_each(assigned_worker_ids_json) AS assigned WHERE assigned.value = ?))").bind(replacement.id, orderId, replacement.id),
          db.prepare("UPDATE workers SET status = 'idle' WHERE id = ? AND status = 'busy' AND NOT EXISTS (SELECT 1 FROM orders AS active_order WHERE active_order.status = 'active' AND EXISTS (SELECT 1 FROM json_each(active_order.assigned_worker_ids_json) AS assigned WHERE assigned.value = ?))").bind(oldWorkerId, oldWorkerId),
        ]);
        if (
          !orderResult.meta.changes ||
          !replacementResult.meta.changes ||
          !oldWorkerResult.meta.changes
        ) {
          await cleanupUnusedPeriods(periodSetup.created);
          return Response.json(
            { error: "打手状态刚刚发生变化，请重新操作" },
            { status: 409 },
          );
        }
      } catch (error) {
        await cleanupUnusedPeriods(periodSetup.created);
        throw error;
      }
      return Response.json({
        ...(await readClubData()),
        new_order_id: orderId,
        new_worker_id: replacement.id,
      });
    }

    if (action === "update_menu") {
      const rawItem = (payload.item ?? {}) as Record<string, unknown>;
      const itemId = String(rawItem.id ?? "").trim();
      const serviceName = String(rawItem.service_name ?? "").trim();
      const splitType = String(rawItem.split_type ?? "") as SplitType;
      const rawOrderType = rawItem.order_type ?? "escort";
      if (rawOrderType !== "escort" && rawOrderType !== "companion") {
        throw new Error("请选择有效订单类型");
      }
      const orderType = rawOrderType as OrderType;
      const rawCommissionMode = rawItem.commission_mode ?? "uniform";
      if (!itemId || itemId.length > 128) throw new Error("服务 ID 无效");
      if (Array.from(serviceName).length > 60) throw new Error("服务名称最多 60 个字符");
      if (!["single", "equal", "tiered"].includes(splitType)) {
        throw new Error("请选择有效分配模式");
      }
      if (rawCommissionMode !== "uniform" && rawCommissionMode !== "by_tier") {
        throw new Error("请选择有效抽成模式");
      }
      const rawRatios = (rawItem.tiered_ratios ?? null) as Partial<TieredRatios> | null;
      const providedTiers = Array.isArray(rawItem.eligible_tiers)
        ? rawItem.eligible_tiers.map(String)
        : [];
      if (providedTiers.some((tier) => !["1档", "2档", "3档"].includes(tier))) {
        throw new Error("可接档位配置无效");
      }
      const item: PriceMenuItem = {
        id: itemId,
        service_name: serviceName,
        folderId: typeof rawItem.folderId === "string" ? rawItem.folderId : null,
        order: Number(rawItem.order ?? 0),
        order_type: orderType,
        base_price: orderType === "escort"
          ? fromCents(toCents(Number(rawItem.base_price)))
          : 0,
        hourly_rate: orderType === "companion"
          ? fromCents(toCents(Number(rawItem.hourly_rate)))
          : 0,
        commission_mode: rawCommissionMode,
        club_commission_rate: normalizeCommissionRate(
          rawItem.club_commission_rate,
          "统一抽成",
        ),
        tier_commission_rates: normalizeTierCommissionRates(
          rawItem.tier_commission_rates,
        ),
        split_type: splitType,
        tiered_ratios: splitType === "tiered"
          ? {
              "1档": Number(rawRatios?.["1档"]),
              "2档": Number(rawRatios?.["2档"]),
            }
          : null,
        eligible_tiers: splitType === "tiered"
          ? ["1档", "2档"]
          : ([...new Set(providedTiers)] as WorkerTier[]),
      };
      if (
        item.split_type === "tiered" &&
        (!Number.isFinite(item.tiered_ratios?.["1档"]) ||
          !Number.isFinite(item.tiered_ratios?.["2档"]))
      ) {
        throw new Error("请填写有效的档位占比");
      }
      validateMenuRule(item);
      const result = await db
        .prepare("UPDATE price_menu SET service_name = ?, order_type = ?, base_price_cents = ?, hourly_rate_cents = ?, commission_mode = ?, club_commission_bps = ?, tier_commission_rates_json = ?, split_type = ?, tiered_ratios_json = ?, eligible_tiers_json = ?, updated_at = ? WHERE id = ?")
        .bind(
          item.service_name.trim(),
          item.order_type,
          toCents(item.base_price),
          toCents(item.hourly_rate),
          item.commission_mode,
          Math.round(item.club_commission_rate * 100),
          JSON.stringify(item.tier_commission_rates),
          item.split_type,
          item.split_type === "tiered" ? JSON.stringify(item.tiered_ratios) : null,
          JSON.stringify(item.split_type === "tiered" ? ["1档", "2档"] : item.eligible_tiers),
          new Date().toISOString(),
          item.id,
        )
        .run();
      if (!result.meta.changes) throw new Error("未找到该服务项目");
      return Response.json(await readClubData());
    }

    if (action === "create_order") {
      const menuItemId = String(payload.menu_item_id ?? "");
      const workerIds = Array.isArray(payload.assigned_worker_ids)
        ? payload.assigned_worker_ids.map(String)
        : [];
      const specialRequirements = parseSpecialRequirements(
        payload.special_requirements ?? [],
      );
      if (!workerIds.length || new Set(workerIds).size !== workerIds.length) {
        throw new Error("请选择不重复的打手");
      }

      const menuRow = await db
        .prepare("SELECT id, service_name, folder_id, sort_order, order_type, base_price_cents, hourly_rate_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu WHERE id = ?")
        .bind(menuItemId)
        .first<MenuRow>();
      if (!menuRow) throw new Error("服务项目不存在");

      const placeholders = workerIds.map(() => "?").join(", ");
      const workerRows = await db
        .prepare(`${WORKER_SELECT} WHERE id IN (${placeholders})`)
        .bind(...workerIds)
        .all<WorkerRow>();
      const workersById = new Map(workerRows.results.map((worker) => [worker.id, worker]));
      const selectedWorkers = workerIds
        .map((id) => workersById.get(id))
        .filter(Boolean)
        .map((worker) => workerFromRow(worker!)) as Worker[];
      if (selectedWorkers.length !== workerIds.length) throw new Error("所选打手不存在");
      if (selectedWorkers.some((worker) => worker.status !== "idle")) {
        throw new Error("所选打手已被其他订单占用，请重新选择");
      }

      const eligibleTiers = JSON.parse(menuRow.eligible_tiers_json) as WorkerTier[];
      const assignmentRule = {
        commission_mode: normalizeCommissionMode(menuRow.commission_mode),
        split_type: menuRow.split_type,
        eligible_tiers: eligibleTiers,
      };
      if (selectedWorkers.some((worker) => !isWorkerEligibleForMenuItem(assignmentRule, worker))) {
        throw new Error("所选打手不符合该服务的档位或抽成规则");
      }
      const ratios = menuRow.tiered_ratios_json
        ? (JSON.parse(menuRow.tiered_ratios_json) as TieredRatios)
        : null;
      const payoutWeights = buildPayoutWeights(menuRow.split_type, selectedWorkers, ratios);
      const orderType = normalizeOrderType(menuRow.order_type);
      const hours = orderType === "companion"
        ? normalizeCompanionHours(payload.hours ?? 1)
        : null;
      const hourlyRateSnapshotCents = orderType === "companion"
        ? menuRow.hourly_rate_cents
        : 0;
      const basePriceSnapshot = calculateOrderBasePrice(
        {
          order_type: orderType,
          base_price: fromCents(menuRow.base_price_cents),
          hourly_rate: fromCents(menuRow.hourly_rate_cents),
        },
        hours ?? 1,
      );
      const basePriceSnapshotCents = toCents(basePriceSnapshot);
      const specialTotalCents = toCents(
        specialRequirementsTotal(specialRequirements),
      );
      const totalPriceCents = basePriceSnapshotCents + specialTotalCents;
      if (!Number.isSafeInteger(totalPriceCents)) {
        throw new Error("订单总金额超出安全范围");
      }
      const totalPrice = fromCents(totalPriceCents);
      // 再次走金额校验，确保多项加价求和后仍未超过全局安全上限。
      toCents(totalPrice);
      const snapshot: OrderPricingSnapshot = {
        service_name: menuRow.service_name,
        order_type: orderType,
        hourly_rate: fromCents(hourlyRateSnapshotCents),
        base_price: basePriceSnapshot,
        commission_mode: assignmentRule.commission_mode,
        club_commission_rate: menuRow.club_commission_bps / 100,
        tier_commission_rates: normalizeTierCommissionRates(
          menuRow.tier_commission_rates_json,
        ),
        split_type: menuRow.split_type,
        tiered_ratios: ratios,
        payout_weights: payoutWeights,
      };
      // 服务端权威校验本次实际打手组合与冻结后的结算规则。
      calculateSettlement(snapshot, {}, totalPrice);
      const orderId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const periodSetup = await ensureOrderPeriodsForWorkers(
        workerIds,
        Date.parse(createdAt),
      );
      const settlementPeriodIdsByWorker = periodMapFrom(periodSetup.periods);
      const settlementPeriodId = periodSetup.periods.get(workerIds[0])?.id ?? null;
      const idleCheck = `SELECT COUNT(*) FROM workers WHERE id IN (${placeholders}) AND status = 'idle'`;
      try {
        const [insertResult] = await db.batch([
          db.prepare(`INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, order_type, hours_half_units, hourly_rate_snapshot_cents, split_type, status, tip_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, settlement_period_id, settlement_period_ids_by_worker_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'active', 0, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (${idleCheck}) = ? AND EXISTS (SELECT 1 FROM price_menu WHERE id = ?)`).bind(
            orderId,
            menuItemId,
            JSON.stringify(workerIds),
            orderType,
            hours === null ? 0 : Math.round(hours * 2),
            hourlyRateSnapshotCents,
            snapshot.split_type,
            JSON.stringify(specialRequirements),
            basePriceSnapshotCents,
            specialTotalCents,
            totalPriceCents,
            totalPriceCents,
            JSON.stringify(snapshot),
            settlementPeriodId,
            JSON.stringify(settlementPeriodIdsByWorker),
            createdAt,
            ...workerIds,
            workerIds.length,
            menuItemId,
          ),
          db.prepare(`UPDATE workers SET status = 'busy' WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM orders WHERE id = ?)`).bind(...workerIds, orderId),
        ]);
        if (!insertResult.meta.changes) {
          await cleanupUnusedPeriods(periodSetup.created);
          return Response.json({ error: "打手状态刚刚发生变化，请重新选择" }, { status: 409 });
        }
      } catch (error) {
        await cleanupUnusedPeriods(periodSetup.created);
        throw error;
      }
      return Response.json({ ...(await readClubData()), created_order_id: orderId });
    }

    if (action === "finish_order") {
      const orderId = String(payload.order_id ?? "");
      const row = await db
        .prepare(`${ORDER_SELECT} WHERE id = ?`)
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "active") {
        return Response.json({ error: "订单已结束或不存在，未重复结算" }, { status: 409 });
      }

      const snapshot = parsePricingSnapshot(row.pricing_snapshot_json);
      const amounts = orderAmountsFromRow(row, snapshot);
      // 新客户端传 tips_by_worker；保留旧 tip 请求的按冻结权重回退，仅用于兼容。
      const tipsByWorker = payload.tips_by_worker === undefined
        ? legacyTipsByWorker(snapshot, Number(payload.tip ?? 0))
        : normalizeTipsByWorker(snapshot, payload.tips_by_worker);
      const totalTip = tipsByWorkerTotal(tipsByWorker);
      /*
       * finishOrder 权威公式（整数分）：
       * 1. 订单总价 = 基础价快照 + 特殊需求加价，两部分都参与抽成。
       * 2. single：打手实得 = 订单总价 × (1 - 该打手档位抽成率)。
       * 3. equal：每人先分订单总价的 1/2，再分别扣除自己档位对应的抽成；
       *    俱乐部实得 = 订单总价 - A 基础实得 - B 基础实得。
       * 4. worker_order_earnings = 每名打手的基础实得 + 其转单费，只进入工资结算周期；
       *    转单费从俱乐部抽成中等额扣除，允许俱乐部实得为负数；
       *    worker_tip_earnings = tips_by_worker，100% 即时到账且不进入周期。
       * 5. final_worker_incomes 保存订单工资 + 即时打赏，供总收入与历史兼容展示。
       * 6. 样例：168 元 equal 单，1档 25%、2档 20%，两人各自基数为 84 元，
       *    基础实得 63 元和 67.2 元；若仅给 1档打手 10 元打赏，最终实得
       *    73 元和 67.2 元，俱乐部仍实得 37.8 元。
       */
      const transferFeesByWorker = parseStoredWorkerEarnings(
        row.transfer_fees_by_worker_json,
      );
      const settlement = calculateSettlementWithTransferFees(
        snapshot,
        tipsByWorker,
        fromCents(amounts.orderOriginalTotalCents),
        transferFeesByWorker,
      );
      const workerOrderEarnings = deriveWorkerOrderEarnings(
        settlement.worker_incomes,
        tipsByWorker,
      );
      const workerTipEarnings: WorkerEarningsByWorker = { ...tipsByWorker };
      const workerIds = JSON.parse(row.assigned_worker_ids_json) as string[];
      const completedAt = new Date().toISOString();
      const settlementToken = crypto.randomUUID();
      const [finishResult] = await db.batch([
        db.prepare("UPDATE orders SET status = 'completed', tip_cents = ?, tips_by_worker_json = ?, worker_order_earnings_json = ?, worker_tip_earnings_json = ?, final_club_income_cents = ?, final_worker_incomes_json = ?, completed_at = ?, settlement_token = ? WHERE id = ? AND status = 'active'").bind(
          toCents(totalTip),
          JSON.stringify(tipsByWorker),
          JSON.stringify(workerOrderEarnings),
          JSON.stringify(workerTipEarnings),
          toSignedCents(settlement.club_income),
          JSON.stringify(settlement.worker_incomes),
          completedAt,
          settlementToken,
          orderId,
        ),
        ...workerIds.map((workerId) =>
          db.prepare("UPDATE workers SET status = 'idle', total_completed_orders = total_completed_orders + 1, total_tip_earnings_cents = total_tip_earnings_cents + ? WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND settlement_token = ?)")
            .bind(
              toCents(workerTipEarnings[workerId] ?? 0),
              workerId,
              orderId,
              settlementToken,
            ),
        ),
      ]);
      if (!finishResult.meta.changes) {
        return Response.json({ error: "订单已由其他操作结算，未重复入账" }, { status: 409 });
      }
      return Response.json({ ...(await readClubData()), settlement });
    }

    throw new Error("不支持的操作");
  } catch (error) {
    return jsonError(error);
  }
}
