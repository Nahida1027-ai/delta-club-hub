"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
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
import { SortableItem, type SortableBindings } from "@/components/dnd/SortableList";
import { FolderSection } from "@/components/folders/FolderSection";
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
import {
  buildFolderTree,
  isDescendant,
  type FolderTreeNode,
} from "@/lib/folder-tree";
import { cn } from "@/lib/utils";
import { useClubStore } from "@/store/use-club-store";

const ROOT_KEY = "root";
const EXPANSION_STORAGE_KEY = "delta-club-folder-expansion-v2";
const inputClass =
  "h-11 rounded-xl border-white/10 bg-white/[0.055] text-[15px] text-white shadow-none placeholder:text-white/30 focus-visible:border-[#007AFF]/60 focus-visible:ring-[#007AFF]/20";

type NameDialogState =
  | { mode: "add"; parentId: string | null; parentName?: string }
  | { mode: "rename"; folder: Folder };

function menuSortableId(id: string) {
  return `menu:${id}`;
}

function folderSortableId(id: string) {
  return `folder:${id}`;
}

function folderKey(folderId: string | null) {
  return folderId ?? ROOT_KEY;
}

function normalizedParent(folder: Pick<Folder, "parentId">) {
  return folder.parentId ?? null;
}

function folderIdFromData(data: Record<string, unknown> | undefined) {
  return typeof data?.folderId === "string" ? data.folderId : null;
}

/** 优先命中鼠标正下方的文件夹标题/空白投放区，再回退到最近中心。 */
const collisionDetection: CollisionDetection = (args) => {
  const directHits = pointerWithin(args);
  const containerHits = directHits.filter((hit) =>
    args.droppableContainers.find((container) => container.id === hit.id)?.data.current?.type === "container"
  );
  if (containerHits.length) return containerHits;
  return directHits.length ? directHits : closestCenter(args);
};

function MenuDropZone({
  folderId,
  items,
  disabled,
  contentClassName,
  emptyLabel,
  renderItem,
}: {
  folderId: string | null;
  items: PriceMenuItem[];
  disabled: boolean;
  contentClassName?: string;
  emptyLabel: string;
  renderItem: (
    item: PriceMenuItem,
    bindings: SortableBindings | null,
    isOverlay: boolean,
  ) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `items:${folderId ?? ROOT_KEY}`,
    data: { type: "container", folderId },
    disabled,
  });

  return (
    <SortableContext
      items={items.map((item) => menuSortableId(item.id))}
      strategy={rectSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 rounded-b-[24px] p-3 transition-colors sm:p-4",
          isOver && "bg-[#007AFF]/[0.045]",
          contentClassName,
        )}
      >
        {items.map((item) => (
          <SortableItem
            key={item.id}
            id={menuSortableId(item.id)}
            data={{ type: "menu", itemId: item.id, folderId }}
            disabled={disabled}
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
  const moveFolderToFolder = useClubStore((state) => state.moveFolderToFolder);
  const addFolder = useClubStore((state) => state.addFolder);
  const renameFolder = useClubStore((state) => state.renameFolder);
  const deleteFolder = useClubStore((state) => state.deleteFolder);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<"menu" | "folder" | null>(null);
  const [highlightedFolder, setHighlightedFolder] = useState<string | null | undefined>();
  const [invalidFolder, setInvalidFolder] = useState<string | null | undefined>();
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ [ROOT_KEY]: true });
  const expansionReadyRef = useRef(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const validFolderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  const itemsByFolder = useMemo(() => {
    const groups = new Map<string, PriceMenuItem[]>();
    menu.forEach((item) => {
      const rawFolderId = item.folderId ?? null;
      const safeFolderId = rawFolderId && validFolderIds.has(rawFolderId) ? rawFolderId : null;
      const key = folderKey(safeFolderId);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    groups.forEach((items) => {
      items.sort((a, b) => a.order - b.order || a.service_name.localeCompare(b.service_name, "zh-CN"));
    });
    return groups;
  }, [menu, validFolderIds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(EXPANSION_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const restored = Object.fromEntries(
              Object.entries(parsed).filter((entry): entry is [string, boolean] =>
                typeof entry[1] === "boolean"
              ),
            );
            setOpenFolders({ [ROOT_KEY]: true, ...restored });
          }
        }
      } catch {
        // 展开状态只是本机 UI 偏好；损坏时直接使用默认展开状态。
      }
      expansionReadyRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!expansionReadyRef.current) return;
    try {
      window.localStorage.setItem(EXPANSION_STORAGE_KEY, JSON.stringify(openFolders));
    } catch {
      // 隐私模式或存储配额不足不影响业务数据与拖拽。
    }
  }, [openFolders]);

  function itemsFor(folderId: string | null) {
    return itemsByFolder.get(folderKey(folderId)) ?? [];
  }

  function siblingsFor(parentId: string | null, source = folders) {
    return source
      .filter((folder) => normalizedParent(folder) === parentId)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  function toggleFolder(folderId: string | null) {
    const key = folderKey(folderId);
    setOpenFolders((current) => ({ ...current, [key]: !(current[key] ?? true) }));
  }

  function resetDragState() {
    setActiveId(null);
    setActiveType(null);
    setHighlightedFolder(undefined);
    setInvalidFolder(undefined);
  }

  function onDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    setActiveId(String(event.active.id));
    setActiveType(type === "folder" ? "folder" : "menu");
  }

  function onDragOver(event: DragOverEvent) {
    const activeData = event.active.data.current;
    const overData = event.over?.data.current;
    if (!activeData || !overData) {
      setHighlightedFolder(undefined);
      setInvalidFolder(undefined);
      return;
    }

    const overType = overData.type;
    let destination: string | null | undefined;
    if (activeData.type === "menu") {
      destination = overType === "folder"
        ? String(overData.folderId ?? "") || undefined
        : folderIdFromData(overData);
    } else if (activeData.type === "folder" && overType === "container") {
      destination = folderIdFromData(overData);
    }

    if (destination === undefined) {
      setHighlightedFolder(undefined);
      setInvalidFolder(undefined);
      return;
    }

    const sourceFolderId = String(activeData.folderId ?? "");
    const invalid = activeData.type === "folder" && (
      destination === sourceFolderId ||
      isDescendant(folders, sourceFolderId, destination)
    );
    setHighlightedFolder(invalid ? undefined : destination);
    setInvalidFolder(invalid ? destination : undefined);
    if (!invalid && typeof destination === "string") {
      setOpenFolders((current) => ({ ...current, [destination]: true }));
    }
  }

  async function reorderFolderBeside(
    folderId: string,
    overFolderId: string,
    targetParentId: string | null,
  ) {
    let latestFolders = useClubStore.getState().folders;
    const moving = latestFolders.find((folder) => folder.id === folderId);
    if (!moving) return;
    if (normalizedParent(moving) !== targetParentId) {
      await moveFolderToFolder(folderId, targetParentId);
      latestFolders = useClubStore.getState().folders;
    }
    const siblings = siblingsFor(targetParentId, latestFolders);
    const oldIndex = siblings.findIndex((folder) => folder.id === folderId);
    const newIndex = siblings.findIndex((folder) => folder.id === overFolderId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      await reorderFolders(
        targetParentId,
        arrayMove(siblings.map((folder) => folder.id), oldIndex, newIndex),
      );
    }
  }

  async function reorderMenuBeside(
    itemId: string,
    overItemId: string,
    targetFolderId: string | null,
  ) {
    let latestMenu = useClubStore.getState().menu;
    const moving = latestMenu.find((item) => item.id === itemId);
    if (!moving) return;
    if ((moving.folderId ?? null) !== targetFolderId) {
      await moveItemToFolder(itemId, targetFolderId);
      latestMenu = useClubStore.getState().menu;
    }
    const group = latestMenu
      .filter((item) => (item.folderId ?? null) === targetFolderId)
      .sort((a, b) => a.order - b.order || a.service_name.localeCompare(b.service_name, "zh-CN"));
    const oldIndex = group.findIndex((item) => item.id === itemId);
    const newIndex = group.findIndex((item) => item.id === overItemId);
    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      await reorderMenuItems(arrayMove(group.map((item) => item.id), oldIndex, newIndex));
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current;
    const overData = event.over?.data.current;
    resetDragState();
    if (!activeData || !overData) return;

    try {
      if (activeData.type === "folder") {
        const sourceId = String(activeData.folderId ?? "");
        if (!sourceId) return;

        if (overData.type === "container") {
          const targetParentId = folderIdFromData(overData);
          if (targetParentId === sourceId || isDescendant(folders, sourceId, targetParentId)) {
            toast.error("不能把文件夹移动到自身或其子文件夹中");
            return;
          }
          const source = folderById.get(sourceId);
          if (source && normalizedParent(source) !== targetParentId) {
            await moveFolderToFolder(sourceId, targetParentId);
            toast.success(targetParentId ? "文件夹已移入目标文件夹" : "文件夹已移回根目录");
          }
          return;
        }

        if (overData.type === "folder") {
          const overFolderId = String(overData.folderId ?? "");
          if (!overFolderId || overFolderId === sourceId) return;
          const targetParentId = typeof overData.parentId === "string" ? overData.parentId : null;
          if (targetParentId === sourceId || isDescendant(folders, sourceId, targetParentId)) {
            toast.error("不能把文件夹移动到自身或其子文件夹中");
            return;
          }
          await reorderFolderBeside(sourceId, overFolderId, targetParentId);
          return;
        }

        if (overData.type === "menu") {
          const targetParentId = folderIdFromData(overData);
          if (targetParentId === sourceId || isDescendant(folders, sourceId, targetParentId)) {
            toast.error("不能把文件夹移动到自身或其子文件夹中");
            return;
          }
          const source = folderById.get(sourceId);
          if (source && normalizedParent(source) !== targetParentId) {
            await moveFolderToFolder(sourceId, targetParentId);
          }
          return;
        }
        return;
      }

      const itemId = String(activeData.itemId ?? "");
      if (!itemId) return;
      if (overData.type === "menu") {
        const overItemId = String(overData.itemId ?? "");
        const targetFolderId = folderIdFromData(overData);
        if (overItemId && overItemId !== itemId) {
          await reorderMenuBeside(itemId, overItemId, targetFolderId);
        }
        return;
      }

      const destinationFolder = overData.type === "folder"
        ? String(overData.folderId ?? "") || null
        : folderIdFromData(overData);
      const item = menu.find((candidate) => candidate.id === itemId);
      if (item && (item.folderId ?? null) !== destinationFolder) {
        await moveItemToFolder(item.id, destinationFolder);
        toast.success(destinationFolder ? "服务已移入文件夹" : "服务已移至未分类");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "拖拽保存失败");
    }
  }

  const activeItem = activeType === "menu"
    ? menu.find((item) => menuSortableId(item.id) === activeId)
    : null;
  const activeFolder = activeType === "folder"
    ? folders.find((folder) => folderSortableId(folder.id) === activeId)
    : null;

  function renderFolderNode(node: FolderTreeNode) {
    const directItems = itemsFor(node.id);
    const childCount = node.children.length + directItems.length;
    return (
      <SortableItem
        key={node.id}
        id={folderSortableId(node.id)}
        data={{ type: "folder", folderId: node.id, parentId: node.parentId }}
        disabled={isMutating}
      >
        {(bindings) => (
          <FolderSection
            folder={node}
            count={childCount}
            open={openFolders[node.id] ?? true}
            highlighted={highlightedFolder === node.id}
            invalidDrop={invalidFolder === node.id}
            dragBindings={bindings}
            disabled={isMutating}
            onToggle={() => toggleFolder(node.id)}
            onAddChild={() => setNameDialog({
              mode: "add",
              parentId: node.id,
              parentName: node.name,
            })}
            onRename={() => setNameDialog({ mode: "rename", folder: node })}
            onDelete={() => setDeletingFolder(node)}
          >
            <div className="space-y-3 border-l border-[#007AFF]/18 py-3 pl-3 sm:pl-5">
              {node.children.length ? (
                <SortableContext
                  items={node.children.map((child) => folderSortableId(child.id))}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3 pr-3 sm:pr-4">
                    {node.children.map(renderFolderNode)}
                  </div>
                </SortableContext>
              ) : null}
              <MenuDropZone
                folderId={node.id}
                items={directItems}
                disabled={isMutating}
                contentClassName={contentClassName}
                emptyLabel={node.children.length ? "把服务拖到此文件夹" : emptyLabel}
                renderItem={renderItem}
              />
            </div>
          </FolderSection>
        )}
      </SortableItem>
    );
  }

  const rootItems = itemsFor(null);
  const rootCount = folderTree.length + rootItems.length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-white/38">
          拖动六点手柄调整同级顺序；拖到文件夹标题可嵌套，拖到“未分类”可移回根目录。
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={isMutating}
          onClick={() => setNameDialog({ mode: "add", parentId: null })}
          className="h-10 shrink-0 rounded-xl border-[#007AFF]/25 bg-[#007AFF]/10 text-[#64D2FF] hover:bg-[#007AFF]/20 hover:text-white"
        >
          <Plus className="size-4" />新建文件夹
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={resetDragState}
        onDragEnd={(event) => void onDragEnd(event)}
      >
        <FolderSection
          folder={null}
          count={rootCount}
          open={openFolders[ROOT_KEY] ?? true}
          highlighted={highlightedFolder === null}
          invalidDrop={invalidFolder === null}
          disabled={isMutating}
          onToggle={() => toggleFolder(null)}
        >
          <div className="space-y-3 p-3 sm:p-4">
            {folderTree.length ? (
              <SortableContext
                items={folderTree.map((folder) => folderSortableId(folder.id))}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {folderTree.map(renderFolderNode)}
                </div>
              </SortableContext>
            ) : null}
            <MenuDropZone
              folderId={null}
              items={rootItems}
              disabled={isMutating}
              contentClassName={contentClassName}
              emptyLabel={folderTree.length ? "把服务拖到未分类区域" : emptyLabel}
              renderItem={renderItem}
            />
          </div>
        </FolderSection>

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
        key={nameDialog
          ? nameDialog.mode === "rename"
            ? `rename:${nameDialog.folder.id}`
            : `add:${nameDialog.parentId ?? ROOT_KEY}`
          : "closed"}
        state={nameDialog}
        isMutating={isMutating}
        onOpenChange={(open) => !open && setNameDialog(null)}
        onSave={async (name) => {
          if (nameDialog?.mode === "rename") {
            await renameFolder(nameDialog.folder.id, name);
            toast.success("文件夹已重命名");
          } else if (nameDialog?.mode === "add") {
            const parentId = nameDialog.parentId;
            await addFolder(name, parentId);
            if (parentId) {
              setOpenFolders((current) => ({ ...current, [parentId]: true }));
            }
            toast.success(parentId ? "子文件夹已创建" : "文件夹已创建");
          }
          setNameDialog(null);
        }}
      />

      <AlertDialog
        open={Boolean(deletingFolder)}
        onOpenChange={(open) => !open && setDeletingFolder(null)}
      >
        <AlertDialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 27 }}
            className="grid gap-5 p-6"
          >
            <AlertDialogHeader>
              <AlertDialogMedia className="mb-2 size-12 rounded-2xl bg-[#FF3B30]/12 text-[#FF6961]">
                <Trash2 className="size-5" />
              </AlertDialogMedia>
              <AlertDialogTitle>删除文件夹</AlertDialogTitle>
              <AlertDialogDescription className="leading-6 text-white/45">
                删除当前文件夹后，它的全部子文件夹与子树中的服务都会安全移回根目录；服务、订单和收入不会被删除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={isMutating}
                className="h-11 rounded-xl border-white/10 bg-white/[0.045] text-white/65 hover:bg-white/10 hover:text-white"
              >
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isMutating}
                onClick={(event) => {
                  event.preventDefault();
                  if (!deletingFolder) return;
                  void deleteFolder(deletingFolder.id)
                    .then(() => {
                      toast.success("文件夹已删除，子内容已移回根目录");
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
  state: NameDialogState | null;
  isMutating: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(state?.mode === "rename" ? state.folder.name : "");
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

  const title = state?.mode === "rename" ? "重命名文件夹" : "新建文件夹";
  const description = state?.mode === "add" && state.parentName
    ? `将在“${state.parentName}”中创建子文件夹。`
    : "文件夹结构会同步显示在接单台和价格表管理中。";

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !isMutating && onOpenChange(open)}>
      <DialogContent className="overflow-hidden border-white/10 bg-[#171719]/95 p-0 text-white shadow-2xl backdrop-blur-xl sm:max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 27 }}
          className="grid gap-5 p-6"
        >
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-[#007AFF]/15 text-[#64D2FF]">
              {state?.mode === "rename" ? <PencilLine className="size-5" /> : <FolderPlus className="size-5" />}
            </span>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-white/45">{description}</DialogDescription>
          </DialogHeader>
          <label htmlFor="folder-name" className="space-y-2">
            <span className="flex items-center justify-between text-sm font-medium text-white/65">
              <span>文件夹名称</span>
              <span className="text-[12px] font-normal text-white/30">{Array.from(name).length}/20</span>
            </span>
            <Input
              id="folder-name"
              value={name}
              maxLength={20}
              autoFocus
              placeholder="例如：热门推荐"
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              className={inputClass}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "folder-name-error" : undefined}
            />
            {error ? (
              <p id="folder-name-error" role="alert" className="text-[13px] text-[#FF6961]">
                {error}
              </p>
            ) : null}
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isMutating}
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl text-white/60 hover:bg-white/[0.06] hover:text-white"
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={isMutating || !name.trim()}
              onClick={() => void submit()}
              className="h-11 rounded-xl bg-gradient-to-r from-[#007AFF] to-[#5AC8FA] text-white hover:brightness-110"
            >
              {isMutating ? "正在保存…" : "确认保存"}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
