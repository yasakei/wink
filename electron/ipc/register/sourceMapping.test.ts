import { describe, expect, it } from "vitest";

import {
	getLinuxWindowSystem,
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
} from "./sourceMapping";

describe("getLinuxWindowSystem", () => {
	it("honors an explicit X11 ozone override", () => {
		expect(
			getLinuxWindowSystem(
				{ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				["recordly", "--ozone-platform=x11"],
				"linux",
			),
		).toBe("x11");
	});

	it("detects a native Wayland session", () => {
		expect(
			getLinuxWindowSystem(
				{ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				[],
				"linux",
			),
		).toBe("wayland");
	});
});

describe("getScreenSourceIdForDisplay", () => {
	it("keeps the live Electron screen source when one is available", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: "screen:42:0",
				platform: "linux",
			}),
		).toBe("screen:42:0");
	});

	it("routes unmatched Linux Wayland screens through the portal sentinel", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe(LINUX_PORTAL_SCREEN_SOURCE_ID);
	});

	it("keeps unmatched Linux X11 screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe("screen:fallback:42");
	});

	it("keeps non-Linux unmatched screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: undefined,
				platform: "win32",
			}),
		).toBe("screen:fallback:42");
	});
});
