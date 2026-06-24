### Before
The timeout fallback POST sent chunk-shaped `finalText` without `chunkIndex` or `totalChunks`, causing the persist route to select `UCISPayloadV2Schema` and reject the payload (`400 Invalid payload schema`).

### After
The timeout fallback POST now carries `chunkIndex` and `totalChunks` from the request (same as the success path), allowing the persist route to select the relaxed `ChunkPayloadSchema` when the payload is chunk-shaped.

### File changed
- `worker/src/routes/analysis.ts`

### Diff evidence
- **Line#**: 202-203 (inserted after original `validate12D` line)
- **Before**:
```
          }).catch(() => {});
```
- **After**:
```
            chunkIndex: req.chunkIndex,
            totalChunks: req.totalChunks,
          }).catch(() => {});
```
- **Snippet** (full timeout fallback call, lines 193-204):
```
          persistService.persist({
            analysisId: req.analysisId,
            videoId: req.videoId,
            finalText,
            modelUsed,
            status: 'failed',
            activeSecret: signingKey,
            appUrl: url,
            validate12D: (text: string) => engine.validate12D(text, req.dimensions?.length),
            chunkIndex: req.chunkIndex,
            totalChunks: req.totalChunks,
          }).catch(() => {});
```

### Verification
- **what was checked**: success path at L176-187 (unchanged), abort paths at L419-428 and L433-442 (unchanged), test `persist-schema-selection.test.ts`, worker build
- **what passed**: success path still has `chunkIndex: req.chunkIndex, totalChunks: req.totalChunks` (code-observed); abort paths still omit chunkIndex (code-observed); test 9/9 passed (test-proven); worker build `dist/worker.js 2.1mb Done in 4656ms` (runtime-proven)
- **what remains unknown**: whether the timeout fallback path is ever reached in production (no runtime trace)

### Risks / follow-ups
- None. The change is additive, adds fields that were already present in the success path, and does not affect abort paths or the route handler.

### Conclusion
The timeout fallback POST now carries `chunkIndex` and `totalChunks` from the request, matching the success path. The test-proven schema mismatch is resolved for this call site. No other changes were made. No closure language — the abort paths remain unfixed but are latent-safe because they pass `finalText: ''`.