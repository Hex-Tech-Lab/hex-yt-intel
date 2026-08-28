"use client";

import { useState } from "react";
import { Tooltip } from "@astryxdesign/core";
import { useEffectiveViewMode } from "@/lib/hooks/useEffectiveViewMode";
import { PricingModal } from "@/components/billing/PricingModal";
import { Icon } from "@/components/templates/_shared/primitives";
import type { ConsoleViewMode } from "@/lib/stores/useConsoleViewStore";

export function ViewModeToggle() {
  const { effectiveViewMode: viewMode, setViewMode, canAccessPro, isLoading } = useEffectiveViewMode();
  const [pricingModalOpen, setPricingModalOpen] = useState(false);

  const handleToggle = (mode: ConsoleViewMode) => {
    if (mode === "pro" && !canAccessPro && !isLoading) {
      setPricingModalOpen(true);
      return;
    }
    setViewMode(mode);
  };

  return (
    <>
      <div className="flex bg-[var(--surface)] border border-[var(--line-strong)] rounded-lg p-0.5">
        <button
          onClick={() => handleToggle("simple")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            viewMode === "simple"
              ? "bg-[var(--surface-raised)] text-[var(--ink)] shadow-sm"
              : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--line-faint)]"
          }`}
          aria-pressed={viewMode === "simple"}
        >
          <Icon icon="solar:document-text-linear" size={14} />
          Simple
        </button>
        <button
          onClick={() => handleToggle("pro")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            viewMode === "pro"
              ? "bg-[var(--surface-raised)] text-[var(--ink)] shadow-sm"
              : "text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--line-faint)]"
          }`}
          aria-pressed={viewMode === "pro"}
          title={!canAccessPro && !isLoading ? "Pro view requires Founder, Pro, or Enterprise tier" : undefined}
        >
          <Icon icon="solar:graph-up-linear" size={14} />
          Pro
          {!canAccessPro && !isLoading ? (
            <Tooltip content="Pro view requires Founder, Pro, or Enterprise tier. Upgrade to unlock advanced console.">
              <span className="inline-flex ml-0.5">
                <Icon icon="solar:lock-password-linear" size={12} className="text-[var(--ink-muted)]" />
              </span>
            </Tooltip>
          ) : null}
        </button>
      </div>

      <PricingModal
        isOpen={pricingModalOpen}
        onClose={() => setPricingModalOpen(false)}
      />
    </>
  );
}
