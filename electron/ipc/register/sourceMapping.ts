export const LINUX_PORTAL_SCREEN_SOURCE_ID = "screen:linux-portal";

export function getLinuxWindowSystem(
	env: NodeJS.ProcessEnv = process.env,
	argv: readonly string[] = process.argv,
	platform: NodeJS.Platform | string = process.platform,
): "wayland" | "x11" | null {
	if (platform !== "linux") {
		return null;
	}

	const ozonePlatform = env.ELECTRON_OZONE_PLATFORM_HINT?.trim().toLowerCase();
	const ozoneSwitch = argv
		.map((argument) => argument.match(/^--ozone-platform=(.+)$/i)?.[1]?.toLowerCase())
		.find(Boolean);
	const forcedPlatform = ozoneSwitch ?? ozonePlatform;
	if (forcedPlatform === "x11") {
		return "x11";
	}
	if (forcedPlatform === "wayland") {
		return "wayland";
	}

	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	if (sessionType === "wayland" || env.WAYLAND_DISPLAY) {
		return "wayland";
	}
	if (sessionType === "x11" || env.DISPLAY) {
		return "x11";
	}
	return null;
}

export function isLikelyLinuxWaylandSession(env: NodeJS.ProcessEnv) {
	return getLinuxWindowSystem(env, [], process.platform) === "wayland";
}

export function getScreenSourceIdForDisplay({
	displayId,
	env = process.env,
	matchedSourceId,
	platform,
}: {
	displayId: string;
	env?: NodeJS.ProcessEnv;
	matchedSourceId?: string | null;
	platform: NodeJS.Platform | string;
}) {
	if (matchedSourceId) {
		return matchedSourceId;
	}

	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		return LINUX_PORTAL_SCREEN_SOURCE_ID;
	}

	return `screen:fallback:${displayId}`;
}
