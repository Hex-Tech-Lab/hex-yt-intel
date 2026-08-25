#!/bin/bash
cat << 'INNER_EOF' > web/lib/types/highlights.ts
export interface HighlightData {
  idx: number;
  start: number;
  end: number;
  label: string;
  takeawayIdx: number | null;
  verbatimExcerpt: string | null;
}
INNER_EOF
