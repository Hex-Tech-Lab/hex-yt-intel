import { parseArgs } from "node:util";

const CODACY_API_TOKEN = process.env.CODACY_API_TOKEN;

if (!CODACY_API_TOKEN) {
  console.error(
    "Error: CODACY_API_TOKEN environment variable is missing.",
  );
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    pr: {
      type: "string",
    },
  },
});

const prNumber = values.pr;
if (!prNumber) {
  console.error("Error: --pr <PR_NUMBER> argument is required.");
  process.exit(1);
}

async function triggerReview() {
  const url = `https://api.codacy.com/api/v3/analysis/organizations/gh/Hex-Tech-Lab/repositories/hex-yt-intel/pull-requests/${prNumber}/analyses`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-token": CODACY_API_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(
        `Failed to trigger Codacy review for PR #${prNumber}. Status: ${res.status}`,
      );
      console.error(`Response: ${errorText}`);
      process.exit(1);
    }

    console.log(`Successfully triggered Codacy review for PR #${prNumber}.`);
    process.exit(0);
  } catch (err) {
    console.error("Network or fetch error:", err);
    process.exit(1);
  }
}

triggerReview();
