import { getD1 } from "@/db";
import type {
  ClubData,
  Order,
  OrderPricingSnapshot,
  PriceMenuItem,
  SplitType,
  TieredRatios,
  Worker,
  WorkerIncome,
  WorkerTier,
} from "@/lib/club-types";
import {
  buildPayoutWeights,
  calculateSettlement,
  fromCents,
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
  club_commission_bps: number;
  split_type: SplitType;
  tiered_ratios_json: string | null;
  eligible_tiers_json: string;
}

interface OrderRow {
  id: string;
  menu_item_id: string;
  assigned_worker_ids_json: string;
  status: "active" | "completed";
  tip_cents: number;
  final_club_income_cents: number | null;
  final_worker_incomes_json: string;
  pricing_snapshot_json: string;
  created_at: string;
  completed_at: string | null;
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
    club_commission_rate: commission,
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
  const now = new Date().toISOString();
  const allTiers = JSON.stringify(["1档", "2档", "3档"]);
  const tieredTiers = JSON.stringify(["1档", "2档"]);

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
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, club_commission_bps, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-single", "排位代练 · 单排", 20_000, 3_000, "single", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, club_commission_bps, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-equal", "护航双排", 36_000, 1_000, "equal", null, allTiers, now),
    db.prepare("INSERT OR IGNORE INTO price_menu (id, service_name, base_price_cents, club_commission_bps, split_type, tiered_ratios_json, eligible_tiers_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("menu-tiered", "巅峰冲刺 · 档位协作", 50_000, 2_000, "tiered", JSON.stringify({ "1档": 60, "2档": 40 }), tieredTiers, now),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_club_income_cents, final_worker_incomes_json, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)").bind("order-demo-single", "menu-single", JSON.stringify(["worker-hanxing"]), 0, 6_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 140 }]), JSON.stringify(snapshots.single), chinaMonthDate(2, 20), chinaMonthDate(2, 21)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_club_income_cents, final_worker_incomes_json, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)").bind("order-demo-equal", "menu-equal", JSON.stringify(["worker-muye", "worker-beichen"]), 4_000, 3_600, JSON.stringify([{ workerId: "worker-muye", amount: 182 }, { workerId: "worker-beichen", amount: 182 }]), JSON.stringify(snapshots.equal), chinaMonthDate(4, 19), chinaMonthDate(4, 22)),
    db.prepare("INSERT OR IGNORE INTO orders (id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_club_income_cents, final_worker_incomes_json, pricing_snapshot_json, created_at, completed_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)").bind("order-demo-tiered", "menu-tiered", JSON.stringify(["worker-hanxing", "worker-muye"]), 5_000, 10_000, JSON.stringify([{ workerId: "worker-hanxing", amount: 270 }, { workerId: "worker-muye", amount: 180 }]), JSON.stringify(snapshots.tiered), chinaMonthDate(7, 20), chinaMonthDate(7, 23)),
  ]);
}

async function readClubData(): Promise<ClubData> {
  const db = getD1();
  const [workerResult, menuResult, orderResult] = await Promise.all([
    db.prepare("SELECT id, name, tier, status, total_completed_orders FROM workers ORDER BY tier, name").all<WorkerRow>(),
    db.prepare("SELECT id, service_name, base_price_cents, club_commission_bps, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu ORDER BY id").all<MenuRow>(),
    db.prepare("SELECT id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_club_income_cents, final_worker_incomes_json, pricing_snapshot_json, created_at, completed_at FROM orders ORDER BY created_at DESC").all<OrderRow>(),
  ]);

  const workers: Worker[] = workerResult.results.map((row) => ({ ...row }));
  const menu: PriceMenuItem[] = menuResult.results.map((row) => ({
    id: row.id,
    service_name: row.service_name,
    base_price: fromCents(row.base_price_cents),
    club_commission_rate: row.club_commission_bps / 100,
    split_type: row.split_type,
    tiered_ratios: row.tiered_ratios_json ? JSON.parse(row.tiered_ratios_json) : null,
    eligible_tiers: JSON.parse(row.eligible_tiers_json),
  }));
  const orders: Order[] = orderResult.results.map((row) => ({
    id: row.id,
    menu_item_id: row.menu_item_id,
    assigned_worker_ids: JSON.parse(row.assigned_worker_ids_json),
    status: row.status,
    tip: fromCents(row.tip_cents),
    final_club_income:
      row.final_club_income_cents === null ? null : fromCents(row.final_club_income_cents),
    final_worker_incomes: JSON.parse(row.final_worker_incomes_json) as WorkerIncome[],
    pricing_snapshot: JSON.parse(row.pricing_snapshot_json),
    created_at: row.created_at,
    completed_at: row.completed_at,
  }));

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

    if (action === "update_menu") {
      const item = payload.item as PriceMenuItem;
      validateMenuRule(item);
      const result = await db
        .prepare("UPDATE price_menu SET service_name = ?, base_price_cents = ?, club_commission_bps = ?, split_type = ?, tiered_ratios_json = ?, eligible_tiers_json = ?, updated_at = ? WHERE id = ?")
        .bind(
          item.service_name.trim(),
          toCents(item.base_price),
          Math.round(item.club_commission_rate * 100),
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
      if (!workerIds.length || new Set(workerIds).size !== workerIds.length) {
        throw new Error("请选择不重复的打手");
      }

      const menuRow = await db
        .prepare("SELECT id, service_name, base_price_cents, club_commission_bps, split_type, tiered_ratios_json, eligible_tiers_json FROM price_menu WHERE id = ?")
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
      const snapshot: OrderPricingSnapshot = {
        service_name: menuRow.service_name,
        base_price: fromCents(menuRow.base_price_cents),
        club_commission_rate: menuRow.club_commission_bps / 100,
        split_type: menuRow.split_type,
        tiered_ratios: ratios,
        payout_weights: payoutWeights,
      };
      const orderId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const idleCheck = `SELECT COUNT(*) FROM workers WHERE id IN (${placeholders}) AND status = 'idle'`;
      const [insertResult] = await db.batch([
        db.prepare(`INSERT INTO orders (id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_worker_incomes_json, pricing_snapshot_json, created_at) SELECT ?, ?, ?, 'active', 0, '[]', ?, ? WHERE (${idleCheck}) = ?`).bind(orderId, menuItemId, JSON.stringify(workerIds), JSON.stringify(snapshot), createdAt, ...workerIds, workerIds.length),
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
        .prepare("SELECT id, menu_item_id, assigned_worker_ids_json, status, tip_cents, final_club_income_cents, final_worker_incomes_json, pricing_snapshot_json, created_at, completed_at FROM orders WHERE id = ?")
        .bind(orderId)
        .first<OrderRow>();
      if (!row || row.status !== "active") {
        return Response.json({ error: "订单已结束或不存在，未重复结算" }, { status: 409 });
      }

      const snapshot = JSON.parse(row.pricing_snapshot_json) as OrderPricingSnapshot;
      const settlement = calculateSettlement(snapshot, tip);
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

