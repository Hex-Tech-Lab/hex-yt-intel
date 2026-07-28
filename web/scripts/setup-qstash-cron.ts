import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN;
const productionUrl = process.env.PRODUCTION_URL;

if (!token || !productionUrl) {
  console.warn("Skipping QStash cron registration: Missing QSTASH_TOKEN or PRODUCTION_URL.");
  process.exit(0);
}

const client = new Client({ token });
const baseUrl = productionUrl.replace(/\/$/, "");

// All scheduled QStash jobs, registered idempotently by scheduleId.
const SCHEDULES: Array<{ id: string; cron: string; path: string }> = [
  { id: "daily-oracle-sequence-dedup", cron: "0 3 * * *", path: "/api/webhooks/oracle-sequence" }, // daily 3 AM (canonical node dedup)
  { id: "stuck-analysis-reaper", cron: "*/15 * * * *", path: "/api/webhooks/reaper" }, // every 15 min
  { id: "monthly-wiki-builder", cron: "0 0 1 * *", path: "/api/webhooks/wiki-builder" }, // first of month
  { id: "transcript-purger", cron: "*/15 * * * *", path: "/api/webhooks/transcript-purge" }, // every 15 min purge expired 72h
  { id: "transcript-compliance-check", cron: "0 2 * * *", path: "/api/webhooks/compliance-check" }, // daily 2 AM compliance
  { id: "upstash-snapshot-poll", cron: "*/15 * * * *", path: "/api/webhooks/upstash-snapshot-poll" }, // every 15 min Redis/Vector telemetry trend
];

async function setupCron() {
  try {
    const existing = await client.schedules.list();
    for (const schedule of SCHEDULES) {
      // Match by scheduleId OR destination URL (legacy schedules created with `name` key)
      const alreadyExists = existing.some((s) =>
        s.scheduleId === schedule.id || s.destination === `${baseUrl}${schedule.path}`
      );
      if (alreadyExists) {
        console.log(`✅ Cron schedule '${schedule.id}' already exists.`);
        continue;
      }
      const destination = `${baseUrl}${schedule.path}`;
      await client.schedules.create({ scheduleId: schedule.id, cron: schedule.cron, destination });
      console.log(`🚀 Cron schedule '${schedule.id}' created → ${destination} (${schedule.cron}).`);
    }
  } catch (error) {
    console.error("❌ Failed to setup QStash cron schedule:", error);
    process.exit(1);
  }
}

setupCron();
