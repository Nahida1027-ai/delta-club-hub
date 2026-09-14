import { getD1 } from "@/db";
import type {
  ClubData,
  CommissionMode,
  Folder,
  Order,
  OrderPricingSnapshot,
  OrderType,
  PriceMenuItem,
  SettlementOrderSnapshot,
  SettlementRecord,
  SettlementStatus,
  SpecialRequirement,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  TipsByWorker,
  Worker,
  WorkerIncome,
  WorkerTier,
  WorkerType,
} from "@/lib/club-types";
import {
  calculateNextSettlementTime,
  calculateWorkerEarningForOrder,
  defaultSettlementConfig,
  getOrdersInPeriod,
  normalizeSettlementIntervalDays,
  normalizeSettlementTime,
} from "@/lib/payroll-settlement";
import {
  buildPayoutWeights,
  calculateOrderBasePrice,
  calculateSettlement,
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
  validateMenuRule,
} from "@/lib/settlement";
import { getDescendantFolderIds, isDescendant } from "@/lib/folder-tree";
import {
  isWorkerEligibleForMenuItem,
  isWorkerEligibleForRule,
} from "@/lib/worker-eligibility";

export const runtime = "edge";

interface WorkerRow {
  id: string;
  name: string;
  tier: string;
  worker_type: string;
  sort_order: number;
  status: "idle" | "busy";
  total_completed_orders: number;
  joined_at: number;
  settlement_interval_days: number;
  settlement_time: string;
  last_settled_at: number | null;
  next_settlement_at: number | null;
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
}

interface SettlementRecordRow {
  id: string;
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
  "SELECT id, name, tier, worker_type, sort_order, status, total_completed_orders, joined_at, settlement_interval_days, settlement_time, last_settled_at, next_settlement_at FROM workers";
const ORDER_SELECT =
  "SELECT id, menu_item_id, assigned_worker_ids_json, order_type, hours_half_units, hourly_rate_snapshot_cents, split_type, status, tip_cents, tips_by_worker_json, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at, settled, settlement_id, settlement_ids_by_worker_json FROM orders";
const SETTLEMENT_RECORD_SELECT =
  "SELECT id, worker_id, worker_name_snapshot, worker_type_snapshot, period_start, period_end, order_ids_json, order_details_json, total_orders, total_amount_cents, status, paid_at, note, created_at FROM settlement_records";

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
    tier: normalizeWorkerTier(row.tier, workerType),
    workerType,
    order: row.sort_order,
    status: row.status,
    total_completed_orders: row.total_completed_orders,
    joined_at: row.joined_at,
    settlement_config: {
      interval_days: normalizeSettlementIntervalDays(
        row.settlement_interval_days ?? defaults.interval_days,
      ),
      settlement_time: normalizeSettlementTime(
        row.settlement_time ?? defaults.settlement_time,
      ),
      last_settled_at: row.last_settled_at ?? null,
      next_settlement_at: row.next_settlement_at ?? null,
    },
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
  const rates = parsed as Partial<Record<WorkerTier, unknown>>;
  return {
    "1档": normalizeCommissionRate(rates["1档"], "1档抽成"),
    "2档": normalizeCommissionRate(rates["2档"], "2档抽成"),
    "3档": normalizeCommissionRate(rates["3档"], "3档抽成"),
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
    tips_by_worker: parseStoredTipsByWorker(row.tips_by_worker_json, pricingSnapshot),
    final_club_income:
      row.final_club_income_cents === null
        ? null
        : fromCents(row.final_club_income_cents),
    final_worker_incomes: JSON.parse(row.final_worker_incomes_json) as WorkerIncome[],
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

/** 给迁移前的打手补齐首次结算起点与下次结算时间。 */
async function ensureWorkerSettlementSchedules(now = Date.now()) {
  const db = getD1();
  const result = await db
    .prepare(`${WORKER_SELECT} WHERE joined_at <= 0 OR next_settlement_at IS NULL`)
    .all<WorkerRow>();
  if (!result.results.length) return;

  const normalizedRows = await Promise.all(
    result.results.map(async (row) => {
      if (row.joined_at > 0) {
        return { row, joinedAt: row.joined_at, hasLegacyOrders: false };
      }
      const earliest = await db
        .prepare(
          "SELECT MIN(completed_at) AS completed_at FROM orders WHERE status = 'completed' AND completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(assigned_worker_ids_json) AS assigned WHERE assigned.value = ?)",
        )
        .bind(row.id)
        .first<{ completed_at: string | null }>();
      const earliestTimestamp = earliest?.completed_at
        ? Date.parse(earliest.completed_at)
        : Number.NaN;
      return {
        row,
        joinedAt: Number.isFinite(earliestTimestamp) ? earliestTimestamp : now,
        hasLegacyOrders: Number.isFinite(earliestTimestamp),
      };
    }),
  );

  await db.batch(
    normalizedRows.map(({ row, joinedAt, hasLegacyOrders }) => {
      const worker = workerFromRow({ ...row, joined_at: joinedAt });
      // 迁移前已有收入时先生成一张“历史待结”批次，避免旧订单因缺少真实加入时间而遗漏。
      const nextSettlementAt = hasLegacyOrders
        ? now
        : calculateNextSettlementTime(worker, now);
      return db
        .prepare(
          "UPDATE workers SET joined_at = ?, next_settlement_at = ? WHERE id = ? AND (joined_at <= 0 OR next_settlement_at IS NULL)",
        )
        .bind(joinedAt, nextSettlementAt, row.id);
    }),
  );
}

async function readClubData(): Promise<ClubData> {
  const db = getD1();
  const [workerResult, menuResult, folderResult, orderResult, settlementResult] = await Promise.all([
    db.prepare(`${WORKER_SELECT} ORDER BY sort_order, id`).all<WorkerRow>(),
    db.prepare("SELECT id, service_name, folder_id, sort_order, order_type, base_price_cents, hourly_rate_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu ORDER BY sort_order, id").all<MenuRow>(),
    db.prepare("SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY parent_id, sort_order, created_at, id").all<FolderRow>(),
    db.prepare(`${ORDER_SELECT} ORDER BY created_at DESC`).all<OrderRow>(),
    db.prepare(`${SETTLEMENT_RECORD_SELECT} ORDER BY period_end DESC, created_at DESC`).all<SettlementRecordRow>(),
  ]);

  const workers: Worker[] = workerResult.results.map(workerFromRow);
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
  const orders = orderResult.results.map(orderFromRow);
  const settlementRecords = settlementResult.results.map(settlementRecordFromRow);

  return { workers, menu, folders, orders, settlementRecords };
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
    settlement_time: normalizeSettlementTime(
      input.settlement_time ?? fallback.settlement_time,
    ),
    last_settled_at: fallback.last_settled_at,
    next_settlement_at: fallback.next_settlement_at,
  };
}

function settlementJsonPath(workerId: string) {
  return `$."${workerId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * 为一名打手生成一个独立工资批次。订单金额与原财务流水完全不改动；
 * 双人订单通过 settlement_ids_by_worker 分别记录两名打手的归批状态。
 */
async function generateSettlementForWorkerOnServer(
  workerId: string,
  now = Date.now(),
  force = false,
): Promise<SettlementRecord | null> {
  const db = getD1();
  const row = await db
    .prepare(`${WORKER_SELECT} WHERE id = ?`)
    .bind(workerId)
    .first<WorkerRow>();
  if (!row) throw new Error("未找到该打手");
  const worker = workerFromRow(row);
  const scheduledEnd = worker.settlement_config.next_settlement_at;
  if (!scheduledEnd) throw new Error("打手结算时间尚未初始化");
  if (!force && now < scheduledEnd) return null;

  const periodStart = worker.settlement_config.last_settled_at ?? worker.joined_at;
  const periodEnd = force && now < scheduledEnd ? now : scheduledEnd;
  if (periodEnd <= periodStart) {
    if (force) throw new Error("当前结算周期尚未开始");
    return null;
  }

  const orderResult = await db
    .prepare(
      `${ORDER_SELECT} WHERE status = 'completed' AND completed_at >= ? AND completed_at <= ? ORDER BY completed_at, id`,
    )
    .bind(new Date(periodStart).toISOString(), new Date(periodEnd).toISOString())
    .all<OrderRow>();
  const periodOrders = getOrdersInPeriod(
    orderResult.results.map(orderFromRow),
    workerId,
    periodStart,
    periodEnd,
  );
  const orderDetails: SettlementOrderSnapshot[] = periodOrders.map((order) => ({
    order_id: order.id,
    service_name: order.pricing_snapshot.service_name,
    completed_at: order.completed_at!,
    worker_amount: calculateWorkerEarningForOrder(order, workerId),
  }));
  const totalAmountCents = orderDetails.reduce(
    (sum, detail) => sum + toCents(detail.worker_amount),
    0,
  );
  if (!Number.isSafeInteger(totalAmountCents)) throw new Error("工资结算金额超出安全范围");

  const recordId = crypto.randomUUID();
  const nextSettlementAt = calculateNextSettlementTime({
    joined_at: worker.joined_at,
    settlement_config: {
      ...worker.settlement_config,
      last_settled_at: periodEnd,
      next_settlement_at: null,
    },
  });
  const createdAt = now;
  const orderIds = orderDetails.map((detail) => detail.order_id);
  const path = settlementJsonPath(workerId);
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO settlement_records (id, worker_id, worker_name_snapshot, worker_type_snapshot, period_start, period_end, order_ids_json, order_details_json, total_orders, total_amount_cents, status, paid_at, note, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ? WHERE EXISTS (SELECT 1 FROM workers WHERE id = ? AND next_settlement_at = ?)",
      )
      .bind(
        recordId,
        worker.id,
        worker.name,
        worker.workerType,
        periodStart,
        periodEnd,
        JSON.stringify(orderIds),
        JSON.stringify(orderDetails),
        orderIds.length,
        totalAmountCents,
        createdAt,
        worker.id,
        scheduledEnd,
      ),
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
  statements.push(
    db
      .prepare(
        "UPDATE workers SET last_settled_at = ?, next_settlement_at = ? WHERE id = ? AND next_settlement_at = ? AND EXISTS (SELECT 1 FROM settlement_records WHERE id = ?)",
      )
      .bind(periodEnd, nextSettlementAt, worker.id, scheduledEnd, recordId),
  );

  const results = await db.batch(statements);
  if (!results[0]?.meta.changes) {
    const existing = await db
      .prepare(`${SETTLEMENT_RECORD_SELECT} WHERE worker_id = ? AND period_end = ?`)
      .bind(worker.id, periodEnd)
      .first<SettlementRecordRow>();
    return existing ? settlementRecordFromRow(existing) : null;
  }

  return {
    id: recordId,
    worker_id: worker.id,
    worker_name_snapshot: worker.name,
    worker_type_snapshot: worker.workerType,
    period_start: periodStart,
    period_end: periodEnd,
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

async function checkAndGenerateSettlementsOnServer(now = Date.now()) {
  const db = getD1();
  const workersDue = await db
    .prepare(`${WORKER_SELECT} WHERE next_settlement_at IS NOT NULL AND next_settlement_at <= ?`)
    .bind(now)
    .all<WorkerRow>();
  let generated = 0;
  // 补齐应用离线期间错过的批次；上限防止异常配置造成无界循环。
  for (const row of workersDue.results) {
    for (let index = 0; index < 128; index += 1) {
      const current = await db
        .prepare(`${WORKER_SELECT} WHERE id = ?`)
        .bind(row.id)
        .first<WorkerRow>();
      if (!current?.next_settlement_at || current.next_settlement_at > now) break;
      const record = await generateSettlementForWorkerOnServer(row.id, now, false);
      if (!record) break;
      generated += 1;
    }
  }
  return generated;
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
    await ensureWorkerSettlementSchedules();
    return Response.json(await readClubData());
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSeeded();
    await ensureWorkerSettlementSchedules();
    const payload = (await request.json()) as Record<string, unknown>;
    const action = payload.action;
    const db = getD1();

    if (action === "add_worker") {
      const rawWorker = (payload.worker ?? {}) as Record<string, unknown>;
      const workerId = String(rawWorker.id ?? "").trim();
      const name = String(rawWorker.name ?? "").trim();
      const workerType = normalizeWorkerType(rawWorker.workerType);
      const tier = normalizeWorkerTier(rawWorker.tier, workerType);
      if (!workerId || workerId.length > 128) throw new Error("打手 ID 无效");
      if (!name) throw new Error("请输入打手姓名");
      if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");

      const joinedAt = Date.now();
      const settlementConfig = defaultSettlementConfig();
      const nextSettlementAt = calculateNextSettlementTime({
        joined_at: joinedAt,
        settlement_config: settlementConfig,
      });

      const result = await db
        .prepare("INSERT INTO workers (id, name, tier, worker_type, sort_order, status, total_completed_orders, joined_at, settlement_interval_days, settlement_time, last_settled_at, next_settlement_at) SELECT ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM workers), 0), 'idle', 0, ?, ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM workers WHERE name = ? COLLATE NOCASE)")
        .bind(
          workerId,
          name,
          tier ?? "",
          workerType,
          joinedAt,
          settlementConfig.interval_days,
          settlementConfig.settlement_time,
          nextSettlementAt,
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

    if (action === "check_and_generate_settlements") {
      const generatedSettlementCount = await checkAndGenerateSettlementsOnServer();
      return Response.json({
        ...(await readClubData()),
        generated_settlement_count: generatedSettlementCount,
      });
    }

    if (action === "generate_settlement_for_worker") {
      const workerId = String(payload.worker_id ?? "").trim();
      const record = await generateSettlementForWorkerOnServer(
        workerId,
        Date.now(),
        true,
      );
      return Response.json({
        ...(await readClubData()),
        created_settlement_id: record?.id,
      });
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
      const nextSettlementAt = calculateNextSettlementTime({
        joined_at: worker.joined_at,
        settlement_config: { ...config, next_settlement_at: null },
      });
      await db
        .prepare(
          "UPDATE workers SET settlement_interval_days = ?, settlement_time = ?, next_settlement_at = ? WHERE id = ?",
        )
        .bind(
          config.interval_days,
          config.settlement_time,
          nextSettlementAt,
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
      const existingType = normalizeWorkerType(existing.worker_type);
      const existingTier = normalizeWorkerTier(existing.tier, existingType);
      if (
        existing.status === "busy" &&
        (tier !== existingTier || workerType !== existingType)
      ) {
        return Response.json({ error: "该打手正在接单，只能修改姓名" }, { status: 409 });
      }

      const existingWorker = workerFromRow(existing);
      const config = Object.prototype.hasOwnProperty.call(data, "settlement_config")
        ? workerSettlementConfigFromInput(
            data.settlement_config,
            existingWorker.settlement_config,
          )
        : existingWorker.settlement_config;
      const nextSettlementAt = Object.prototype.hasOwnProperty.call(
        data,
        "settlement_config",
      )
        ? calculateNextSettlementTime({
            joined_at: existingWorker.joined_at,
            settlement_config: { ...config, next_settlement_at: null },
          })
        : existingWorker.settlement_config.next_settlement_at;

      const result = await db
        .prepare("UPDATE workers SET name = ?, tier = ?, worker_type = ?, settlement_interval_days = ?, settlement_time = ?, next_settlement_at = ? WHERE id = ? AND (status = 'idle' OR (tier = ? AND worker_type = ?))")
        .bind(
          name,
          tier ?? "",
          workerType,
          config.interval_days,
          config.settlement_time,
          nextSettlementAt,
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
      const statements = pendingRecords.results.map((recordRow) => {
        const record = settlementRecordFromRow(recordRow);
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
      // 待发放批次随订单回退；已发放批次保留生成时快照与金额，不做追溯扣减。
      statements.push(
        db.prepare("DELETE FROM orders WHERE id = ? AND status = 'completed'").bind(orderId),
        db.prepare("UPDATE workers SET total_completed_orders = (SELECT COUNT(*) FROM orders AS completed_order WHERE completed_order.status = 'completed' AND EXISTS (SELECT 1 FROM json_each(completed_order.assigned_worker_ids_json) AS assigned WHERE assigned.value = workers.id))"),
      );
      const results = await db.batch(statements);
      const deleteResult = results.at(-2);
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
      const relatedOrders = orderResult.results.filter((order) =>
        (JSON.parse(order.assigned_worker_ids_json) as string[]).includes(workerId),
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
        .map(settlementRecordFromRow)
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

    if (action === "cancel_and_reassign") {
      const orderId = String(payload.order_id ?? "");
      const oldWorkerId = String(payload.old_worker_id ?? "");
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
      const specialRequirements = parseStoredSpecialRequirements(
        row.special_requirements_json,
      );
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
      const oldWorker = workerResult.results.find((worker) => worker.id === oldWorkerId);
      if (!oldWorker || oldWorker.status !== "busy") {
        return Response.json({ error: "原打手当前不在接单" }, { status: 409 });
      }

      const assignmentRule = {
        commission_mode: snapshot.commission_mode,
        split_type: snapshot.split_type,
        eligible_tiers:
          snapshot.split_type === "tiered" && oldWeight.tier
            ? [oldWeight.tier]
            : (JSON.parse(menuRow.eligible_tiers_json) as WorkerTier[]),
      };
      const replacement = workerResult.results.map(workerFromRow).find((worker) => {
        if (
          worker.status !== "idle" ||
          assignedWorkerIds.includes(worker.id) ||
          !isWorkerEligibleForRule(assignmentRule, worker)
        ) {
          return false;
        }
        const candidateSnapshot: OrderPricingSnapshot = {
          ...snapshot,
          payout_weights: snapshot.payout_weights.map((entry) =>
            entry.workerId === oldWorkerId
              ? {
                  ...entry,
                  workerId: worker.id,
                  workerName: worker.name,
                  tier: worker.tier,
                }
              : entry,
          ),
        };
        try {
          calculateSettlement(
            candidateSnapshot,
            {},
            fromCents(amounts.orderOriginalTotalCents),
          );
          return true;
        } catch {
          return false;
        }
      });
      if (!replacement) {
        return Response.json(
          { error: "当前无空闲打手可替换，请稍后再试" },
          { status: 409 },
        );
      }

      const newOrderId = crypto.randomUUID();
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
                tier: replacement.tier,
              }
            : entry,
        ),
      };
      // 换人后仍沿用原订单冻结的价格与抽成规则，只根据新打手快照档位取档位抽成。
      calculateSettlement(
        newSnapshot,
        {},
        fromCents(amounts.orderOriginalTotalCents),
      );
      const createdAt = new Date().toISOString();
      const [insertResult, , , deleteResult] = await db.batch([
        db
          .prepare("INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, order_type, hours_half_units, hourly_rate_snapshot_cents, split_type, status, tip_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'active', 0, '[]', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'active') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'busy') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'idle')")
          .bind(
            newOrderId,
            row.menu_item_id,
            JSON.stringify(newAssignedWorkerIds),
            normalizeOrderType(row.order_type ?? newSnapshot.order_type),
            row.hours_half_units,
            row.hourly_rate_snapshot_cents,
            newSnapshot.split_type,
            JSON.stringify(specialRequirements),
            amounts.basePriceSnapshotCents,
            amounts.specialTotalCents,
            amounts.totalPriceCents,
            amounts.orderOriginalTotalCents,
            JSON.stringify(newSnapshot),
            createdAt,
            orderId,
            oldWorkerId,
            replacement.id,
          ),
        db.prepare("UPDATE workers SET status = 'busy' WHERE id = ? AND status = 'idle' AND EXISTS (SELECT 1 FROM orders WHERE id = ?)").bind(replacement.id, newOrderId),
        db.prepare("UPDATE workers SET status = 'idle' WHERE id = ? AND status = 'busy' AND EXISTS (SELECT 1 FROM orders WHERE id = ?)").bind(oldWorkerId, newOrderId),
        db.prepare("DELETE FROM orders WHERE id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM orders WHERE id = ?)").bind(orderId, newOrderId),
      ]);
      if (!insertResult.meta.changes || !deleteResult.meta.changes) {
        return Response.json(
          { error: "打手状态刚刚发生变化，请重新操作" },
          { status: 409 },
        );
      }
      return Response.json({
        ...(await readClubData()),
        new_order_id: newOrderId,
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
      const idleCheck = `SELECT COUNT(*) FROM workers WHERE id IN (${placeholders}) AND status = 'idle'`;
      const [insertResult] = await db.batch([
        db.prepare(`INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, order_type, hours_half_units, hourly_rate_snapshot_cents, split_type, status, tip_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, 'active', 0, '[]', ?, ?, ?, ?, ?, ?, ? WHERE (${idleCheck}) = ? AND EXISTS (SELECT 1 FROM price_menu WHERE id = ?)`).bind(
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
          createdAt,
          ...workerIds,
          workerIds.length,
          menuItemId,
        ),
        db.prepare(`UPDATE workers SET status = 'busy' WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM orders WHERE id = ?)`).bind(...workerIds, orderId),
      ]);
      if (!insertResult.meta.changes) {
        return Response.json({ error: "打手状态刚刚发生变化，请重新选择" }, { status: 409 });
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
       * 4. 每名打手最终收入 = 自己的基础实得 + tips_by_worker[workerId]；
       *    打赏 100% 归该打手，不参与抽成，双人订单不再自动平分新打赏。
       * 5. 样例：168 元 equal 单，1档 25%、2档 20%，两人各自基数为 84 元，
       *    基础实得 63 元和 67.2 元；若仅给 1档打手 10 元打赏，最终实得
       *    73 元和 67.2 元，俱乐部仍实得 37.8 元。
       */
      const settlement = calculateSettlement(
        snapshot,
        tipsByWorker,
        fromCents(amounts.orderOriginalTotalCents),
      );
      const workerIds = JSON.parse(row.assigned_worker_ids_json) as string[];
      const placeholders = workerIds.map(() => "?").join(", ");
      const completedAt = new Date().toISOString();
      const settlementToken = crypto.randomUUID();
      const [finishResult] = await db.batch([
        db.prepare("UPDATE orders SET status = 'completed', tip_cents = ?, tips_by_worker_json = ?, final_club_income_cents = ?, final_worker_incomes_json = ?, completed_at = ?, settlement_token = ? WHERE id = ? AND status = 'active'").bind(toCents(totalTip), JSON.stringify(tipsByWorker), toCents(settlement.club_income), JSON.stringify(settlement.worker_incomes), completedAt, settlementToken, orderId),
        db.prepare(`UPDATE workers SET status = 'idle', total_completed_orders = total_completed_orders + 1 WHERE id IN (${placeholders}) AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND settlement_token = ?)`).bind(...workerIds, orderId, settlementToken),
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
