"use client";

import { useDroppable } from "@dnd-kit/core";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Folder, FolderOpen, PencilLine, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Folder as ClubFolder } from "@/lib/club-types";
import { cn } from "@/lib/utils";
import { SortableHandle, type SortableBindings } from "@/components/dnd/SortableList";
import { Button } from "@/components/ui/button";

export function FolderSection({
  folder,
  count,
  open,
  highlighted,
  dragBindings,
  disabled,
  onToggle,
  onRename,
  onDelete,
  children,
}: {
  folder: ClubFolder | null;
  count: number;
  open: boolean;
  highlighted?: boolean;
  dragBindings?: SortableBindings | null;
  disabled?: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const folderId = folder?.id ?? null;
  const { setNodeRef, isOver } = useDroppable({
    id: `container:${folderId ?? "root"}`,
    data: { type: "container", folderId },
    disabled,
  });
  const isHighlighted = highlighted || isOver;

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "overflow-hidden rounded-[24px] border bg-[#151517]/62 shadow-[0_18px_52px_rgba(0,0,0,.18)] backdrop-blur-xl transition-colors",
        isHighlighted
          ? "border-[#64D2FF]/55 bg-[#007AFF]/[0.09] shadow-[0_20px_60px_rgba(0,122,255,.16)]"
          : "border-white/[0.08]",
      )}
    >
      <div className="group flex min-h-15 items-center gap-2 border-b border-white/[0.06] px-3 py-3 sm:px-4">
        {folder ? (
          <SortableHandle
            bindings={dragBindings}
            disabled={disabled}
            label={`拖动文件夹 ${folder.name}`}
            className="shrink-0"
          />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.045] text-white/28">
            <Folder className="size-4" />
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-[#007AFF]/55"
        >
          <span className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            folder ? "bg-[#007AFF]/12 text-[#64D2FF]" : "bg-white/[0.05] text-white/45",
          )}>
            {open ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-white">
              {folder?.name ?? "未分类"}
            </span>
            <span className="mt-0.5 block text-[12px] text-white/34">{count} 个服务</span>
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="ml-auto text-white/30">
            <ChevronDown className="size-4" />
          </motion.span>
        </button>
        {folder ? (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`重命名 ${folder.name}`}
              onClick={onRename}
              className="rounded-xl text-[#64D2FF]/70 hover:bg-[#007AFF]/12 hover:text-[#64D2FF]"
            >
              <PencilLine className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`删除 ${folder.name}`}
              onClick={onDelete}
              className="rounded-xl text-[#FF6961]/75 hover:bg-[#FF3B30]/12 hover:text-[#FF6961]"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
