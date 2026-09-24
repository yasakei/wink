import { describe, expect, it } from "vitest";
import {
	getHyprlandRuleFileKind,
	isHyprlandWindowRulesInstalled,
	removeHyprlandWindowRules,
	upsertHyprlandWindowRules,
} from "./hyprlandWindowRules";

describe("Hyprland window rules", () => {
	it("adds and removes the managed Lua rule without changing other rules", () => {
		const original = "hl.config({ general = { gaps_in = 5 } })\n";
		const configured = upsertHyprlandWindowRules(original, "lua");

		expect(isHyprlandWindowRulesInstalled(configured, "lua")).toBe(true);
		expect(configured).toContain(original.trim());
		expect(removeHyprlandWindowRules(configured, "lua")).toBe(original);
	});

	it("keeps the managed rule idempotent", () => {
		const once = upsertHyprlandWindowRules("", "lua");
		const twice = upsertHyprlandWindowRules(once, "lua");

		expect(twice).toBe(once);
	});

	it("adds and removes the managed classic Hyprland rules", () => {
		const original = "windowrulev2 = float, class:^(kitty)$\n";
		const configured = upsertHyprlandWindowRules(original, "conf");

		expect(isHyprlandWindowRulesInstalled(configured, "conf")).toBe(true);
		expect(removeHyprlandWindowRules(configured, "conf")).toBe(original);
	});

	it("selects the rule format from the config extension", () => {
		expect(getHyprlandRuleFileKind("/tmp/hyprland.lua")).toBe("lua");
		expect(getHyprlandRuleFileKind("/tmp/hyprland.conf")).toBe("conf");
	});
});
