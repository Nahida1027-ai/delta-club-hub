"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { motion } from "framer-motion";
import { FolderPlus, PencilLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FolderSection } from "@/components/folders/FolderSection";
import {
  SortableItem,
  type SortableBindings,
} from "@/components/dnd/SortableList";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Folder, PriceMenuItem } from "@/lib/club-types";
import { cn } from "@/lib/utils";
import { useClubStore } from "@/store/use-club-store";

const ROOT_KEY = "root";
const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

function menuSortableId(id: string) {
  return `menu:${id}`;
}

function folderSortableId(id: string) {
  return `folder:${id}`;
}

function folderKey(folderId: string | null) {
  return folderId ?? ROOT_KEY;
}

function targetFolderId(event: DragOverEvent | DragEndEvent): string | null | undefined {
  const data = event.over?.data.current;
  if (!data) return undefined;
  if (data.type === "container" || data.type === "menu" || data.type === "folder") {
    return typeof data.folderId === "string" ? data.folderId : null;
  }
  return undefined;
}

export function ServiceFolderBoard({
  menu,
  folders,
  renderItem,
  contentClassName,
  emptyLabel = "把服务拖到这里进行分类",
}: {
  menu: PriceMenuItem[];
  folders: Folder[];
  renderItem: (
    item: PriceMenuItem,
    bindings: SortableBindings | null,
    isOverlay: boolean,
  ) => ReactNode;
  contentClassName?: string;
  emptyLabel?: string;
}) {
  const isMutating = useClubStore((state) => state.is_mutating);
  const reorderMenuItems = useClubStore((state) => state.reorderMenuItems);
  const reorderFolders = useClubStore((state) => state.reorderFolders);
  const moveItemToFolder = useClubStore((state) => state.moveItemToFolder);
  const addFolder = useClubStore((state) => state.addFolder);
  const renameFolder = useClubStore((state) => state.renameFolder);
  const deleteFolder = useClubStore((state) => state.deleteFolder);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"menu" | "folder" | null>(null);
  const [highlightedFolder, setHighlightedFolder] = useState<string | null | undefined>();
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ [ROOT_KEY]: true });
  const [nameDialog, setNameDialog] = useState<{ mode: "add" | "rename"; folder?: Folder } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const orderedFolders = useMemo(
    () => [...folders].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt),
    [folders],
  );

  function itemsFor(folderId: string | null) {
    return menu
      .filter((item) => item.folderId === folderId)
      .sort((a, b) => a.order - b.order || a.service_name.localeCompare(b.service_name, "zh-CN"));
  }

  function toggleFolder(folderId: string | null) {
    const key = folderKey(folderId);
    setOpenFolders((current) => ({ ...current, [key]: !(current[key] ?? true) }));
  }

  function onDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    setActiveId(String(event.active.id));
    setActiveType(type === "folder" ? "folder" : "menu");
  }

  function onDragOver(event: DragOverEvent) {
    if (event.active.data.current?.type !== "menu") return;
    const nextFolder = targetFolderId(event);
    setHighlightedFolder(nextFolder);
    if (typeof nextFolder === "string") {
      setOpenFolders((current) => ({ ...current, [nextFolder]: true }));
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const type = event.active.data.current?.type;
    const destinationFolder = targetFolderId(event);
    setActiveId(null);
    setActiveType(null);
    setHighlightedFolder(undefined);
    if (!event.over) return;

    try {
      if (type === "folder") {
        if (typeof destinationFolder !== "string") return;
        const oldIndex = orderedFolders.findIndex((folder) => folder.id === event.active.data.current?.folderId);
        const newIndex = orderedFolders.findIndex((folder) => folder.id === destinationFolder);
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          await reorderFolders(arrayMove(orderedFolders.map((folder) => folder.id), oldIndex, newIndex));
        }
        return;
      }

      const itemId = String(event.active.data.current?.itemId ?? "");
      const item = menu.find((candidate) => candidate.id === itemId);
      if (!item || destinationFolder === undefined) return;
      if (item.folderId !== destinationFolder) {
        await moveItemToFolder(item.id, destinationFolder);
        toast.success(destinationFolder ? "服务已移入文件夹" : "服务已移至未分类");
        return;
      }

      if (event.over.data.current?.type !== "menu") return;
      const overItemId = String(event.over.data.current.itemId ?? "");
      const group = itemsFor(item.folderId);
      const oldIndex = group.findIndex((candidate) => candidate.id === item.id);
      const newIndex = group.findIndex((candidate) => candidate.id === overItemId);
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        await reorderMenuItems(arrayMove(group.map((candidate) => candidate.id), oldIndex, newIndex));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "排序保存失败");
    }
  }

  const activeItem = activeType === "menu"
    ? menu.find((item) => menuSortableId(item.id) === activeId)
    : null;
  const activeFolder = activeType === "folder"
    ? orderedFolders.find((folder) => folderSortableId(folder.id) === activeId)
    : null;

  function renderMenuGroup(folderId: string | null) {
    const items = itemsFor(folderId);
    return (
      <SortableContext items={items.map((item) => menuSortableId(item.id))} strategy={rectSortingStrategy}>
        <div className={cn("min-h-24 p-3 sm:p-4", contentClassName)}>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              id={menuSortableId(item.id)}
              data={{ type: "menu", itemId: item.id, folderId }}
              disabled={isMutating}
            >
              {(bindings) => renderItem(item, bindings, false)}
            </SortableItem>
          ))}
          {!items.length ? (
            <div className="grid min-h-20 place-items-center rounded-2xl border border-dashed border-white/10 px-4 text-center text-[13px] text-white/28">
              {emptyLabel}
            </div>
          ) : null}
        </div>
      </SortableContext>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-white/38">拖动六点手柄调整顺序，也可把服务拖到文件夹标题或“未分类”区域。</p>
        <Button
          type="button"
          variant="outline"
          disabled={isMutating}
          onClick={() => setNameDialog({ mode: "add" })}
          className="h-10 shrink-0 rounded-xl border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF] hover:bg-[#007AFF]/20 hover:text-white"
        >
          <Plus className="size-4" />新建文件夹
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={() => {
          setActiveId(null);
          setActiveType(null);
          setHighlightedFolder(undefined);
        }}
        onDragEnd={(event) => void onDragEnd(event)}
      >
        <div className="space-y-4">
          <FolderSection
            folder={null}
            count={itemsFor(null).length}
            open={openFolders[ROOT_KEY] ?? true}
            highlighted={highlightedFolder === null}
            disabled={isMutating}
            onToggle={() => toggleFolder(null)}
          >
            {renderMenuGroup(null)}
          </FolderSection>

          <SortableContext
            items={orderedFolders.map((folder) => folderSortableId(folder.id))}
            strategy={verticalListSortingStrategy}
          >
            {orderedFolders.map((folder) => (
              <SortableItem
                key={folder.id}
                id={folderSortableId(folder.id)}
                data={{ type: "folder", folderId: folder.id }}
                disabled={isMutating}
              >
                {(bindings) => (
                  <FolderSection
                    folder={folder}
                    count={itemsFor(folder.id).length}
                    open={openFolders[folder.id] ?? true}
                    highlighted={highlightedFolder === folder.id}
                    dragBindings={bindings}
                    disabled={isMutating}
                    onToggle={() => toggleFolder(folder.id)}
                    onRename={() => setNameDialog({ mode: "rename", folder })}
                    onDelete={() => setDeletingFolder(folder)}
                  >
                    {renderMenuGroup(folder.id)}
                  </FolderSection>
                )}
              </SortableItem>
            ))}
          </SortableContext>
        </div>

        <DragOverlay dropAnimation={{ duration: 220, easing: "ease-out" }}>
          {activeItem ? (
            <motion.div
              initial={{ opacity: 0.7, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1.02 }}
              className="cursor-grabbing rounded-[22px] shadow-[0_30px_100px_rgba(0,0,0,.58)]"
            >
              {renderItem(activeItem, null, true)}
            </motion.div>
          ) : activeFolder ? (
            <motion.div
              initial={{ opacity: 0.7, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1.02 }}
              className="flex min-w-72 items-center gap-3 rounded-2xl border border-[#64D2FF]/35 bg-[#1c1c1e]/95 px-4 py-3 text-white shadow-[0_30px_100px_rgba(0,0,0,.58)] backdrop-blur-xl"
            >
              <FolderPlus className="size-5 text-[#64D2FF]" />
              <span className="font-semibold">{activeFolder.name}</span>
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <FolderNameDialog
        key={nameDialog ? `${nameDialog.mode}:${nameDialog.folder?.id ?? "new"}` : "closed"}
        state={nameDialog}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setNameDialog(null)}
        onSave={async (name) => {
          if (nameDialog?.mode === "rename" && nameDialog.folder) {
            await renameFolder(nameDialog.folder.id, name);
            toast.success("文件夹已重命名");
          } else {
            await addFolder(name);
            toast.success("文件夹已创建");
          }
          setNameDialog(null);
        }}
      />

      <AlertDialog open={Boolean(deletingFolder)} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <AlertDialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl">
          <motion.div initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 27 }} className="grid gap-5 p-6">
            <AlertDialogHeader>
              <AlertDialogMedia className="mb-2 size-12 rounded-2xl bg-[#FF3B30]/12 text-[#FF6961]"><Trash2 className="size-5" /></AlertDialogMedia>
              <AlertDialogTitle>删除文件夹</AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-white/45">删除后，文件夹内的服务会全部移回“未分类”，服务和历史订单都不会被删除。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isMutating} className="h-11 rounded-xl border-white/10 bg-white/[0.045] text-white/65 hover:bg-white/10 hover:text-white">取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={isMutating}
                onClick={(event) => {
                  event.preventDefault();
                  if (!deletingFolder) return;
                  void deleteFolder(deletingFolder.id)
                    .then(() => {
                      toast.success("文件夹已删除，服务已移回未分类");
                      setDeletingFolder(null);
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : "删除文件夹失败"));
                }}
                className="h-11 rounded-xl bg-[#FF3B30] text-white hover:bg-[#ff5047]"
              >
                {isMutating ? "正在处理…" : "删除文件夹"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </motion.div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FolderNameDialog({
  state,
  isMutating,
  onOpenChange,
  onSave,
}: {
  state: { mode: "add" | "rename"; folder?: Folder } | null;
  isMutating: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(state?.folder?.name ?? "");
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请输入文件夹名称");
      return;
    }
    if (Array.from(trimmed).length > 20) {
      setError("文件夹名称最多 20 个字符");
      return;
    }
    try {
      await onSave(trimmed);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "保存失败";
      setError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !isMutating && onOpenChange(open)}>
      <DialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-md">
        <motion.div initial={{ opacity: 0, scale: 0.94, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 27 }} className="grid gap-5 p-6">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]">
              {state?.mode === "rename" ? <PencilLine className="size-5" /> : <FolderPlus className="size-5" />}
            </span>
            <DialogTitle>{state?.mode === "rename" ? "重命名文件夹" : "新建文件夹"}</DialogTitle>
            <DialogDescription className="text-white/45">名称会同步显示在接单台和价格表管理中。</DialogDescription>
          </DialogHeader>
          <label htmlFor="folder-name" className="space-y-2">
            <span className="flex items-center justify-between text-sm font-medium text-white/65"><span>文件夹名称</span><span className="text-[12px] font-normal text-white/30">{Array.from(name).length}/20</span></span>
            <Input id="folder-name" value={name} maxLength={20} autoFocus placeholder="例如：热门推荐" onChange={(event) => { setName(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} className={inputClass} aria-invalid={Boolean(error)} aria-describedby={error ? "folder-name-error" : undefined} />
            {error ? <p id="folder-name-error" role="alert" className="text-[13px] text-[#FF6961]">{error}</p> : null}
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isMutating} onClick={() => onOpenChange(false)} className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white">取消</Button>
            <Button type="button" disabled={isMutating || !name.trim()} onClick={() => void submit()} className="h-11 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white hover:brightness-110">{isMutating ? "正在保存…" : "确认保存"}</Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
