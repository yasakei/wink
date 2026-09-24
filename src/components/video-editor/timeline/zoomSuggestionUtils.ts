import type { CursorTelemetryPoint, ZoomFocus } from "../types";

export const MIN_DWELL_DURATION_MS = 450;
export const MAX_DWELL_DURATION_MS = 2600;
export const DWELL_MOVE_THRESHOLD = 0.02;
export const MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO = 1.2;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

export interface CursorInteractionCandidate extends ZoomDwellCandidate {
	kind:
		| "dwell"
		| "click-like"
		| "double-click-like"
		| "text-focus-like"
		| "dropdown-open"
		| "text-selection"
		| "text-field-click";
	source: "explicit" | "heuristic";
}

export interface SuggestedZoomRegion {
	start: number;
	end: number;
	focus: ZoomFocus;
}

export type InteractionZoomSuggestionStatus =
	| "ok"
	| "no-telemetry"
	| "no-interactions"
	| "no-slots";

export interface InteractionZoomSuggestionResult {
	status: InteractionZoomSuggestionStatus;
	suggestions: SuggestedZoomRegion[];
}

export function shouldAutoApplyFreshRecordingZoomsForSource(
	sourceWidth?: number,
	sourceHeight?: number,
	platform?: string,
): boolean {
	// Window capture on Windows legitimately produces portrait and near-square
	// sources. Click telemetry is already normalized to that captured window, so
	// its aspect ratio is not a reason to suppress interaction-based zooms.
	if (platform === "win32") {
		return true;
	}

	if (
		!Number.isFinite(sourceWidth) ||
		!Number.isFinite(sourceHeight) ||
		(sourceWidth ?? 0) <= 0 ||
		(sourceHeight ?? 0) <= 0
	) {
		return true;
	}

	return (
		(sourceWidth as number) / (sourceHeight as number) >=
		MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO
	);
}

/** Max gap between consecutive clicks before they are split into separate zoom clusters. */
export const CLICK_CLUSTER_MERGE_GAP_MS = 2500;
/** Padding added before the first click and after the last click in a cluster. */
export const CLICK_CLUSTER_PAD_MS = 500;
const EXPLICIT_CLICK_TYPES = new Set<NonNullable<CursorTelemetryPoint["interactionType"]>>([
	"click",
	"double-click",
	"right-click",
	"middle-click",
]);

function isExplicitClickType(
	interactionType: CursorTelemetryPoint["interactionType"],
): interactionType is NonNullable<CursorTelemetryPoint["interactionType"]> {
	return typeof interactionType === "string" && EXPLICIT_CLICK_TYPES.has(interactionType);
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
		interactionType: sample.interactionType,
		cursorType: sample.cursorType,
	};
}

function applyCursorTypeInRange(
	samples: CursorTelemetryPoint[],
	startMs: number,
	endMs: number,
	cursorType: NonNullable<CursorTelemetryPoint["cursorType"]>,
) {
	for (const sample of samples) {
		if (sample.timeMs < startMs || sample.timeMs > endMs) continue;
		if (!sample.cursorType) {
			sample.cursorType = cursorType;
		}
	}
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	const normalized = [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));

	const interactions = detectInteractionCandidates(normalized);
	for (const candidate of interactions) {
		if (candidate.kind === "text-selection") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 140,
				candidate.centerTimeMs + 1200,
				"text",
			);
			continue;
		}

		if (candidate.kind === "text-field-click" || candidate.kind === "text-focus-like") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 100,
				candidate.centerTimeMs + 900,
				"text",
			);
			continue;
		}
	}

	for (let index = 0; index < normalized.length; index += 1) {
		const sample = normalized[index];
		if (sample.interactionType !== "click" && sample.interactionType !== "double-click") {
			continue;
		}

		let mouseUp: CursorTelemetryPoint | undefined;
		for (let nextIndex = index + 1; nextIndex < normalized.length; nextIndex += 1) {
			const candidate = normalized[nextIndex];
			if (candidate.timeMs <= sample.timeMs) continue;
			if (candidate.interactionType === "mouseup") {
				mouseUp = candidate;
				break;
			}
		}
		if (!mouseUp) continue;

		const dragDuration = mouseUp.timeMs - sample.timeMs;
		const dragDistance = Math.hypot(mouseUp.cx - sample.cx, mouseUp.cy - sample.cy);
		if (dragDuration >= 160 && dragDistance > 0.015) {
			const isTextDrag =
				Math.abs(mouseUp.cx - sample.cx) > Math.abs(mouseUp.cy - sample.cy) * 1.8;
			applyCursorTypeInRange(
				normalized,
				sample.timeMs,
				mouseUp.timeMs,
				isTextDrag ? "text" : "closed-hand",
			);
		}
	}

	return normalized;
}

export function detectZoomDwellCandidates(samples: CursorTelemetryPoint[]): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < MIN_DWELL_DURATION_MS || runDuration > MAX_DWELL_DURATION_MS) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const avgCx = runSamples.reduce((sum, sample) => sum + sample.cx, 0) / runSamples.length;
		const avgCy = runSamples.reduce((sum, sample) => sum + sample.cy, 0) / runSamples.length;

		dwellCandidates.push({
			centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2),
			focus: { cx: avgCx, cy: avgCy },
			strength: runDuration,
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);

		if (distance > DWELL_MOVE_THRESHOLD) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	return dwellCandidates;
}

export function detectInteractionCandidates(
	samples: CursorTelemetryPoint[],
): CursorInteractionCandidate[] {
	// --- Phase 1: Explicit interaction events (from uiohook telemetry) ---
	const explicitInteractionCandidates: CursorInteractionCandidate[] = [];

	for (let index = 0; index < samples.length; index += 1) {
		const clickSample = samples[index];
		if (!isExplicitClickType(clickSample.interactionType)) continue;
		const kind = classifyPostClickBehavior(samples, clickSample, index);

		const baseStrength =
			kind === "double-click-like"
				? 1500
				: kind === "dropdown-open"
					? 1200
					: kind === "text-selection"
						? 1300
						: kind === "text-field-click"
							? 1100
							: 900;

		explicitInteractionCandidates.push({
			centerTimeMs: Math.round(clickSample.timeMs),
			focus: { cx: clickSample.cx, cy: clickSample.cy },
			strength: baseStrength,
			kind,
			source: "explicit",
		});
	}

	// --- Phase 2: Dwell-based heuristic candidates ---
	const dwellCandidates = detectZoomDwellCandidates(samples).map<CursorInteractionCandidate>(
		(candidate) => {
			if (candidate.strength >= 1100) {
				return { ...candidate, kind: "text-focus-like", source: "heuristic" };
			}
			if (candidate.strength <= 800) {
				return { ...candidate, kind: "click-like", source: "heuristic" };
			}
			return { ...candidate, kind: "dwell", source: "heuristic" };
		},
	);

	// --- Phase 3: Synthetic double-click detection from dwell pairs ---
	const doubleClickCandidates: CursorInteractionCandidate[] = [];
	const sortedByTime = [...dwellCandidates].sort((a, b) => a.centerTimeMs - b.centerTimeMs);

	for (let index = 1; index < sortedByTime.length; index += 1) {
		const prev = sortedByTime[index - 1];
		const curr = sortedByTime[index];
		const timeGap = curr.centerTimeMs - prev.centerTimeMs;
		const spatialGap = Math.hypot(curr.focus.cx - prev.focus.cx, curr.focus.cy - prev.focus.cy);
		const bothShort = prev.strength <= 900 && curr.strength <= 900;

		if (bothShort && timeGap <= 450 && spatialGap <= 0.035) {
			doubleClickCandidates.push({
				centerTimeMs: Math.round((prev.centerTimeMs + curr.centerTimeMs) / 2),
				focus: {
					cx: (prev.focus.cx + curr.focus.cx) / 2,
					cy: (prev.focus.cy + curr.focus.cy) / 2,
				},
				strength: prev.strength + curr.strength + 500,
				kind: "double-click-like",
				source: "heuristic",
			});
		}
	}

	return [...explicitInteractionCandidates, ...dwellCandidates, ...doubleClickCandidates];
}

/**
 * Groups a sorted list of click timestamps into clusters where consecutive
 * clicks are no more than `mergeGapMs` apart. Returns an array of
 * `{ firstMs, lastMs, focus }` objects, one per cluster.  The focus is taken
 * from the click with the highest interaction strength, falling back to the
 * centroid of all clicks in the cluster.
 */
function buildClickClusters(
	clicks: CursorInteractionCandidate[],
	mergeGapMs: number,
): Array<{ firstMs: number; lastMs: number; focus: ZoomFocus }> {
	if (clicks.length === 0) {
		return [];
	}

	const sorted = [...clicks].sort((a, b) => a.centerTimeMs - b.centerTimeMs);
	const clusters: Array<{ firstMs: number; lastMs: number; focus: ZoomFocus }> = [];

	let clusterStart = sorted[0].centerTimeMs;
	let clusterEnd = sorted[0].centerTimeMs;
	let bestStrength = sorted[0].strength;
	let bestFocus = sorted[0].focus;
	let sumCx = sorted[0].focus.cx;
	let sumCy = sorted[0].focus.cy;
	let count = 1;

	for (let i = 1; i < sorted.length; i++) {
		const click = sorted[i];
		const gap = click.centerTimeMs - clusterEnd;

		if (gap <= mergeGapMs) {
			// Extend current cluster
			clusterEnd = Math.max(clusterEnd, click.centerTimeMs);
			if (click.strength > bestStrength) {
				bestStrength = click.strength;
				bestFocus = click.focus;
			}
			sumCx += click.focus.cx;
			sumCy += click.focus.cy;
			count += 1;
		} else {
			// Flush current cluster and start a new one
			clusters.push({
				firstMs: clusterStart,
				lastMs: clusterEnd,
				focus: bestFocus ?? { cx: sumCx / count, cy: sumCy / count },
			});
			clusterStart = click.centerTimeMs;
			clusterEnd = click.centerTimeMs;
			bestStrength = click.strength;
			bestFocus = click.focus;
			sumCx = click.focus.cx;
			sumCy = click.focus.cy;
			count = 1;
		}
	}

	// Flush last cluster
	clusters.push({
		firstMs: clusterStart,
		lastMs: clusterEnd,
		focus: bestFocus ?? { cx: sumCx / count, cy: sumCy / count },
	});

	return clusters;
}

export function buildInteractionZoomSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	defaultDurationMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	spacingMs?: number;
	mergeGapMs?: number;
	padMs?: number;
}): InteractionZoomSuggestionResult {
	const {
		cursorTelemetry,
		totalMs,
		reservedSpans = [],
		mergeGapMs = CLICK_CLUSTER_MERGE_GAP_MS,
		padMs = CLICK_CLUSTER_PAD_MS,
	} = params;

	if (totalMs <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length === 0) {
		return { status: "no-telemetry", suggestions: [] };
	}

	if (
		normalizedSamples.length === 1 &&
		!isExplicitClickType(normalizedSamples[0].interactionType)
	) {
		return { status: "no-telemetry", suggestions: [] };
	}

	const interactionCandidates = detectInteractionCandidates(normalizedSamples);
	const explicitCandidates = interactionCandidates.filter(
		(candidate) => candidate.source === "explicit",
	);
	const clickCandidates =
		explicitCandidates.length > 0
			? explicitCandidates
			: interactionCandidates.filter((candidate) => candidate.source === "heuristic");

	if (clickCandidates.length === 0) {
		return { status: "no-interactions", suggestions: [] };
	}

	// Group nearby clicks into clusters, then derive zoom windows from those clusters
	const clusters = buildClickClusters(clickCandidates, mergeGapMs);

	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const suggestions: SuggestedZoomRegion[] = [];

	for (const cluster of clusters) {
		const regionStart = Math.max(0, cluster.firstMs - padMs);
		const regionEnd = Math.min(totalMs, cluster.lastMs + padMs);

		if (regionEnd <= regionStart) {
			continue;
		}

		const hasOverlap = reserved.some(
			(span) => regionEnd > span.start && regionStart < span.end,
		);

		if (hasOverlap) {
			continue;
		}

		reserved.push({ start: regionStart, end: regionEnd });
		suggestions.push({
			start: regionStart,
			end: regionEnd,
			focus: cluster.focus,
		});
	}

	if (suggestions.length === 0) {
		return { status: "no-slots", suggestions: [] };
	}

	// Sort chronologically
	suggestions.sort((a, b) => a.start - b.start);

	return { status: "ok", suggestions };
}

/**
 * Analyzes cursor movement after a click to classify the interaction pattern.
 *
 * - **dropdown-open**: click followed by slow downward cursor movement (browsing items)
 * - **text-selection**: click followed by primarily horizontal drag movement
 * - **text-field-click**: click followed by cursor staying mostly still (dwell)
 * - **double-click-like**: explicit double-click interaction type
 * - **click-like**: generic click with no recognizable post-click pattern
 */
function classifyPostClickBehavior(
	samples: CursorTelemetryPoint[],
	clickSample: CursorTelemetryPoint,
	clickIndex: number,
): CursorInteractionCandidate["kind"] {
	if (clickSample.interactionType === "double-click") {
		return "double-click-like";
	}

	const clickTime = clickSample.timeMs;
	let mouseUpAfter: CursorTelemetryPoint | undefined;
	const moveSamples: CursorTelemetryPoint[] = [];
	for (let index = clickIndex + 1; index < samples.length; index += 1) {
		const sample = samples[index];
		const elapsed = sample.timeMs - clickTime;
		if (elapsed > 3000) break;
		if (!mouseUpAfter && sample.interactionType === "mouseup") {
			mouseUpAfter = sample;
		}
		if (
			elapsed > 100 &&
			elapsed <= 2000 &&
			(!sample.interactionType || sample.interactionType === "move")
		) {
			moveSamples.push(sample);
		}
	}

	if (mouseUpAfter) {
		const dragDx = Math.abs(mouseUpAfter.cx - clickSample.cx);
		const dragDy = Math.abs(mouseUpAfter.cy - clickSample.cy);
		const dragDuration = mouseUpAfter.timeMs - clickTime;
		if (dragDuration >= 200 && dragDx > 0.03 && dragDx > dragDy * 1.8) {
			return "text-selection";
		}
	}

	if (moveSamples.length < 3) {
		return "text-field-click";
	}

	let maxDist = 0;
	let totalAbsDy = 0;
	let totalAbsDx = 0;
	for (const sample of moveSamples) {
		const dist = Math.hypot(sample.cx - clickSample.cx, sample.cy - clickSample.cy);
		maxDist = Math.max(maxDist, dist);
		totalAbsDx += Math.abs(sample.cx - clickSample.cx);
		totalAbsDy += Math.abs(sample.cy - clickSample.cy);
	}

	if (maxDist < 0.02) {
		return "text-field-click";
	}

	const lastMoveSample = moveSamples[moveSamples.length - 1];
	const netDy = lastMoveSample.cy - clickSample.cy;
	if (netDy > 0.03 && totalAbsDy > totalAbsDx * 1.5) {
		return "dropdown-open";
	}
	if (totalAbsDx > 0.03 && totalAbsDx > totalAbsDy * 1.8) {
		return "text-selection";
	}

	return "click-like";
}
