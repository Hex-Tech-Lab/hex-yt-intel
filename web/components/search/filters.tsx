'use client';

import React, { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
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

  /**
   * Handle date range change
   */
  const handleDateChange = (type: 'from' | 'to', value: string) => {
    if (type === 'from') {
      onFilterChange({ dateFrom: value || undefined });
    } else {
      onFilterChange({ dateTo: value || undefined });
    }
  };

  /**
   * Handle channel selection toggle
   */
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

  /**
   * Handle engagement filter change
   */
  const handleEngagementChange = (level: 'low' | 'medium' | 'high' | undefined) => {
    onFilterChange({ minEngagement: level });
  };

  /**
   * Clear all filters
   */
  const handleClearAll = () => {
    setSelectedChannels(new Set());
    onClear();
  };

  return (
    <div className="space-y-3">
      {/* Filter Header - Collapsible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Filters</span>
          {hasActiveFilters && (
            <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
              {[
                filters.dateFrom || filters.dateTo ? 1 : 0,
                filters.channels?.length || 0,
                filters.minEngagement ? 1 : 0,
              ].reduce((a, b) => a + b, 0)}{' '}
              active
            </span>
          )}
        </div>
        <ChevronDown
          size={18}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Filter Panel - Collapsible Content */}
      {isOpen && (
        <div className="space-y-4 p-4 bg-white border border-gray-200 rounded-lg">
          {/* Date Range Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Date Range
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => handleDateChange('from', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="From"
              />
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => handleDateChange('to', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="To"
              />
            </div>
          </div>

          {/* Channel Filter */}
          {allChannels.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Channels
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {allChannels.map((channel) => (
                  <label
                    key={channel}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.has(channel)}
                      onChange={() => toggleChannel(channel)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{channel}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Engagement Level Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
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
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="engagement"
                    checked={filters.minEngagement === value}
                    onChange={() => handleEngagementChange(value)}
                    className="rounded-full border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={handleClearAll}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              <X size={16} />
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchFilters;
