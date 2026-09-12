"use client";

import { useState, type ReactNode } from "react";
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
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortableBindings = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

interface SortableItemProps {
  id: string;
  data?: Record<string, unknown>;
  disabled?: boolean;
  className?: string;
  children: (bindings: SortableBindings, isDragging: boolean) => ReactNode;
}

export function SortableItem({
  id,
  data,
  disabled = false,
  className,
  children,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative h-full", isDragging && "z-20", className)}
    >
      <motion.div
        layout
        animate={{
          scale: isDragging ? 0.985 : 1,
          opacity: isDragging ? 0.28 : 1,
        }}
        transition={{ type: "spring", stiffness: 330, damping: 28 }}
        className={cn(
          "h-full rounded-[22px]",
          isDragging && "outline outline-1 outline-dashed outline-[#64D2FF]/65",
        )}
      >
        {children(
          {
            attributes,
            listeners,
            setActivatorNodeRef,
          },
          isDragging,
        )}
      </motion.div>
    </div>
  );
}

export function SortableHandle({
  bindings,
  label,
  disabled = false,
  className,
}: {
  bindings?: SortableBindings | null;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      ref={bindings?.setActivatorNodeRef}
      {...bindings?.attributes}
      {...bindings?.listeners}
      disabled={disabled || !bindings}
      aria-label={label}
      className={cn(
        "touch-none rounded-xl border border-white/[0.08] bg-white/[0.045] p-2 text-white/32 opacity-55 transition hover:bg-white/[0.09] hover:text-white/75 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/60 active:cursor-grabbing md:opacity-35 md:group-hover:opacity-100",
        className,
      )}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (ids: string[]) => void | Promise<void>;
  renderItem: (item: T, bindings: SortableBindings | null, isOverlay: boolean) => ReactNode;
  className?: string;
  disabled?: boolean;
  strategy?: SortingStrategy;
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  className,
  disabled = false,
  strategy = rectSortingStrategy,
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  const activeItem = activeId ? items.find((item) => getId(item) === activeId) : null;

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = ids.indexOf(String(event.active.id));
    const newIndex = ids.indexOf(String(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    void onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={strategy ?? verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item) => (
            <SortableItem key={getId(item)} id={getId(item)} disabled={disabled}>
              {(bindings) => renderItem(item, bindings, false)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 220, easing: "ease-out" }}>
        {activeItem ? (
          <motion.div
            initial={{ opacity: 0.7, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1.02 }}
            className="cursor-grabbing rounded-[22px] shadow-[0_28px_90px_rgba(0,0,0,.5)]"
          >
            {renderItem(activeItem, null, true)}
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
