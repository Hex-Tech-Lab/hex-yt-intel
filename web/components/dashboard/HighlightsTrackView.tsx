import { HighlightsTrack } from './HighlightsTrack';

export interface HighlightsTrackViewProps {
  highlights: Array<{ start: number; end: number }>;
  playingIdx: number | null;
  videoDurationSeconds: number | null | undefined;
  segmentDurationSeconds: number;
  onJumpTo: (idx: number) => void;
  headerControls?: React.ReactNode;
  footerControls?: React.ReactNode;
}

export function HighlightsTrackView({
  highlights,
  playingIdx,
  videoDurationSeconds,
  segmentDurationSeconds,
  onJumpTo,
  headerControls,
  footerControls,
}: HighlightsTrackViewProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {headerControls && <div className="flex items-center justify-between gap-2 w-full">{headerControls}</div>}
      <HighlightsTrack
        highlights={highlights}
        activeIndex={playingIdx}
        onSelect={onJumpTo}
        videoDurationSeconds={videoDurationSeconds}
        segmentDurationSeconds={segmentDurationSeconds}
      />
      {footerControls && <div className="flex items-center justify-between gap-2 w-full">{footerControls}</div>}
    </div>
  );
}
