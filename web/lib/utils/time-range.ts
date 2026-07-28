export function computeTimeWindow(searchParams: URLSearchParams): { startTimeMs: number; endTimeMs: number } {
  const range = searchParams.get('range');
  const customStart = searchParams.get('startTime');
  const customEnd = searchParams.get('endTime');
  const now = Date.now();

  let startTimeMs = now - 3600000;
  let endTimeMs = now;

  if (range === '30m') {
    startTimeMs = now - 1800000;
  } else if (range === '1h') {
    startTimeMs = now - 3600000;
  } else if (range === 'today') {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    startTimeMs = today.getTime();
  } else if (customStart && customEnd) {
    const parsedStart = new Date(customStart).getTime();
    const parsedEnd = new Date(customEnd).getTime();
    if (!isNaN(parsedStart)) startTimeMs = parsedStart;
    if (!isNaN(parsedEnd)) endTimeMs = parsedEnd;
  }

  return { startTimeMs, endTimeMs };
}
