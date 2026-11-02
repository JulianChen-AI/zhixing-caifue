import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { projectRoot } from "./sites-env.mjs";

const args = process.argv.slice(2);
const hasEnvFile = args.some(arg => arg === "--env-file" || arg.startsWith("--env-file="));
// Wrangler resolves env files against dist/server, so always use absolute paths.
const extra = args.map((arg, index) => args[index - 1] === "--env-file"
  ? path.resolve(projectRoot, arg)
  : arg.startsWith("--env-file=") ? `--env-file=${path.resolve(projectRoot, arg.slice(11))}` : arg);
const localEnv = path.join(projectRoot, ".dev.vars");
const cli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const cliArgs = ["dev",
  "--config", path.join(projectRoot, "dist/server/wrangler.json"),
  "--local", "--persist-to", path.join(projectRoot, ".wrangler/state"),
  "--ip", "127.0.0.1", "--port", "5173", "--inspector-port", "0",
  ...(!hasEnvFile && existsSync(localEnv) ? ["--env-file", localEnv] : []), ...extra];
const child = spawn(process.execPath, [cli, ...cliArgs], { stdio: "inherit", cwd: projectRoot });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 0; });
