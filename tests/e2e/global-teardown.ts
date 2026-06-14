import { spawnSync } from "child_process";
import { resolve } from "path";

const REPO_ROOT = resolve(__dirname, "../..");

export default async function globalTeardown(): Promise<void> {
  if (process.env.INTEGRATION_KEEP_STACK) {
    console.log("\n⏩ INTEGRATION_KEEP_STACK set — leaving stack running\n");
    return;
  }
  console.log("\n🧹 Stopping docker compose stack...");
  spawnSync("docker", ["compose", "down"], { cwd: REPO_ROOT, stdio: "inherit" });
}
