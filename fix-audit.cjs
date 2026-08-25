const fs = require('fs');
let file = fs.readFileSync('docs/history/ADR_028_PHASE_2_AUDIT_REPORT.md', 'utf8');

file = file.replace(/Status: VERIFIED 100% UTILIZATION/, 'Status: VERIFIED MOCK UTILIZATION');
file = file.replace(/A dedicated integration test suite covering end-to-end integration/, 'A dedicated mock use-case test suite covering integration logic');
file = file.replace(/Final Execution Checkpoint SHA: ef49242d/, 'Final Execution Checkpoint SHA: b571af79');
file = file.replace(/file:\/\/\/home\/kellyb_dev\/projects\/hex-yt-intel\//g, '');

fs.writeFileSync('docs/history/ADR_028_PHASE_2_AUDIT_REPORT.md', file);
