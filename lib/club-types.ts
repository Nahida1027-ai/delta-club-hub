export type WorkerTier = "1档" | "2档" | "3档";

export type WorkerStatus = "idle" | "busy";

export type WorkerType = "standard" | "entertainment";

export type SettlementStatus = "pending" | "paid";

export type SettlementPeriodStatus = "active" | "settled";

export interface WorkerSettlementConfig {
  /** 管理员期望的结算节奏，仅用于提醒和展示，不自动触发。 */
  interval_days: number;
  /** 待发放记录的超期提醒阈值，单位小时。 */
  reminder_hours: number;
}

export type SplitType = "single" | "equal" | "tiered";

export type CommissionMode = "uniform" | "by_tier";

export type OrderType = "escort" | "companion";

export interface Worker {
  id: string;
  name: string;
  /** 娱乐陪玩没有档位；普通打手必须保留 1档 / 2档 / 3档。 */
  tier: WorkerTier | null;
  /** 用于运营标识与派单边界；不直接改变既有财务公式。 */
  workerType: WorkerType;
  /** 打手看板的持久化排序权重。 */
  order: number;
  status: WorkerStatus;
  total_completed_orders: number;
  /** 首次工资周期的起点。 */
  joined_at: number;
  settlement_config: WorkerSettlementConfig;
  /** 首次接单时自动创建；没有接过单时为 null。 */
  active_period_id: string | null;
}

export interface Folder {
  id: string;
  name: string;
  /** null 表示根级文件夹；旧数据缺失时按 null 兼容。 */
  parentId: string | null;
  /** 同一父文件夹下的持久化排序权重。 */
  order: number;
  createdAt: number;
}

export interface TieredRatios {
  "1档": number;
  "2档": number;
}

export interface TierCommissionRates {
  "1档": number;
  "2档": number;
  "3档": number;
  "娱乐陪玩": number;
}

export interface SpecialRequirement {
  name: string;
  price: number;
}

export interface PriceMenuItem {
  id: string;
  service_name: string;
  /** null 表示位于“未分类”根目录。 */
  folderId: string | null;
  /** 当前文件夹内的持久化排序权重。 */
  order: number;
  /** 护航单使用固定价，陪玩单使用小时价。旧服务默认 escort。 */
  order_type: OrderType;
  base_price: number;
  /** 仅陪玩单生效，单位：元 / 小时。 */
  hourly_rate: number;
  commission_mode: CommissionMode;
  club_commission_rate: number;
  tier_commission_rates: TierCommissionRates;
  split_type: SplitType;
  tiered_ratios: TieredRatios | null;
  /** 服务允许接单的档位；tiered 固定为 1档 + 2档。 */
  eligible_tiers: WorkerTier[];
}

export interface PayoutWeight {
  workerId: string;
  workerName: string;
  workerType: WorkerType;
  /** 娱乐陪玩以 null 档位参与，并使用专属抽成率。 */
  tier: WorkerTier | null;
  weight: number;
}

/** 创建订单时固化，后续编辑价格表不会改变这张订单。 */
export interface OrderPricingSnapshot {
  service_name: string;
  order_type: OrderType;
  /** 陪玩单下单时冻结的小时价；护航单为 0。 */
  hourly_rate: number;
  /** 统一保存本单实际基础价；陪玩单为 hourly_rate × hours。 */
  base_price: number;
  commission_mode: CommissionMode;
  club_commission_rate: number;
  tier_commission_rates: TierCommissionRates;
  split_type: SplitType;
  tiered_ratios: TieredRatios | null;
  payout_weights: PayoutWeight[];
}

export interface WorkerIncome {
  workerId: string;
  amount: number;
}

export type TipsByWorker = Record<string, number>;

export interface Order {
  id: string;
  menu_item_id: string;
  assigned_worker_ids: string[];
  /** 历史订单缺失时按 escort 读取。 */
  order_type: OrderType;
  /** 仅陪玩单使用，支持 0.5 小时步进。 */
  hours: number | null;
  /** 陪玩单下单时冻结的小时价；护航单为 null。 */
  hourly_rate_snapshot: number | null;
  /** 下单时冻结的分配模式；旧单仍可从 pricing_snapshot 回填。 */
  split_type: SplitType;
  status: "active" | "completed";
  /** 总打赏金额；等于 tips_by_worker 所有金额之和，兼容旧订单展示。 */
  tip: number;
  /** 每名打手独立获得的打赏；旧订单可能为空对象。 */
  tips_by_worker: TipsByWorker;
  final_club_income: number | null;
  final_worker_incomes: WorkerIncome[];
  special_requirements: SpecialRequirement[];
  base_price_snapshot: number;
  special_total: number;
  total_price: number;
  order_original_total: number;
  created_at: string;
  completed_at: string | null;
  pricing_snapshot: OrderPricingSnapshot;
  /** 所有参与打手都已归入工资结算记录后才为 true。 */
  settled: boolean;
  /** 向后兼容的最近一次结算记录 ID。 */
  settlement_id: string | null;
  /** 双人订单按打手独立结算，避免一人到期后提前锁住另一人的工资。 */
  settlement_ids_by_worker: Record<string, string>;
  /** 向后兼容的最近一个结算周期 ID。 */
  settlement_period_id: string | null;
  /** 双人订单按打手分别关联各自的活跃结算周期。 */
  settlement_period_ids_by_worker: Record<string, string>;
}

export interface SettlementPeriod {
  id: string;
  worker_id: string;
  started_at: number;
  ended_at: number | null;
  status: SettlementPeriodStatus;
  settlement_record_id: string | null;
}

export interface SettlementOrderSnapshot {
  order_id: string;
  service_name: string;
  completed_at: string;
  worker_amount: number;
}

export interface SettlementRecord {
  id: string;
  /** 关联本次手动关闭的工资周期；旧记录使用兼容 ID。 */
  period_id: string;
  worker_id: string;
  worker_name_snapshot: string;
  worker_type_snapshot: WorkerType;
  period_start: number;
  period_end: number;
  order_ids: string[];
  /** 生成时冻结的明细；已发放后即使订单历史删除仍可审计。 */
  order_details: SettlementOrderSnapshot[];
  total_orders: number;
  total_amount: number;
  status: SettlementStatus;
  paid_at: number | null;
  note: string;
  created_at: number;
}

export interface ClubData {
  workers: Worker[];
  menu: PriceMenuItem[];
  folders: Folder[];
  orders: Order[];
  settlementPeriods: SettlementPeriod[];
  settlementRecords: SettlementRecord[];
}

export interface SettlementResult {
  total_pool: number;
  club_income: number;
  worker_pool: number;
  worker_incomes: WorkerIncome[];
}
