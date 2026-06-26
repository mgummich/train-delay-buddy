import { spawnSync } from "child_process";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../..");
const BACKEND = "http://localhost:8080";
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 180_000;

export default async function globalSetup(): Promise<void> {
  console.log("\n🐳 Starting docker compose stack...");
  const result = spawnSync(
    "docker",
    ["compose", "up", "-d", "--wait", "--wait-timeout", "120"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`docker compose up failed with exit code ${result.status ?? "null"}`);
  }

  // Give the HAFAS sidecar time to warm up its first DB connection after the
  // Docker healthcheck passes (the sidecar's own HC only checks the process).
  await new Promise((r) => setTimeout(r, 5_000));

  // Poll /readyz until hafas is ok, then warm up the full station-search path
  // through the backend (first real HAFAS call is slow on cold sidecar).
  console.log("⏳ Waiting for HAFAS sidecar to become ready...");
  const deadline = Date.now() + MAX_WAIT_MS;
  let hafasOk = false;
  while (Date.now() < deadline) {
    try {
      if (!hafasOk) {
        const rdy = await fetch(`${BACKEND}/readyz`, { signal: AbortSignal.timeout(10_000) });
        const body = (await rdy.json()) as { checks?: { hafas?: string } };
        if (body.checks?.hafas === "ok") hafasOk = true;
      }
      if (hafasOk) {
        // Warm up each station query the tests need — sequential so we don't
        // overwhelm the sidecar's cold DB API session. Redis caches the results
        // so test assertions never trigger another cold HAFAS round-trip.
        const warmupQueries = ["Berlin", "München", "Frankfurt"];
        let allOk = true;
        for (const q of warmupQueries) {
          try {
            const r = await fetch(`${BACKEND}/v1/stations?q=${q}`, {
              signal: AbortSignal.timeout(30_000),
            });
            if (!r.ok) { allOk = false; break; }
          } catch {
            allOk = false;
            break;
          }
        }
        if (allOk) {
          console.log("✅ Stack ready — all checks green\n");
          return;
        }
      }
    } catch {
      // not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Stack did not become healthy within ${MAX_WAIT_MS / 1000}s`);
}
