export type WorkerTier = "1档" | "2档" | "3档";

export type WorkerStatus = "idle" | "busy";

export type SplitType = "single" | "equal" | "tiered";

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

export interface PriceMenuItem {
  id: string;
  service_name: string;
  base_price: number;
  club_commission_rate: number;
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
  club_commission_rate: number;
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
  status: "active" | "completed";
  tip: number;
  final_club_income: number | null;
  final_worker_incomes: WorkerIncome[];
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

