"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
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
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
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

/** Keep ordinary sortable boards inside their visual list without adding another package. */
export const restrictToParentElement: Modifier = ({
  containerNodeRect,
  draggingNodeRect,
  transform,
}) => {
  if (!containerNodeRect || !draggingNodeRect) return transform;

  return {
    ...transform,
    x: Math.min(
      Math.max(transform.x, containerNodeRect.left - draggingNodeRect.left),
      containerNodeRect.right - draggingNodeRect.right,
    ),
    y: Math.min(
      Math.max(transform.y, containerNodeRect.top - draggingNodeRect.top),
      containerNodeRect.bottom - draggingNodeRect.bottom,
    ),
  };
};

/** Folder rows are vertical; service-card grids deliberately keep both axes available. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

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
    active,
    activeIndex,
    attributes,
    index,
    isOver,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms ease",
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  const activeType = active?.data.current?.type;
  const itemType = data?.type;
  const showDropIndicator = Boolean(
    isOver &&
    active &&
    active.id !== id &&
    (!activeType || !itemType || activeType === itemType),
  );
  const placeIndicatorAfter = activeIndex >= 0 && index >= 0 && activeIndex < index;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative h-full min-h-[60px]",
        isDragging && "z-20",
        className,
      )}
    >
      {showDropIndicator ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-3 z-40 h-0.5 rounded-full bg-[#007AFF] shadow-[0_0_12px_rgba(0,122,255,.9)]",
            placeIndicatorAfter ? "-bottom-px" : "-top-px",
          )}
        />
      ) : null}
      <div
        className={cn(
          "h-full min-h-[60px] rounded-[22px]",
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
      </div>
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
        "min-h-10 min-w-10 touch-none cursor-grab rounded-xl border border-white/[0.08] bg-white/[0.045] p-2 text-white/32 opacity-55 transition hover:bg-white/[0.09] hover:text-white/75 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/60 active:cursor-grabbing md:opacity-35 md:group-hover:opacity-100",
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
      modifiers={[restrictToParentElement]}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={strategy}>
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
            initial={{ opacity: 0.72, scale: 0.98 }}
            animate={{ opacity: 0.9, scale: 1.03 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="cursor-grabbing rounded-[22px] shadow-[0_32px_105px_rgba(0,0,0,.62)]"
          >
            {renderItem(activeItem, null, true)}
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
