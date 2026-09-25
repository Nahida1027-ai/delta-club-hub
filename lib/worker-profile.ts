import type { WorkerGender } from "@/lib/club-types";

/** 旧打手没有性别字段时按 male 兼容；非法输入必须显式拒绝。 */
export function normalizeWorkerGender(value: unknown): WorkerGender {
  if (value === undefined || value === null || value === "" || value === "male") {
    return "male";
  }
  if (value === "female") return "female";
  throw new Error("请选择有效性别");
}
