import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN;
const productionUrl = process.env.PRODUCTION_URL;

if (!token || !productionUrl) {
  console.warn("Skipping QStash cron registration: Missing QSTASH_TOKEN or PRODUCTION_URL.");
  process.exit(0);
}

const client = new Client({ token });
const SCHEDULE_NAME = "daily-dream-sequence-dedup";
const CRON_SCHEDULE = "0 3 * * *"; // Daily at 3 AM

async function setupCron() {
  try {
    const schedules = await client.schedules.list();
    const existing = schedules.find((s) => s.name === SCHEDULE_NAME);

    if (existing) {
      console.log(`✅ Cron schedule '${SCHEDULE_NAME}' already exists (ID: ${existing.scheduleId}).`);
      return;
    }

    const destination = `${productionUrl.replace(/\/$/, '')}/api/webhooks/dream-sequence`;
    
    await client.schedules.create({
      name: SCHEDULE_NAME,
      cron: CRON_SCHEDULE,
      destination: destination,
    });
    
    console.log(`🚀 Cron schedule '${SCHEDULE_NAME}' created successfully pointing to ${destination}.`);
  } catch (error) {
    console.error("❌ Failed to setup QStash cron schedule:", error);
    process.exit(1);
  }
}

setupCron();
