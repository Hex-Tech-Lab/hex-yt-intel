export interface DecodoTranscriptResult {
  success: boolean;
  transcript?: string;
  language?: string;
  length?: number;
  reason?: string;
}

export interface DecodoPort {
  fetchTranscript(videoId: string): Promise<DecodoTranscriptResult>;
}
