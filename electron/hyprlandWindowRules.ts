import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LUA_WINDOW_RULE =
	'hl.window_rule({ name = "wink-hyprland-integration-v1", match = { title = "^Wink$" }, no_blur = true, border_size = 0, rounding = 0, no_shadow = true })';
const CONF_WINDOW_RULES = [
	"windowrulev2 = noblur, title:^Wink$",
	"windowrulev2 = border_size 0, rounding 0, noshadow, title:^Wink$",
];

export type HyprlandRuleFileKind = "lua" | "conf";
export type HyprlandWindowRulesTarget = {
	path: string;
	kind: HyprlandRuleFileKind;
};

export type HyprlandWindowRulesStatus = {
	available: boolean;
	enabled: boolean;
	configPath: string | null;
};

export type HyprlandWindowRulesResult = HyprlandWindowRulesStatus & {
	success: boolean;
	error?: string;
};

function getManagedRules(kind: HyprlandRuleFileKind): string[] {
	return kind === "lua" ? [LUA_WINDOW_RULE] : CONF_WINDOW_RULES;
}

function splitLines(content: string): string[] {
	return content.split(/\r?\n/);
}

export function getHyprlandRuleFileKind(configPath: string): HyprlandRuleFileKind {
	return path.extname(configPath).toLowerCase() === ".conf" ? "conf" : "lua";
}

export function isHyprlandWindowRulesInstalled(
	content: string,
	kind: HyprlandRuleFileKind,
): boolean {
	const lines = new Set(splitLines(content).map((line) => line.trim()));
	return getManagedRules(kind).every((rule) => lines.has(rule));
}

export function removeHyprlandWindowRules(content: string, kind: HyprlandRuleFileKind): string {
	const managedRules = new Set(getManagedRules(kind));
	const filtered = splitLines(content).filter((line) => !managedRules.has(line.trim()));
	const result = filtered
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\n+$/, "");
	return result ? `${result}\n` : "";
}

export function upsertHyprlandWindowRules(content: string, kind: HyprlandRuleFileKind): string {
	const cleaned = removeHyprlandWindowRules(content, kind).trimEnd();
	const rules = getManagedRules(kind).join("\n");
	return cleaned ? `${cleaned}\n\n${rules}\n` : `${rules}\n`;
}

function isHyprlandSession(): boolean {
	return process.platform === "linux" && Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
}

function getHyprlandDirectory(): string {
	return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "hypr");
}

function getCandidatePaths(): string[] {
	const directory = getHyprlandDirectory();
	return [
		path.join(directory, "custom", "rules.lua"),
		path.join(directory, "hyprland.lua"),
		path.join(directory, "hyprland.conf"),
	].filter((candidate) => existsSync(candidate));
}

function getTarget(): HyprlandWindowRulesTarget | null {
	const directory = getHyprlandDirectory();
	const luaConfig = path.join(directory, "hyprland.lua");
	const confConfig = path.join(directory, "hyprland.conf");
	const customRules = path.join(directory, "custom", "rules.lua");

	if (existsSync(luaConfig)) {
		try {
			const mainConfig = readFileSync(luaConfig, "utf-8");
			if (existsSync(customRules) && /require\(["']custom\.rules["']\)/.test(mainConfig)) {
				return { path: customRules, kind: "lua" };
			}
			return { path: luaConfig, kind: "lua" };
		} catch {
			return { path: luaConfig, kind: "lua" };
		}
	}

	if (existsSync(confConfig)) {
		return { path: confConfig, kind: "conf" };
	}

	return null;
}

function readInstalledState(target: HyprlandWindowRulesTarget): boolean {
	try {
		return isHyprlandWindowRulesInstalled(readFileSync(target.path, "utf-8"), target.kind);
	} catch {
		return false;
	}
}

export function getHyprlandWindowRulesStatus(): HyprlandWindowRulesStatus {
	if (!isHyprlandSession()) {
		return { available: false, enabled: false, configPath: null };
	}

	const target = getTarget();
	if (!target) {
		return { available: false, enabled: false, configPath: null };
	}

	return {
		available: true,
		enabled: readInstalledState(target),
		configPath: target.path,
	};
}

async function reloadHyprland(): Promise<string | null> {
	try {
		await execFileAsync("hyprctl", ["reload"], { timeout: 5000 });
		return null;
	} catch (error) {
		return String(error);
	}
}

export async function setHyprlandWindowRulesEnabled(
	enabled: boolean,
): Promise<HyprlandWindowRulesResult> {
	const status = getHyprlandWindowRulesStatus();
	if (!status.available || !status.configPath) {
		return { ...status, success: false, error: "Hyprland configuration was not found" };
	}

	if (status.enabled === enabled) {
		return { ...status, success: true };
	}

	const target = getTarget();
	if (!target) {
		return { ...status, success: false, error: "Hyprland configuration was not found" };
	}

	let changed = false;
	for (const candidate of getCandidatePaths()) {
		try {
			const before = readFileSync(candidate, "utf-8");
			const kind = getHyprlandRuleFileKind(candidate);
			const after =
				candidate === target.path && enabled
					? upsertHyprlandWindowRules(before, kind)
					: removeHyprlandWindowRules(before, kind);
			if (after !== before) {
				writeFileSync(candidate, after, "utf-8");
				changed = true;
			}
		} catch (error) {
			return { ...status, success: false, error: String(error) };
		}
	}

	if (!changed) {
		return { ...getHyprlandWindowRulesStatus(), success: true };
	}

	const reloadError = await reloadHyprland();
	const updatedStatus = getHyprlandWindowRulesStatus();
	return {
		...updatedStatus,
		success: reloadError === null,
		...(reloadError ? { error: `Hyprland reload failed: ${reloadError}` } : {}),
	};
}
