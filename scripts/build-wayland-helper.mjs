import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "linux") {
	process.exit(0);
}

const projectRoot = process.cwd();
const libraryRoot = path.join(projectRoot, "libs", "wayland-capture");
const result = spawnSync("cargo", ["build", "--manifest-path", path.join(libraryRoot, "Cargo.toml")], {
	cwd: libraryRoot,
	env: { ...process.env, CARGO_BUILD_JOBS: "2" },
	stdio: "inherit",
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

const archTag = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
const sourcePath = path.join(libraryRoot, "target", "debug", "wayland-capture-cli");
const outputDirectory = path.join(projectRoot, "electron", "native", "bin", archTag);
const outputPath = path.join(outputDirectory, "wayland-capture-cli");
await mkdir(outputDirectory, { recursive: true });
await copyFile(sourcePath, outputPath);
await chmod(outputPath, 0o755);
console.log(`[build-wayland-helper] Built ${outputPath}`);
