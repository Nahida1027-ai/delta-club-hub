"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Download, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useClubStore } from "@/store/use-club-store";
import { exportDataToExcel } from "@/utils/exportDataToExcel";

export function ExportDataButton() {
  const workers = useClubStore((state) => state.workers);
  const menu = useClubStore((state) => state.menu);
  const folders = useClubStore((state) => state.folders);
  const orders = useClubStore((state) => state.orders);
  const settlementPeriods = useClubStore((state) => state.settlementPeriods);
  const settlementRecords = useClubStore((state) => state.settlementRecords);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const largeExport = orders.length > 5_000;

  async function confirmExport() {
    setConfirmOpen(false);
    setIsExporting(true);
    if (largeExport) {
      toast.info("数据量较大，生成可能需要几秒", { duration: 3_500 });
    }
    try {
      const fileName = await exportDataToExcel({
        workers,
        menu,
        folders,
        orders,
        settlementPeriods,
        settlementRecords,
      });
      toast.success("导出成功", {
        description: fileName,
        duration: 3_000,
      });
    } catch (error) {
      toast.error("导出失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
        duration: 3_500,
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={isExporting}
        aria-label={isExporting ? "正在导出所有数据" : "导出所有数据"}
        onClick={() => setConfirmOpen(true)}
        className="h-10 shrink-0 rounded-xl border-[#007AFF]/25 bg-[#007AFF]/10 px-3 text-[#8EC9FF] shadow-[0_8px_24px_rgba(0,122,255,.12)] backdrop-blur-xl hover:bg-[#007AFF]/18 hover:text-white disabled:opacity-60 sm:px-3.5"
      >
        {isExporting ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            className="inline-flex"
          >
            <LoaderCircle className="size-4" />
          </motion.span>
        ) : (
          <Download className="size-4" />
        )}
        <span className="hidden sm:inline">{isExporting ? "导出中…" : "导出所有数据"}</span>
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !isExporting && setConfirmOpen(open)}>
        <AlertDialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="grid gap-4 p-6"
          >
            <AlertDialogHeader>
              <AlertDialogMedia className="mb-2 size-12 rounded-2xl bg-[#007AFF]/14 text-[#64D2FF]">
                <FileSpreadsheet className="size-5" />
              </AlertDialogMedia>
              <AlertDialogTitle className="text-xl">导出所有数据</AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-white/45">
                将导出俱乐部全部数据到 Excel 文件，包含打手、订单、结算、价格表和文件夹等，确定继续？
              </AlertDialogDescription>
            </AlertDialogHeader>
            {largeExport ? (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-[#FF9F0A]/20 bg-[#FF9F0A]/10 px-3 py-2.5 text-sm text-[#FFB340]"
              >
                当前共有 {orders.length.toLocaleString("zh-CN")} 条订单，生成可能需要几秒。
              </motion.div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 rounded-xl border-white/10 bg-white/[0.045] text-white/65 hover:bg-white/10 hover:text-white">
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void confirmExport();
                }}
                className="h-11 rounded-xl bg-[#007AFF] text-white shadow-[0_10px_28px_rgba(0,122,255,.25)] hover:bg-[#1685ff]"
              >
                <FileSpreadsheet className="size-4" />确认导出
              </AlertDialogAction>
            </AlertDialogFooter>
          </motion.div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
