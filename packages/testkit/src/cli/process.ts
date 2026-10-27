import { spawn } from "node:child_process";

export function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options: { cwd?: string } = {},
) {
  return new Promise<void>((resolve, reject) => {
    // Windows resolves "pnpm" only through its .cmd shim, which Node refuses to spawn without a shell.
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
      cwd: options.cwd,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}
