'use client';

export function BentoGridLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="h-8 bg-surface/50 rounded animate-pulse w-1/3" />
          <div className="h-4 bg-surface/30 rounded animate-pulse w-1/4 mt-2" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="md:col-span-2 h-64 bg-surface/50 border border-border/50 animate-pulse rounded-[2rem]" />
        ))}
      </div>
    </div>
  );
}
