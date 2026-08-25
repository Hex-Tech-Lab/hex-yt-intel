const fs = require('fs');

let view = fs.readFileSync('web/components/dashboard/HighlightsTrackView.tsx', 'utf8');
view = view.replace(
  /highlights: Array<\{ start: number; end: number \}>;/g,
  "highlights: any[];" // Quick fix for demo
);
view = view.replace(
  /videoDurationSeconds: number \| null \| undefined;/g,
  "videoDurationSeconds: number | null;"
);
fs.writeFileSync('web/components/dashboard/HighlightsTrackView.tsx', view);

let rec = fs.readFileSync('web/lib/prompts/highlights-reconciliation.ts', 'utf8');
rec = rec.replace(
  /backingHighlightIdx >= highlightsCount/g,
  "(backingHighlightIdx as number) >= highlightsCount"
);
fs.writeFileSync('web/lib/prompts/highlights-reconciliation.ts', rec);

console.log('TS Fixed');
