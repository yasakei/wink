import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { supportsHudCaptureProtection } from "@/lib/hudCaptureProtection";
import { SettingsRow } from "../SettingsRow";
import { SettingsCategory, SettingsSections } from "../SettingsSections";
export const DashboardSettingsContext = createContext<ReactNode>(null);
export function DashboardSettings({ onImportFile }: { onImportFile: () => Promise<void> }) {
	const settingsContent = useContext(DashboardSettingsContext);
	const [directory, setDirectory] = useState("");
	const [recordings, setRecordings] = useState("");
	const [hideHud, setHideHud] = useState(true);
	const [captureSupported, setCaptureSupported] = useState(false);
	const [busy, setBusy] = useState(false);
	const [appVersion, setAppVersion] = useState("");
	const [hyprlandRulesAvailable, setHyprlandRulesAvailable] = useState(false);
	const [hyprlandRulesEnabled, setHyprlandRulesEnabled] = useState(false);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
		} catch (error) {
			toast.error(String(error));
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		let active = true;
		void Promise.all([
			window.electronAPI.getRecordingsDirectory(),
			window.electronAPI.getHudOverlayCaptureProtection(),
			window.electronAPI.getPlatform(),
			window.electronAPI.getAppVersion(),
			window.electronAPI.getHyprlandWindowRulesStatus(),
		])
			.then(([directory, protection, platform, version, hyprlandRules]) => {
				if (!active) return;
				if (directory.success) setRecordings(directory.path);
				if (protection.success) setHideHud(protection.enabled);
				setCaptureSupported(supportsHudCaptureProtection(platform));
				setAppVersion(version);
				setHyprlandRulesAvailable(hyprlandRules.available);
				setHyprlandRulesEnabled(hyprlandRules.enabled);
			})
			.catch((error) => toast.error(String(error)));
		return () => {
			active = false;
		};
	}, []);
	return (
		<section aria-label="Dashboard settings" className="dashboard-settings max-w-2xl py-10">
			<h1 className="mb-8 text-lg font-semibold">Settings</h1>
			<SettingsSections categories={["general", "motion", "recording", "files", "advanced"]}>
				<SettingsCategory category={["general", "motion", "advanced"]}>
					{settingsContent}
				</SettingsCategory>
				<SettingsCategory category="files">
					<SettingsRow title="Open video or project">
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() => void run(onImportFile)}
						>
							Open file
						</Button>
					</SettingsRow>
				</SettingsCategory>
				<SettingsCategory category="recording">
					<SettingsRow
						title="Recordings folder"
						description={
							<span className="block truncate" title={recordings}>
								{recordings}
							</span>
						}
					>
						<Button
							variant="secondary"
							size="sm"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result =
										await window.electronAPI.chooseRecordingsDirectory();
									if (result.canceled) return;
									if (!result.success || !result.path)
										throw Error("Could not change recordings folder");
									setRecordings(result.path);
								})
							}
						>
							Change folder
						</Button>
					</SettingsRow>
					{captureSupported && (
						<SettingsRow
							title="Hide HUD from recordings"
							description="Only while recording. The idle HUD stays visible in captures."
						>
							<Switch
								aria-label="Hide HUD from recordings"
								checked={hideHud}
								disabled={busy}
								onCheckedChange={(enabled) =>
									void run(async () => {
										const result =
											await window.electronAPI.setHudOverlayCaptureProtection(
												enabled,
											);
										if (!result.success)
											throw Error("Could not update capture protection");
										setHideHud(result.enabled);
									})
								}
							/>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="advanced">
					{hyprlandRulesAvailable && (
						<SettingsRow
							title="Hyprland menu styling"
							description="Remove Hyprland blur, borders, and shadows from Wink's floating menu."
						>
							<Switch
								aria-label="Hyprland menu styling"
								checked={hyprlandRulesEnabled}
								disabled={busy}
								onCheckedChange={(enabled) =>
									void run(async () => {
										const result =
											await window.electronAPI.setHyprlandWindowRulesEnabled(
												enabled,
											);
										if (!result.success)
											throw Error(
												result.error || "Could not update Hyprland styling",
											);
										setHyprlandRulesEnabled(result.enabled);
									})
								}
							/>
						</SettingsRow>
					)}
					<SettingsRow
						title="About Wink"
						description={
							<span className="block max-w-md text-xs leading-relaxed">
								{appVersion ? `Wink ${appVersion}` : "Wink"} is a downstream rebrand
								of Recordly, Copyright © 2026 webadderall. Recordly began as a fork
								of OpenScreen, Copyright © 2025 Siddharth Vaddem. Licensed under the
								GNU Affero General Public License v3.0.
							</span>
						}
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={() =>
								void window.electronAPI.openExternalUrl(
									"https://github.com/webadderallorg/Recordly",
								)
							}
						>
							Original project
						</Button>
					</SettingsRow>
					{import.meta.env.DEV && (
						<SettingsRow title="Preview update UI">
							<Button
								variant="secondary"
								size="sm"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await window.electronAPI.previewUpdateToast();
									})
								}
							>
								Preview
							</Button>
						</SettingsRow>
					)}
				</SettingsCategory>
				<SettingsCategory category="files">
					<SettingsRow
						title="Projects folder"
						description={directory || "Named projects save automatically."}
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={async () => {
								try {
									const result = await window.electronAPI.getProjectsDirectory();
									if (!result.success || !result.path)
										throw Error("Could not open projects folder");
									setDirectory(result.path);
									await window.electronAPI.revealInFolder(result.path);
								} catch (e) {
									toast.error(String(e));
								}
							}}
						>
							Show folder
						</Button>
					</SettingsRow>
					<p className="text-xs text-muted-foreground">
						Named projects save automatically. Previews refresh when you return to
						Projects.
					</p>
				</SettingsCategory>
			</SettingsSections>
		</section>
	);
}
