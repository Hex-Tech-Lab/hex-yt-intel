const fs = require('fs');

let pub = fs.readFileSync('web/app/share/[token]/PublicHighlightsReel.tsx', 'utf8');
if (!pub.includes('calculateHighlightsCompression')) {
  pub = pub.replace(
    "'use client';\n",
    "'use client';\nimport { calculateHighlightsCompression } from '@/lib/hooks/useSegmentPlayback';\n"
  );
  pub = pub.replace(
    /\/\/ Sum each highlight's real clamped duration[\s\S]*?const compressionPct = videoDurationSeconds[\s\S]*?: null;/g,
    "const { totalHighlightsSeconds, compressionPct } = calculateHighlightsCompression(clampedSegments, segmentDurationSeconds, videoDurationSeconds);"
  );
  fs.writeFileSync('web/app/share/[token]/PublicHighlightsReel.tsx', pub);
}

let scrub = fs.readFileSync('web/components/dashboard/HighlightsScrubber.tsx', 'utf8');
if (!scrub.includes('calculateHighlightsCompression')) {
  scrub = scrub.replace(
    "'use client';\n",
    "'use client';\nimport { calculateHighlightsCompression } from '@/lib/hooks/useSegmentPlayback';\n"
  );
  scrub = scrub.replace(
    /\/\/ Sum each highlight's real clamped duration[\s\S]*?const compressionPct = videoDurationSeconds[\s\S]*?: null;/g,
    "const { totalHighlightsSeconds, compressionPct } = calculateHighlightsCompression(segments, segDurFallback, videoDurationSeconds);"
  );
  fs.writeFileSync('web/components/dashboard/HighlightsScrubber.tsx', scrub);
}

console.log('Duplication fixed properly');
