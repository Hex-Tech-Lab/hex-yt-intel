import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN;
const productionUrl = process.env.PRODUCTION_URL;

if (!token || !productionUrl) {
  console.warn("Skipping QStash cron registration: Missing QSTASH_TOKEN or PRODUCTION_URL.");
  process.exit(0);
}

const client = new Client({ token });
const baseUrl = productionUrl.replace(/\/$/, "");

// All scheduled QStash jobs, registered idempotently by name.
const SCHEDULES: Array<{ name: string; cron: string; path: string }> = [
  { name: "daily-oracle-sequence-dedup", cron: "0 3 * * *", path: "/api/webhooks/oracle-sequence" }, // daily 3 AM (canonical node dedup)
  // Stuck-analysis reaper (ADR 007): settle rows orphaned in `processing`.
  { name: "stuck-analysis-reaper", cron: "*/15 * * * *", path: "/api/webhooks/reaper" }, // every 15 min
];

async function setupCron() {
  try {
    const existing = await client.schedules.list();
    for (const schedule of SCHEDULES) {
      if (existing.find((s) => s.name === schedule.name)) {
        console.log(`✅ Cron schedule '${schedule.name}' already exists.`);
        continue;
      }
      const destination = `${baseUrl}${schedule.path}`;
      await client.schedules.create({ name: schedule.name, cron: schedule.cron, destination });
      console.log(`🚀 Cron schedule '${schedule.name}' created → ${destination} (${schedule.cron}).`);
    }
  } catch (error) {
    console.error("❌ Failed to setup QStash cron schedule:", error);
    process.exit(1);
  }
}

setupCron();
