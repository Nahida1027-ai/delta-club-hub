export type WorkerTier = "1档" | "2档" | "3档";

export type WorkerStatus = "idle" | "busy";

export type SplitType = "single" | "equal" | "tiered";

export type CommissionMode = "uniform" | "by_tier";

export interface Worker {
  id: string;
  name: string;
  tier: WorkerTier;
  status: WorkerStatus;
  total_completed_orders: number;
}

export interface TieredRatios {
  "1档": number;
  "2档": number;
}

export interface TierCommissionRates {
  "1档": number;
  "2档": number;
  "3档": number;
}

export interface SpecialRequirement {
  name: string;
  price: number;
}

export interface PriceMenuItem {
  id: string;
  service_name: string;
  base_price: number;
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
  tier: WorkerTier;
  weight: number;
}

/** 创建订单时固化，后续编辑价格表不会改变这张订单。 */
export interface OrderPricingSnapshot {
  service_name: string;
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

export interface Order {
  id: string;
  menu_item_id: string;
  assigned_worker_ids: string[];
  /** 下单时冻结的分配模式；旧单仍可从 pricing_snapshot 回填。 */
  split_type: SplitType;
  status: "active" | "completed";
  tip: number;
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
}

export interface ClubData {
  workers: Worker[];
  menu: PriceMenuItem[];
  orders: Order[];
}

export interface SettlementResult {
  total_pool: number;
  club_income: number;
  worker_pool: number;
  worker_incomes: WorkerIncome[];
}
