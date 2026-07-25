'use client';

import React, { useState } from 'react';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@/components/templates/_shared/primitives';
import type { SearchFilters } from '@/hooks/useSearch';

interface FiltersProps {
  filters: SearchFilters;
  onFilterChange: (filters: Partial<SearchFilters>) => void;
  onClear: () => void;
  allChannels?: string[];
}

/**
 * SearchFilters Component
 *
 * Provides filter UI for search results:
 * - Date range filter
 * - Channel filter (multi-select)
 * - Engagement level filter
 * - Collapsible UI
 */
const SearchFilters: React.FC<FiltersProps> = ({
  filters,
  onFilterChange,
  onClear,
  allChannels = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    new Set(filters.channels || [])
  );

  // Track if any filters are active
  const hasActiveFilters =
    filters.dateFrom ||
    filters.dateTo ||
    (filters.channels && filters.channels.length > 0) ||
    filters.minEngagement;

  const handleDateChange = (type: 'from' | 'to', value: string) => {
    if (type === 'from') {
      onFilterChange({ dateFrom: value || undefined });
    } else {
      onFilterChange({ dateTo: value || undefined });
    }
  };

  const toggleChannel = (channel: string) => {
    const newChannels = new Set(selectedChannels);
    if (newChannels.has(channel)) {
      newChannels.delete(channel);
    } else {
      newChannels.add(channel);
    }
    setSelectedChannels(newChannels);
    onFilterChange({
      channels: newChannels.size > 0 ? Array.from(newChannels) : undefined,
    });
  };

  const handleEngagementChange = (level: 'low' | 'medium' | 'high' | undefined) => {
    onFilterChange({ minEngagement: level });
  };

  const handleClearAll = () => {
    setSelectedChannels(new Set());
    onClear();
  };

  return (
    <div className="space-y-3">
      <Collapsible
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        trigger={
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink">Filters</span>
            {hasActiveFilters && (
              <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent-ink border border-accent/20 rounded text-[10px] font-bold uppercase tracking-wider">
                {[
                  filters.dateFrom || filters.dateTo ? 1 : 0,
                  filters.channels?.length || 0,
                  filters.minEngagement ? 1 : 0,
                ].reduce((a, b) => a + b, 0)}{' '}
                active
              </span>
            )}
          </div>
        }
      >
        <div className="space-y-4 p-4 bg-surface border border-line rounded-lg hx-rise">
          {/* Date Range Filter */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Date Range
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => handleDateChange('from', e.target.value)}
                className="px-3 py-2 bg-void border border-line rounded-lg text-xs text-ink focus:outline-none focus:border-accent"
                placeholder="From"
              />
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => handleDateChange('to', e.target.value)}
                className="px-3 py-2 bg-void border border-line rounded-lg text-xs text-ink focus:outline-none focus:border-accent"
                placeholder="To"
              />
            </div>
          </div>

          {/* Channel Filter */}
          {allChannels.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Channels
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {allChannels.map((channel) => (
                  <label
                    key={channel}
                    className="flex items-center gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.has(channel)}
                      onChange={() => toggleChannel(channel)}
                      className="rounded border-line bg-void text-accent focus:ring-accent/20"
                    />
                    <span className="text-xs text-ink-secondary group-hover:text-ink transition-colors">{channel}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Engagement Level Filter */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Minimum Engagement
            </label>
            <div className="space-y-2">
              {[
                { value: undefined, label: 'All' },
                { value: 'low' as const, label: 'Low (0-100k views)' },
                { value: 'medium' as const, label: 'Medium (100k-1M views)' },
                { value: 'high' as const, label: 'High (1M+ views)' },
              ].map(({ value, label }) => (
                <label
                  key={value || 'all'}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <input
                    type="radio"
                    name="engagement"
                    checked={filters.minEngagement === value}
                    onChange={() => handleEngagementChange(value)}
                    className="rounded-full border-line bg-void text-accent focus:ring-accent/20"
                  />
                  <span className="text-xs text-ink-secondary group-hover:text-ink transition-colors">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <Button
              label="Clear Filters"
              variant="secondary"
              size="sm"
              width="100%"
              icon={<Icon icon="solar:refresh-linear" size={14} />}
              onClick={handleClearAll}
            />
          )}
        </div>
      </Collapsible>
    </div>
  );
};

export default SearchFilters;
