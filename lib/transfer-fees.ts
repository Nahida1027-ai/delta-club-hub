import type {
  ReassignmentLog,
  TransferFeeRecord,
  WorkerEarningsByWorker,
} from "@/lib/club-types";
import { fromCents, toCents } from "@/lib/settlement";

function normalizeTimestamp(value: unknown, fallback: number): number {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) && timestamp >= 0 ? Math.trunc(timestamp) : fallback;
}

export function normalizeTransferFeeRecords(value: unknown): TransferFeeRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Partial<TransferFeeRecord>;
    const fee = fromCents(toCents(Number(raw.fee ?? 0)));
    const toWorkerId = String(raw.to_worker_id ?? "").trim();
    const fromWorkerId = String(raw.from_worker_id ?? "").trim();
    if (!toWorkerId || !fromWorkerId || fee < 0) return [];
    return [{
      id: String(raw.id ?? `transfer-fee-${index}`),
      fee,
      to_worker_id: toWorkerId,
      to_worker_name_snapshot: String(
        raw.to_worker_name_snapshot ?? toWorkerId,
      ),
      from_worker_id: fromWorkerId,
      from_worker_name_snapshot: String(
        raw.from_worker_name_snapshot ?? fromWorkerId,
      ),
      created_at: normalizeTimestamp(raw.created_at, 0),
    }];
  });
}

export function aggregateTransferFees(
  records: TransferFeeRecord[] | null | undefined,
): WorkerEarningsByWorker {
  const totals: WorkerEarningsByWorker = {};
  for (const record of records ?? []) {
    if (record.fee <= 0) continue;
    totals[record.to_worker_id] = fromCents(
      toCents(totals[record.to_worker_id] ?? 0) + toCents(record.fee),
    );
  }
  return totals;
}

/**
 * 旧版本把当前转单费存在单值/汇总字段里，但完整换人轨迹一直保存在日志中。
 * 因此优先用日志恢复每一笔记录；没有日志的更老数据才从汇总字段生成兜底记录。
 */
export function resolveTransferFeeRecords({
  orderId,
  storedRecords,
  legacyTotals,
  reassignmentHistory,
  fallbackCreatedAt,
}: {
  orderId: string;
  storedRecords: unknown;
  legacyTotals: WorkerEarningsByWorker;
  reassignmentHistory: ReassignmentLog[];
  fallbackCreatedAt: number;
}): TransferFeeRecord[] {
  const normalized = normalizeTransferFeeRecords(storedRecords);
  if (normalized.length) return normalized;

  if (reassignmentHistory.length) {
    return reassignmentHistory.map((entry, index) => ({
      id: `legacy-${orderId}-${index}-${entry.new_worker_id}`,
      fee: fromCents(toCents(entry.transfer_fee)),
      to_worker_id: entry.new_worker_id,
      to_worker_name_snapshot: entry.new_worker_name,
      from_worker_id: entry.old_worker_id,
      from_worker_name_snapshot: entry.old_worker_name,
      created_at: normalizeTimestamp(entry.changed_at, fallbackCreatedAt),
    }));
  }

  return Object.entries(legacyTotals).flatMap(([workerId, fee], index) =>
    fee > 0
      ? [{
          id: `legacy-${orderId}-${index}-${workerId}`,
          fee: fromCents(toCents(fee)),
          to_worker_id: workerId,
          to_worker_name_snapshot: workerId,
          from_worker_id: "legacy-unknown",
          from_worker_name_snapshot: "历史打手",
          created_at: fallbackCreatedAt,
        }]
      : [],
  );
}
