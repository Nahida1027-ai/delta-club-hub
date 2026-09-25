"use client";

import { motion } from "framer-motion";
import type { WorkerGender } from "@/lib/club-types";

const genderOptions: Array<{
  value: WorkerGender;
  label: string;
  symbol: string;
  activeClass: string;
}> = [
  {
    value: "male",
    label: "男",
    symbol: "♂",
    activeClass: "bg-[#007AFF] shadow-[0_8px_22px_rgba(0,122,255,.3)]",
  },
  {
    value: "female",
    label: "女",
    symbol: "♀",
    activeClass: "bg-[#FF2D55] shadow-[0_8px_22px_rgba(255,45,85,.28)]",
  },
];

export function GenderSegmentedControl({
  value,
  onChange,
  layoutId,
  disabled = false,
}: {
  value: WorkerGender;
  onChange: (value: WorkerGender) => void;
  layoutId: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="性别"
      className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.045] p-1 backdrop-blur-xl"
    >
      {genderOptions.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`relative isolate flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "text-white" : "text-white/42 hover:text-white/72"}`}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className={`absolute inset-0 -z-10 rounded-xl ${option.activeClass}`}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
              />
            ) : null}
            <span aria-hidden="true" className="text-base leading-none">{option.symbol}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WorkerGenderBadge({ gender }: { gender?: WorkerGender }) {
  const normalized = gender === "female" ? "female" : "male";
  const female = normalized === "female";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${female ? "border-[#FF2D55]/20 bg-[#FF2D55]/12 text-[#FF8AAA]" : "border-[#007AFF]/20 bg-[#007AFF]/12 text-[#8EC9FF]"}`}
      aria-label={`性别：${female ? "女" : "男"}`}
    >
      <span aria-hidden="true">{female ? "♀" : "♂"}</span>
      {female ? "女" : "男"}
    </span>
  );
}
