import { getD1 } from "@/db";
import type {
  ClubData,
  CommissionMode,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SpecialRequirement,
  SplitType,
  TierCommissionRates,
  TieredRatios,
  Worker,
  WorkerIncome,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  calculateSettlement,
  defaultTierCommissionRates,
  fromCents,
  normalizeSpecialRequirements,
  specialRequirementsTotal,
  toCents,
  validateMenuRule,
} from "@/lib/settlement";

export const runtime = "edge";

interface WorkerRow {
  id: string;
  name: string;
  tier: WorkerTier;
  status: "idle" | "busy";
  total_completed_orders: number;
}

interface MenuRow {
  id: string;
  service_name: string;
  base_price_cents: number;
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
  split_type: SplitType;
  status: "active" | "completed";
  tip_cents: number;
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
}

function normalizeCommissionMode(value: unknown): CommissionMode {
  return value === "by_tier" ? "by_tier" : "uniform";
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
  return {
    ...(snapshot as OrderPricingSnapshot),
    commission_mode: normalizeCommissionMode(snapshot.commission_mode),
    club_commission_rate: normalizeCommissionRate(
      snapshot.club_commission_rate,
      "统一抽成",
    ),
    tier_commission_rates: normalizeTierCommissionRates(
      snapshot.tier_commission_rates,
    ),
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
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-hanxing", "寒星", "1档", 2),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-muye", "牧野", "2档", 2),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-lingfeng", "凌风", "1档", 0),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-beichen", "北辰", "2档", 1),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-shangui", "山鬼", "3档", 0),
    db.prepare("INSERT OR IGNORE INTO workers (id, name, tier, status, total_completed_orders) VALUES (?, ?, ?, 'idle', ?)").bind("worker-luoshen", "洛神", "3档", 0),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-single", "排位代练 · 单排", 20_000, "uniform", 3_000, emptyTierCommissions, "single", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-equal", "护航双排", 36_000, "uniform", 1_000, emptyTierCommissions, "equal", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-tiered", "巅峰冲刺 · 档位协作", 50_000, "uniform", 2_000, emptyTierCommissions, "tiered", JSON.stringify({ "1档": 60, "2档": 40 }), tieredTiers, now),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-single", "menu-single", JSON.stringify(["worker-hanxing"]), "single", 0, 6_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 140 }]), noSpecialRequirements, 20_000, 0, 20_000, 20_000, JSON.stringify(snapshots.single), chinaMonthDate(2, 20), chinaMonthDate(2, 21)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-equal", "menu-equal", JSON.stringify(["worker-muye", "worker-beichen"]), "equal", 4_000, 3_600, JSON.stringify([{ workerId: "worker-muye", amount: 182 }, { workerId: "worker-beichen", amount: 182 }]), noSpecialRequirements, 36_000, 0, 36_000, 36_000, JSON.stringify(snapshots.equal), chinaMonthDate(4, 19), chinaMonthDate(4, 22)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("order-demo-tiered", "menu-tiered", JSON.stringify(["worker-hanxing", "worker-muye"]), "tiered", 5_000, 10_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 270 }, { workerId: "worker-muye", amount: 180 }]), noSpecialRequirements, 50_000, 0, 50_000, 50_000, JSON.stringify(snapshots.tiered), chinaMonthDate(7, 20), chinaMonthDate(7, 23)),
  ]);
}

async function readClubData(): Promise<ClubData> {
  const db = getD1();
  const [workerResult, menuResult, orderResult] = await Promise.all([
    db.prepare("SELECT id, name, tier, status, total_completed_orders FROM workers ORDER BY tier, name").all<WorkerRow>(),
    db.prepare("SELECT id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu ORDER BY id").all<MenuRow>(),
    db.prepare("SELECT id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at FROM orders ORDER BY created_at DESC").all<OrderRow>(),
  ]);

  const workers: Worker[] = workerResult.results.map((row) => ({ ...row }));
  const menu: PriceMenuItem[] = menuResult.results.map((row) => ({
    id: row.id,
    service_name: row.service_name,
    base_price: fromCents(row.base_price_cents),
    commission_mode: normalizeCommissionMode(row.commission_mode),
    club_commission_rate: row.club_commission_bps / 100,
    tier_commission_rates: normalizeTierCommissionRates(row.tier_commission_rates_json),
    split_type: row.split_type,
    tiered_ratios: row.tiered_ratios_json ? JSON.parse(row.tiered_ratios_json) : null,
    eligible_tiers: JSON.parse(row.eligible_tiers_json),
  }));
  const orders: Order[] = orderResult.results.map((row) => {
    const pricingSnapshot = parsePricingSnapshot(row.pricing_snapshot_json);
    const amounts = orderAmountsFromRow(row, pricingSnapshot);
    return {
      id: row.id,
      menu_item_id: row.menu_item_id,
      assigned_worker_ids: JSON.parse(row.assigned_worker_ids_json),
      split_type: row.split_type ?? pricingSnapshot.split_type,
      status: row.status,
      tip: fromCents(row.tip_cents),
      final_club_income:
        row.final_club_income_cents === null ? null : fromCents(row.final_club_income_cents),
      final_worker_incomes: JSON.parse(row.final_worker_incomes_json) as WorkerIncome[],
      special_requirements: parseStoredSpecialRequirements(row.special_requirements_json),
      base_price_snapshot: fromCents(amounts.basePriceSnapshotCents),
      special_total: fromCents(amounts.specialTotalCents),
      total_price: fromCents(amounts.totalPriceCents),
      order_original_total: fromCents(amounts.orderOriginalTotalCents),
      pricing_snapshot: pricingSnapshot,
      created_at: row.created_at,
      completed_at: row.completed_at,
    };
  });

  return { workers, menu, orders };
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
      const tier = String(rawWorker.tier ?? "") as WorkerTier;
      if (!workerId || workerId.length > 128) throw new Error("打手 ID 无效");
      if (!name) throw new Error("请输入打手姓名");
      if (Array.from(name).length > 20) throw new Error("打手姓名最多 20 个字符");
      if (!["1档", "2档", "3档"].includes(tier)) throw new Error("请选择有效档位");

      const result = await db
        .prepare("INSERT INTO workers (id, name, tier, status, total_completed_orders) SELECT ?, ?, ?, 'idle', 0 WHERE NOT EXISTS (SELECT 1 FROM workers WHERE name = ? COLLATE NOCASE)")
        .bind(workerId, name, tier, name)
        .run();
      if (!result.meta.changes) {
        return Response.json(
          { error: "已存在同名打手，请使用其他姓名" },
          { status: 409 },
        );
      }
      const createdWorker: Worker = {
        id: workerId,
        name,
        tier,
        status: "idle",
        total_completed_orders: 0,
      };
      return Response.json({
        ...(await readClubData()),
        created_worker: createdWorker,
      });
    }

    if (action === "add_menu_item") {
      const rawItem = (payload.item ?? {}) as Record<string, unknown>;
      const itemId = String(rawItem.id ?? "").trim();
      const serviceName = String(rawItem.service_name ?? "").trim();
      const splitType = String(rawItem.split_type ?? "") as SplitType;
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
        base_price: fromCents(toCents(Number(rawItem.base_price))),
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
      if (toCents(item.base_price) <= 0) throw new Error("基础价格必须大于 0");
      if (
        item.split_type === "tiered" &&
        (!Number.isFinite(item.tiered_ratios?.["1档"]) ||
          !Number.isFinite(item.tiered_ratios?.["2档"]))
      ) {
        throw new Error("请填写有效的档位占比");
      }
      validateMenuRule(item);

      const result = await db
        .prepare("INSERT INTO price_menu (id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM price_menu WHERE service_name = ? COLLATE NOCASE)")
        .bind(
          item.id,
          item.service_name,
          toCents(item.base_price),
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
      const tier = String(data.tier ?? "") as WorkerTier;
      if (!name) throw new Error("请输入打手姓名");
      if (!["1档", "2档", "3档"].includes(tier)) throw new Error("请选择有效档位");

      const existing = await db
        .prepare("SELECT id, name, tier, status, total_completed_orders FROM workers WHERE id = ?")
        .bind(workerId)
        .first<WorkerRow>();
      if (!existing) throw new Error("未找到该打手");
      if (existing.status === "busy" && tier !== existing.tier) {
        return Response.json({ error: "该打手正在接单，只能修改姓名" }, { status: 409 });
      }

      const result = await db
        .prepare("UPDATE workers SET name = ?, tier = ? WHERE id = ? AND (status = 'idle' OR tier = ?)")
        .bind(name, tier, workerId, tier)
        .run();
      if (!result.meta.changes) {
        return Response.json({ error: "打手状态刚刚发生变化，请重试" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "delete_historical_order") {
      const orderId = String(payload.order_id ?? "");
      const row = await db
        .prepare("SELECT id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at FROM orders WHERE id = ?")
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "completed") {
        return Response.json({ error: "只允许删除已完成的历史订单" }, { status: 409 });
      }

      const [deleteResult] = await db.batch([
        db.prepare("DELETE FROM orders WHERE id = ? AND status = 'completed'").bind(orderId),
        db.prepare("UPDATE workers SET total_completed_orders = (SELECT COUNT(*) FROM orders AS completed_order WHERE completed_order.status = 'completed' AND EXISTS (SELECT 1 FROM json_each(completed_order.assigned_worker_ids_json) AS assigned WHERE assigned.value = workers.id))"),
      ]);
      if (!deleteResult.meta.changes) {
        return Response.json({ error: "订单状态刚刚发生变化，未执行删除" }, { status: 409 });
      }
      return Response.json(await readClubData());
    }

    if (action === "delete_worker") {
      const workerId = String(payload.worker_id ?? "");
      const worker = await db
        .prepare("SELECT id, name, tier, status, total_completed_orders FROM workers WHERE id = ?")
        .bind(workerId)
        .first<WorkerRow>();
      if (!worker) throw new Error("未找到该打手");
      if (worker.status === "busy") {
        return Response.json({ error: "该打手正在接单，无法删除" }, { status: 409 });
      }

      const orderResult = await db
        .prepare("SELECT id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at FROM orders")
        .all<OrderRow>();
      const relatedOrders = orderResult.results.filter((order) =>
        (JSON.parse(order.assigned_worker_ids_json) as string[]).includes(workerId),
      );
      if (relatedOrders.some((order) => order.status === "active")) {
        return Response.json({ error: "该打手正在接单，无法删除" }, { status: 409 });
      }

      const statements = [];
      if (relatedOrders.length) {
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
        .prepare("SELECT id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at FROM orders WHERE id = ?")
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
          .prepare("SELECT id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu WHERE id = ?")
          .bind(row.menu_item_id)
          .first<MenuRow>(),
        db
          .prepare("SELECT id, name, tier, status, total_completed_orders FROM workers ORDER BY tier, name")
          .all<WorkerRow>(),
      ]);
      if (!menuRow) throw new Error("服务项目不存在");
      const oldWorker = workerResult.results.find((worker) => worker.id === oldWorkerId);
      if (!oldWorker || oldWorker.status !== "busy") {
        return Response.json({ error: "原打手当前不在接单" }, { status: 409 });
      }

      const eligibleTiers = snapshot.split_type === "tiered"
        ? [oldWeight.tier]
        : (JSON.parse(menuRow.eligible_tiers_json) as WorkerTier[]);
      const replacement = workerResult.results.find((worker) => {
        if (
          worker.status !== "idle" ||
          assignedWorkerIds.includes(worker.id) ||
          !eligibleTiers.includes(worker.tier)
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
            0,
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
        0,
        fromCents(amounts.orderOriginalTotalCents),
      );
      const createdAt = new Date().toISOString();
      const [insertResult, , , deleteResult] = await db.batch([
        db
          .prepare("INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at) SELECT ?, ?, ?, ?, 'active', 0, '[]', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'active') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'busy') AND EXISTS (SELECT 1 FROM workers WHERE id = ? AND status = 'idle')")
          .bind(
            newOrderId,
            row.menu_item_id,
            JSON.stringify(newAssignedWorkerIds),
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
        base_price: fromCents(toCents(Number(rawItem.base_price))),
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
        .prepare("UPDATE price_menu SET service_name = ?, base_price_cents = ?, commission_mode = ?, club_commission_bps = ?, tier_commission_rates_json = ?, split_type = ?, tiered_ratios_json = ?, eligible_tiers_json = ?, updated_at = ? WHERE id = ?")
        .bind(
          item.service_name.trim(),
          toCents(item.base_price),
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
        .prepare("SELECT id, service_name, base_price_cents, commission_mode, club_commission_bps, tier_commission_rates_json, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu WHERE id = ?")
        .bind(menuItemId)
        .first<MenuRow>();
      if (!menuRow) throw new Error("服务项目不存在");

      const placeholders = workerIds.map(() => "?").join(", ");
      const workerRows = await db
        .prepare(`SELECT id, name, tier, status, total_completed_orders FROM workers WHERE id IN (${placeholders})`)
        .bind(...workerIds)
        .all<WorkerRow>();
      const workersById = new Map(workerRows.results.map((worker) => [worker.id, worker]));
      const selectedWorkers = workerIds.map((id) => workersById.get(id)).filter(Boolean) as Worker[];
      if (selectedWorkers.length !== workerIds.length) throw new Error("所选打手不存在");
      if (selectedWorkers.some((worker) => worker.status !== "idle")) {
        throw new Error("所选打手已被其他订单占用，请重新选择");
      }

      const eligibleTiers = JSON.parse(menuRow.eligible_tiers_json) as WorkerTier[];
      if (selectedWorkers.some((worker) => !eligibleTiers.includes(worker.tier))) {
        throw new Error("所选打手档位不符合该服务规则");
      }
      const ratios = menuRow.tiered_ratios_json
        ? (JSON.parse(menuRow.tiered_ratios_json) as TieredRatios)
        : null;
      const payoutWeights = buildPayoutWeights(menuRow.split_type, selectedWorkers, ratios);
      const basePriceSnapshotCents = menuRow.base_price_cents;
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
        base_price: fromCents(menuRow.base_price_cents),
        commission_mode: normalizeCommissionMode(menuRow.commission_mode),
        club_commission_rate: menuRow.club_commission_bps / 100,
        tier_commission_rates: normalizeTierCommissionRates(
          menuRow.tier_commission_rates_json,
        ),
        split_type: menuRow.split_type,
        tiered_ratios: ratios,
        payout_weights: payoutWeights,
      };
      // 服务端权威校验本次实际打手组合与冻结后的结算规则。
      calculateSettlement(snapshot, 0, totalPrice);
      const orderId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const idleCheck = `SELECT COUNT(*) FROM workers WHERE id IN (${placeholders}) AND status = 'idle'`;
      const [insertResult] = await db.batch([
        db.prepare(`INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at) SELECT ?, ?, ?, ?, 'active', 0, '[]', ?, ?, ?, ?, ?, ?, ? WHERE (${idleCheck}) = ? AND EXISTS (SELECT 1 FROM price_menu WHERE id = ?)`).bind(
          orderId,
          menuItemId,
          JSON.stringify(workerIds),
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
      const tip = Number(payload.tip ?? 0);
      toCents(tip);
      const row = await db
        .prepare("SELECT id, menu_item_id, assigned_worker_ids_json, split_type, status, tip_cents, final_club_income_cents, final_worker_incomes_json, special_requirements_json, base_price_snapshot_cents, special_total_cents, total_price_cents, order_original_total_cents, pricing_snapshot_json, created_at, completed_at FROM orders WHERE id = ?")
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "active") {
        return Response.json({ error: "订单已结束或不存在，未重复结算" }, { status: 409 });
      }

      const snapshot = parsePricingSnapshot(row.pricing_snapshot_json);
      const amounts = orderAmountsFromRow(row, snapshot);
      /*
       * finishOrder 权威公式（整数分）：
       * 1. 订单总价 = 基础价快照 + 特殊需求加价，两部分都参与抽成。
       * 2. single：打手实得 = 订单总价 × (1 - 该打手档位抽成率)。
       * 3. equal：每人先分订单总价的 1/2，再分别扣除自己档位对应的抽成；
       *    俱乐部实得 = 订单总价 - A 基础实得 - B 基础实得。
       * 4. 打赏不参与抽成：single 全给一人，equal 平分；旧 tiered 单按冻结权重分配。
       * 5. 样例：168 元 equal 单，1档 25%、2档 20%，两人各自基数为 84 元，
       *    实得 63 元和 67.2 元，俱乐部实得 37.8 元。
       */
      const settlement = calculateSettlement(
        snapshot,
        tip,
        fromCents(amounts.orderOriginalTotalCents),
      );
      const workerIds = JSON.parse(row.assigned_worker_ids_json) as string[];
      const placeholders = workerIds.map(() => "?").join(", ");
      const completedAt = new Date().toISOString();
      const settlementToken = crypto.randomUUID();
      const [finishResult] = await db.batch([
        db.prepare("UPDATE orders SET status = 'completed', tip_cents = ?, final_club_income_cents = ?, final_worker_incomes_json = ?, completed_at = ?, settlement_token = ? WHERE id = ? AND status = 'active'").bind(toCents(tip), toCents(settlement.club_income), JSON.stringify(settlement.worker_incomes), completedAt, settlementToken, orderId),
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
