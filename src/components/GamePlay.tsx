import React, { useState, useRef, useEffect } from "react";
import { GlobalGridOverlay } from "./GlobalGridOverlay";
import { Player, StartSpot } from "../types/types";
import { getStartGrid } from "../logic/startGrid";
import type { Section as CoreSection } from "../types/types";
import { GameCanvas } from "./GameCanvas";
import { getValidMovesForPlayer } from "../logic/getValidMovesForPlayer";
import type { Move } from "../logic/getValidMovesForPlayer";
import { GRID, TILE, isPointOnTrack } from "../logic/trackMaskGeometry";
import { AI_TUNING, filterPostCrashRestartMoves as filterRestartMoves, scorePostCrashRestartMove } from "../logic/aiShared";

// Track section types
type SectionType = "start" | "straight" | "curve90";
type DecorationType =
    | "grass"
    | "Tree_1" | "Tree_2" | "Tree_3" | "Tree_4" | "Tree_5"
    | "Tree_6" | "Tree_7" | "Tree_8" | "Tree_9" | "Tree_10";

type AnySectionType = SectionType | DecorationType;
type RaceLevel = "novice" | "pro" | "king";

interface Section {
    id: string;
    type: AnySectionType;   // <- was SectionType
    x: number;
    y: number;
    rotation: number;
}

interface GamePlayProps {
    size: number;
}

type CandidateMove = { x: number; y: number; dx: number; dy: number; crash?: boolean; safeX?: number; safeY?: number };
type BoardSize = 400 | 600 | 900 | 1200;
type Direction = "top" | "bottom" | "left" | "right";
type RaceDirection = 1 | -1;
type RaceValueSample = { value: number; progress: number; tangent: { x: number; y: number }; distance: number };
type AiPlanResult = {
    move: CandidateMove | null;
    score: number;
    complete: boolean;
    iterations: number;
    budgetHit: boolean;
};
type AiBeamNode = {
    player: Player;
    firstMove: CandidateMove | null;
    score: number;
    complete: boolean;
};
const AI_MOVE_DELAY_MS = 1500;
const AI_REJECT_SCORE = Number.NEGATIVE_INFINITY;

export const GamePlay: React.FC<GamePlayProps> = ({ size }) => {
    const [sections, setSections] = useState<Section[]>([]);
    const [boardSize, setBoardSize] = useState<BoardSize>(size as BoardSize);
    const [loadedTrackName, setLoadedTrackName] = useState<string>("");
    const [trackRecord, setTrackRecord] = useState<{ trigram: string; turns: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [raceStarted, setRaceStarted] = useState(false);
    const [raceLevel, setRaceLevel] = useState<RaceLevel>("novice");
    const [raceDirection, setRaceDirection] = useState<RaceDirection>(1);
    const [startOrder, setStartOrder] = useState<number[]>([0, 1, 2, 3]);
    const [playerCount, setPlayerCount] = useState(2);
    const [playerControllers, setPlayerControllers] = useState<("AI" | "RL")[]>(["RL", "AI", "AI", "AI"]);
    const [startGrid, setStartGrid] = useState<StartSpot[]>([]);
    const [players, setPlayers] = useState<Player[]>([]);
    const [currentPlayerIndex, setCurrentPlayerIndex] = useState<number>(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [phase, setPhase] = useState<"placement" | "race">("placement");
    // One-lap race bookkeeping
    const [moveCounts, setMoveCounts] = useState<number[]>([]);
    const [finished, setFinished] = useState<boolean[]>([]);
    const [overrun, setOverrun] = useState<number[]>([]);   // px beyond finish on finishing move
    const [raceOver, setRaceOver] = useState(false);
    const [eventMessage, setEventMessage] = useState<string | null>(null);
    const aiSearchIterationsRef = useRef(0);
    const lapProgressRef = useRef<number[]>([]);


    // When all players are placed, switch from placement → race
    useEffect(() => {
        const allPlaced = raceStarted && players.length === playerCount;
        if (allPlaced && phase !== "race") {
            setCurrentPlayerIndex(0);
            setPhase("race");
        }
    }, [raceStarted, players.length, playerCount, phase]);

    // Commit a move during the race phase (used by <GameCanvas />)
    function commitMove(updated: Player): void {
        console.assert(updated && typeof updated.x === "number", "updated player must be valid");
        if (raceOver) return;
        if (finished[currentPlayerIndex]) return;

        const prev = players[currentPlayerIndex];
        console.assert(!!prev, "previous player state must exist");

        // --- build next snapshots (Power of 10: short, fixed loops, assertions) ---
        const nextPlayers = [...players];
        nextPlayers[currentPlayerIndex] = {
            ...updated,
            trail: [...(prev.trail ?? [{ x: prev.x, y: prev.y }]), { x: updated.x, y: updated.y }],
        };

        const nextMoveCounts = [...moveCounts];
        const prevPenalty = Number.isFinite(prev.penalties ?? NaN) ? (prev.penalties ?? 0) : 0;
        const nextPenalty = Number.isFinite(updated.penalties ?? NaN) ? (updated.penalties ?? 0) : prevPenalty;
        const penaltyDelta = Math.max(0, nextPenalty - prevPenalty);
        nextMoveCounts[currentPlayerIndex] = (nextMoveCounts[currentPlayerIndex] ?? 0) + 1 + penaltyDelta;
        if (penaltyDelta > 0) {
            const message = playerControllers[currentPlayerIndex] === "RL"
                ? "You crashed!"
                : `AI driver ${currentPlayerIndex + 1} crashed!`;
            setEventMessage(message);
            window.alert(message);
        }

        const coreSections = toCoreSections(sections);
        const previousProgress = lapProgressRef.current[currentPlayerIndex] ?? getTrackProgress(prev.x, prev.y, coreSections);
        const nextProgress = Math.max(previousProgress, getTrackProgress(prev.x, prev.y, coreSections), getTrackProgress(updated.x, updated.y, coreSections));
        lapProgressRef.current[currentPlayerIndex] = nextProgress;
        const finishCrossed = isFinishCrossing(prev, updated, coreSections, previousProgress);
        const addOver = finishCrossed
            ? Math.max(1, forwardCrossOverrun(prev.x, prev.y, updated.x, updated.y))
            : 0;

        const nextFinished = [...finished];
        const nextOverrun = [...overrun];
        if (addOver > 0 && !nextFinished[currentPlayerIndex]) {
            nextFinished[currentPlayerIndex] = true;
            nextOverrun[currentPlayerIndex] = addOver;
        }
        // --- commit state ---
        setPlayers(nextPlayers);
        setMoveCounts(nextMoveCounts);
        setFinished(nextFinished);
        setOverrun(nextOverrun);

        if (addOver > 0) {
            setRaceOver(true);
            setEventMessage(playerControllers[currentPlayerIndex] === "RL"
                ? `You win! Finished in ${nextMoveCounts[currentPlayerIndex]} turns.`
                : `AI driver ${currentPlayerIndex + 1} wins! Finished in ${nextMoveCounts[currentPlayerIndex]} turns.`);
            maybeSaveTrackRecord(nextMoveCounts[currentPlayerIndex]);
            const label = playerControllers[currentPlayerIndex] === "RL"
                ? "You win!"
                : `AI driver ${currentPlayerIndex + 1} wins!`;
            window.alert(`${label} Finished in ${nextMoveCounts[currentPlayerIndex]} turns.`);
            console.log(`Winner: Player ${currentPlayerIndex + 1} - moves=${nextMoveCounts[currentPlayerIndex]} overrun=${nextOverrun[currentPlayerIndex]}px`);
            return;
        }

        // pick next active player using the fresh 'nextFinished'
        let nxt = currentPlayerIndex;
        for (let k = 0; k < playerCount; k++) {
            nxt = (nxt + 1) % playerCount;
            if (!nextFinished[nxt]) break;
        }

        setCurrentPlayerIndex(nxt);

        // AI turns are triggered by the race-phase effect after state settles.
    }

    function moveSpeed(move: CandidateMove): number {
        return Math.hypot(move.dx, move.dy);
    }

    function getConnections(type: SectionType, rotation: number): Direction[] {
        const normalized = ((rotation % 360) + 360) % 360;

        if (type === "start" || type === "straight") {
            return normalized % 180 === 0 ? ["left", "right"] : ["top", "bottom"];
        }

        switch (normalized) {
            case 0: return ["bottom", "right"];
            case 90: return ["left", "bottom"];
            case 180: return ["top", "left"];
            default: return ["right", "top"];
        }
    }

    function dirOffset(dir: Direction): { x: number; y: number } {
        if (dir === "top") return { x: 0, y: -1 };
        if (dir === "bottom") return { x: 0, y: 1 };
        if (dir === "left") return { x: -1, y: 0 };
        return { x: 1, y: 0 };
    }

    function reverseDir(dir: Direction): Direction {
        if (dir === "top") return "bottom";
        if (dir === "bottom") return "top";
        if (dir === "left") return "right";
        return "left";
    }

    function directionVector(dir: Direction): { x: number; y: number } {
        if (dir === "top") return { x: 0, y: -1 };
        if (dir === "bottom") return { x: 0, y: 1 };
        if (dir === "left") return { x: -1, y: 0 };
        return { x: 1, y: 0 };
    }

    function vectorDirection(dx: number, dy: number): Direction | null {
        if (dx === 1 && dy === 0) return "right";
        if (dx === -1 && dy === 0) return "left";
        if (dx === 0 && dy === 1) return "bottom";
        if (dx === 0 && dy === -1) return "top";
        return null;
    }

    function rotateVectorBack(v: { x: number; y: number }, rotation: number): { x: number; y: number } {
        const normalized = ((rotation % 360) + 360) % 360;
        if (normalized === 90) return { x: v.y, y: -v.x };
        if (normalized === 180) return { x: -v.x, y: -v.y };
        if (normalized === 270) return { x: -v.y, y: v.x };
        return v;
    }

    function rotateVectorForward(v: { x: number; y: number }, rotation: number): { x: number; y: number } {
        const normalized = ((rotation % 360) + 360) % 360;
        if (normalized === 90) return { x: -v.y, y: v.x };
        if (normalized === 180) return { x: -v.x, y: -v.y };
        if (normalized === 270) return { x: v.y, y: -v.x };
        return v;
    }

    function startForwardDirection(rotation: number): Direction {
        const normalized = ((rotation % 360) + 360) % 360;
        if (normalized === 0) return "right";
        if (normalized === 90) return "bottom";
        if (normalized === 180) return "left";
        return "top";
    }

    function directedStartDirection(rotation: number): Direction {
        const forward = startForwardDirection(rotation);
        return raceDirection === 1 ? forward : reverseDir(forward);
    }

    function buildTrackOrder(core: CoreSection[]): CoreSection[] {
        const byKey = new Map(core.map((section) => [`${section.x},${section.y}`, section]));
        const start = core.find((section) => section.type === "start");
        if (!start) return core;

        const ordered: CoreSection[] = [start];
        const visited = new Set([`${start.x},${start.y}`]);
        let current = start;
        let previousKey: string | null = null;

        for (let guard = 0; guard < core.length + 2; guard++) {
            let next: CoreSection | null = null;
            const connections = getConnections(current.type, current.rotation);
            const forward = directedStartDirection(start.rotation);
            const directions = previousKey === null && current.id === start.id
                ? [forward, ...connections.filter((dir) => dir !== forward)]
                : connections;

            for (const dir of directions) {
                const offset = dirOffset(dir);
                const key = `${current.x + offset.x},${current.y + offset.y}`;
                if (key === previousKey) continue;

                const candidate = byKey.get(key);
                if (!candidate) continue;
                if (!getConnections(candidate.type, candidate.rotation).includes(reverseDir(dir))) continue;

                next = candidate;
                break;
            }

            if (!next) break;
            const nextKey = `${next.x},${next.y}`;
            if (visited.has(nextKey)) break;

            ordered.push(next);
            visited.add(nextKey);
            previousKey = `${current.x},${current.y}`;
            current = next;
        }

        return ordered;
    }

    function getTileAt(x: number, y: number, core: CoreSection[]): CoreSection | null {
        return core.find((section) =>
            x >= section.x * 90 &&
            x <= section.x * 90 + 90 &&
            y >= section.y * 90 &&
            y <= section.y * 90 + 90
        ) ?? null;
    }

    function localPointInTile(x: number, y: number, tile: CoreSection): { x: number; y: number } {
        const rawX = x - tile.x * 90;
        const rawY = y - tile.y * 90;
        const cx = 45;
        const cy = 45;
        const dx = rawX - cx;
        const dy = rawY - cy;
        const normalized = ((tile.rotation % 360) + 360) % 360;

        if (normalized === 90) return { x: cx + dy, y: cy - dx };
        if (normalized === 180) return { x: cx - dx, y: cy - dy };
        if (normalized === 270) return { x: cx - dy, y: cy + dx };
        return { x: rawX, y: rawY };
    }

    function roadCenterPenalty(x: number, y: number, core: CoreSection[]): number {
        const sample = sampleRaceValue(x, y, core);
        return sample ? sample.distance : 10000;
    }

    function getCurveTangentDirection(x: number, y: number, tile: CoreSection, core: CoreSection[]): { x: number; y: number } | null {
        const order = buildTrackOrder(core);
        const index = order.findIndex((section) => section.id === tile.id);
        if (index < 0) return null;

        const previous = order[index - 1];
        const next = order[index + 1];
        if (!previous || !next) return null;

        const previousWorldDir = vectorDirection(previous.x - tile.x, previous.y - tile.y);
        const nextWorldDir = vectorDirection(next.x - tile.x, next.y - tile.y);
        if (!previousWorldDir || !nextWorldDir) return null;

        const previousLocalVector = rotateVectorBack(directionVector(previousWorldDir), tile.rotation);
        const nextLocalVector = rotateVectorBack(directionVector(nextWorldDir), tile.rotation);
        const previousLocalDir = vectorDirection(previousLocalVector.x, previousLocalVector.y);
        const nextLocalDir = vectorDirection(nextLocalVector.x, nextLocalVector.y);
        if (!previousLocalDir || !nextLocalDir) return null;

        const local = localPointInTile(x, y, tile);
        const radiusX = local.x - 90;
        const radiusY = local.y - 90;
        const localTangent = previousLocalDir === "bottom" && nextLocalDir === "right"
            ? { x: -radiusY, y: radiusX }
            : previousLocalDir === "right" && nextLocalDir === "bottom"
                ? { x: radiusY, y: -radiusX }
                : null;
        if (!localTangent) return null;

        const world = rotateVectorForward(localTangent, tile.rotation);
        const len = Math.hypot(world.x, world.y);
        if (len < 1) return null;

        return { x: world.x / len, y: world.y / len };
    }

    function getTrackProgress(x: number, y: number, core: CoreSection[]): number {
        const order = buildTrackOrder(core);
        const tile = getTileAt(x, y, order);
        if (!tile) return -100000;

        const index = Math.max(0, order.findIndex((section) => section.id === tile.id));
        if (tile.type === "start") {
            const forward = getRaceForwardVector();
            if (forward) {
                const cx = tile.x * 90 + 45;
                const cy = tile.y * 90 + 45;
                return index * 1000 + (x - cx) * forward.x + (y - cy) * forward.y;
            }
        }

        const next = order[(index + 1) % order.length] ?? tile;
        const cx = tile.x * 90 + 45;
        const cy = tile.y * 90 + 45;
        const nx = next.x * 90 + 45;
        const ny = next.y * 90 + 45;
        const len = Math.max(1, Math.hypot(nx - cx, ny - cy));
        const localForward = ((x - cx) * (nx - cx) + (y - cy) * (ny - cy)) / len;

        return index * 1000 + localForward;
    }

    function getFinishEligibilityProgress(core: CoreSection[]): number {
        const order = buildTrackOrder(core);
        return Math.max(1000, (order.length - 2) * 1000);
    }

    function isEligibleToFinish(x: number, y: number, core: CoreSection[]): boolean {
        return getTrackProgress(x, y, core) >= getFinishEligibilityProgress(core);
    }

    function getOrderedTileIndexAt(x: number, y: number, order: CoreSection[]): number {
        const tile = getTileAt(x, y, order);
        if (!tile) return -1;
        return order.findIndex((section) => section.id === tile.id);
    }

    function isFinishCrossing(prev: Player, updated: Player, core: CoreSection[], bestProgressReached?: number): boolean {
        const order = buildTrackOrder(core);
        const prevIndex = getOrderedTileIndexAt(prev.x, prev.y, order);
        const progress = Math.max(
            bestProgressReached ?? -100000,
            getTrackProgress(prev.x, prev.y, core)
        );
        const eligible = progress >= getFinishEligibilityProgress(core) || prevIndex >= order.length - 2;
        if (!eligible) return false;

        return forwardCrossOverrun(prev.x, prev.y, updated.x, updated.y) > 0;
    }

    function getStartLineDistance(x: number, y: number): number | null {
        const line = getStartLine();
        if (!line) return null;
        const forwardSign = line.forwardSign * raceDirection;
        return line.kind === "vertical"
            ? (x - line.coord) * forwardSign
            : (y - line.coord) * forwardSign;
    }

    function mustLeaveStartForward(player: Player, core: CoreSection[]): boolean {
        if (isEligibleToFinish(player.x, player.y, core)) return false;
        const progress = getTrackProgress(player.x, player.y, core);
        const startDistance = getStartLineDistance(player.x, player.y);
        return progress < 3000 && startDistance !== null;
    }

    function violatesStartExit(player: Player, move: CandidateMove, core: CoreSection[]): boolean {
        if (!mustLeaveStartForward(player, core)) return false;
        const before = getStartLineDistance(player.x, player.y);
        const after = getStartLineDistance(move.x, move.y);
        if (before === null || after === null) return false;
        const forward = getRaceForwardVector();
        const forwardDisplacement = forward
            ? (move.x - player.x) * forward.x + (move.y - player.y) * forward.y
            : 0;
        return forwardDisplacement <= 0 || after < before - 1 || after < -1;
    }

    function mustUseStartLaunchMoves(player: Player, core: CoreSection[]): boolean {
        if (isEligibleToFinish(player.x, player.y, core)) return false;
        const order = buildTrackOrder(core);
        const tile = getTileAt(player.x, player.y, order);
        if (!tile) return false;
        const index = order.findIndex((section) => section.id === tile.id);
        return index >= 0 && index < 2;
    }

    function filterStartLaunchMoves(player: Player, moves: CandidateMove[], core: CoreSection[]): CandidateMove[] {
        if (!mustUseStartLaunchMoves(player, core)) return moves;

        const forward = getRaceForwardVector();
        if (!forward) return moves;

        return moves.filter((move) => {
            const accelerationX = move.dx - player.dx;
            const accelerationY = move.dy - player.dy;
            return accelerationX * forward.x + accelerationY * forward.y > 0;
        });
    }

    function isStrongReverse(player: Player, move: CandidateMove, core: CoreSection[]): boolean {
        const speed = Math.hypot(player.dx, player.dy);

        const moveVectorDotVelocity = (move.x - player.x) * player.dx + (move.y - player.y) * player.dy;
        const progressGain = getTrackProgress(move.x, move.y, core) - getTrackProgress(player.x, player.y, core);
        const forward = getRaceDirectionAt(player.x, player.y, core);
        const directionGain = forward ? (move.x - player.x) * forward.x + (move.y - player.y) * forward.y : 0;
        const tile = getTileAt(player.x, player.y, core);

        return (speed >= 15 && moveVectorDotVelocity < -speed * 10)
            || progressGain < -40
            || (tile?.type === "curve90" && directionGain < 1)
            || directionGain < -1;
    }

    function movesToEarlierTile(player: Player, move: CandidateMove, core: CoreSection[]): boolean {
        const order = buildTrackOrder(core);
        const fromTile = getTileAt(player.x, player.y, order);
        const toTile = getTileAt(move.x, move.y, order);
        if (!fromTile || !toTile || fromTile.id === toTile.id) return false;

        const fromIndex = order.findIndex((section) => section.id === fromTile.id);
        const toIndex = order.findIndex((section) => section.id === toTile.id);
        if (fromIndex < 0 || toIndex < 0) return false;
        if (isEligibleToFinish(player.x, player.y, core)) return false;

        return toIndex < fromIndex;
    }

    function getRaceDirectionAt(x: number, y: number, core: CoreSection[]): { x: number; y: number } | null {
        const order = buildTrackOrder(core);
        const tile = getTileAt(x, y, order);
        if (!tile) return getRaceForwardVector();
        if (tile.type === "start") return getRaceForwardVector();
        if (tile.type === "curve90") {
            const tangent = getCurveTangentDirection(x, y, tile, core);
            if (tangent) return tangent;
        }

        const index = Math.max(0, order.findIndex((section) => section.id === tile.id));
        const next = order[(index + 1) % order.length] ?? tile;
        const cx = tile.x * 90 + 45;
        const cy = tile.y * 90 + 45;
        const nx = next.x * 90 + 45;
        const ny = next.y * 90 + 45;
        const len = Math.hypot(nx - cx, ny - cy);
        if (len < 1) return getRaceForwardVector();

        return { x: (nx - cx) / len, y: (ny - cy) / len };
    }

    function sampleRaceValue(x: number, y: number, core: CoreSection[]): RaceValueSample | null {
        const order = buildTrackOrder(core);
        const path = order.map((section, index) => ({
            x: section.x * 90 + 45,
            y: section.y * 90 + 45,
            value: 2000 - index * 10,
        }));
        if (path.length > 2) {
            path.push({ ...path[0], value: 2000 - path.length * 10 });
        }
        if (path.length === 0) return null;
        if (path.length === 1) {
            return {
                value: path[0].value,
                progress: 0,
                tangent: getRaceForwardVector() ?? { x: 1, y: 0 },
                distance: Math.hypot(x - path[0].x, y - path[0].y),
            };
        }

        let best: RaceValueSample | null = null;
        for (let i = 0; i < path.length - 1; i++) {
            const a = path[i];
            const b = path[i + 1];
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const lenSq = Math.max(1, vx * vx + vy * vy);
            const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / lenSq));
            const px = a.x + vx * t;
            const py = a.y + vy * t;
            const distance = Math.hypot(x - px, y - py);
            const len = Math.max(1, Math.hypot(vx, vy));
            const sample = {
                value: a.value + (b.value - a.value) * t,
                progress: i + t,
                tangent: { x: vx / len, y: vy / len },
                distance,
            };

            if (!best || sample.distance < best.distance) {
                best = sample;
            }
        }

        return best;
    }
    function isAiMoveValueLegal(player: Player, move: CandidateMove, core: CoreSection[]): boolean {
        if (move.crash) return false;
        const traced = getValidMovesForPlayer(player, core).find((candidate) =>
            candidate.x === move.x &&
            candidate.y === move.y &&
            candidate.dx === move.dx &&
            candidate.dy === move.dy
        );
        if (!traced || traced.crash) return false;
        if (violatesStartExit(player, move, core)) return false;
        const updated: Player = { ...player, x: move.x, y: move.y, dx: move.dx, dy: move.dy };
        if (isFinishCrossing(player, updated, core)) return true;
        if (isStrongReverse(player, move, core) || movesToEarlierTile(player, move, core)) return false;

        const fromTileProgress = getTrackProgress(player.x, player.y, core);
        const toTileProgress = getTrackProgress(move.x, move.y, core);
        if (!Number.isFinite(fromTileProgress) || !Number.isFinite(toTileProgress)) return false;
        if (toTileProgress < fromTileProgress - 0.01) return false;

        const from = sampleRaceValue(player.x, player.y, core);
        const to = sampleRaceValue(move.x, move.y, core);
        if (!from || !to) return false;

        const travelX = move.x - player.x;
        const travelY = move.y - player.y;
        const travelLen = Math.hypot(travelX, travelY);
        if (travelLen < 1) return false;

        const direction = getRaceDirectionAt(player.x, player.y, core) ?? from.tangent;
        const directionDot = (travelX * direction.x + travelY * direction.y) / travelLen;
        const progressGain = to.progress - from.progress;

        return progressGain >= 0.03
            && directionDot >= -0.01
            && isAiSegmentDirectionLegal(player, move, core);
    }

    function isAiSegmentDirectionLegal(player: Player, move: CandidateMove, core: CoreSection[]): boolean {
        const vx = move.dx;
        const vy = move.dy;
        const speed = Math.hypot(vx, vy);
        if (speed < 1) return false;

        const steps = Math.max(2, Math.ceil(speed / GRID));
        let previousProgress = sampleRaceValue(player.x, player.y, core)?.progress;
        let previousTileProgress = getTrackProgress(player.x, player.y, core);
        if (previousProgress === undefined) return false;
        if (!Number.isFinite(previousTileProgress)) return false;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = player.x + vx * t;
            const y = player.y + vy * t;
            const sample = sampleRaceValue(x, y, core);
            if (!sample) return false;
            const tileProgress = getTrackProgress(x, y, core);
            if (!Number.isFinite(tileProgress)) return false;

            const direction = getRaceDirectionAt(x, y, core) ?? sample.tangent;
            const velocityDot = (vx * direction.x + vy * direction.y) / speed;
            if (velocityDot < -0.01) return false;

            if (sample.progress < previousProgress - 0.12) return false;
            if (tileProgress < previousTileProgress - 2) return false;
            previousProgress = Math.max(previousProgress, sample.progress);
            previousTileProgress = Math.max(previousTileProgress, tileProgress);
        }

        return true;
    }

    function isPostCrashRestartMove(player: Player): boolean {
        return player.dx === 0 && player.dy === 0 && (player.penalties ?? 0) > 0;
    }

    function filterPostCrashRestartMoves(player: Player, moves: CandidateMove[], core: CoreSection[]): CandidateMove[] {
        return filterRestartMoves(player, moves, {
            direction: getRaceDirectionAt(player.x, player.y, core) ?? sampleRaceValue(player.x, player.y, core)?.tangent ?? null,
            centerPenalty: (x, y) => roadCenterPenalty(x, y, core),
        });
    }

    function snapCrashMoveByRaceValue(player: Player, move: Move, core: CoreSection[]): Move {
        if (!move.crash) return move;

        const from = sampleRaceValue(player.x, player.y, core);
        const anchor = { x: move.safeX, y: move.safeY };
        const target = sampleRaceValue(anchor.x, anchor.y, core);
        if (!from) return move;

        const candidateSections = [
            getTileAt(anchor.x, anchor.y, core),
            getTileAt(player.x, player.y, core),
        ].filter((section, index, list): section is CoreSection =>
            !!section && list.findIndex((item) => item?.id === section.id) === index
        );

        const forwardCandidates: { x: number; y: number; score: number; forward: boolean }[] = [];
        const backwardCandidates: { x: number; y: number; score: number; forward: boolean }[] = [];
        for (const section of candidateSections.length > 0 ? candidateSections : core) {
            const left = section.x * TILE;
            const top = section.y * TILE;
            for (let x = left; x <= left + TILE; x += GRID) {
                for (let y = top; y <= top + TILE; y += GRID) {
                    if (!isPointOnTrack(x, y, core)) continue;
                    const sample = sampleRaceValue(x, y, core);
                    if (!sample) continue;

                    const forward = sample.progress >= from.progress - 0.05;
                    const targetProgressPenalty = target ? Math.abs(sample.progress - target.progress) * 20 : 0;
                    const distancePenalty = Math.hypot(x - anchor.x, y - anchor.y) * 100;
                    const backwardPenalty = forward ? 0 : 10000 + (from.progress - sample.progress) * 1000;
                    const score = distancePenalty + targetProgressPenalty + backwardPenalty;

                    const bucket = forward ? forwardCandidates : backwardCandidates;
                    bucket.push({ x, y, score, forward });
                }
            }
        }

        const pool = forwardCandidates.length > 0 ? forwardCandidates : backwardCandidates;
        const best = pool.reduce<{ x: number; y: number; score: number; forward: boolean } | null>((currentBest, candidate) => {
            if (!currentBest) return candidate;
            return candidate.score < currentBest.score ? candidate : currentBest;
        }, null);

        return best ? { ...move, safeX: best.x, safeY: best.y } : move;
    }

    function normalizeRaceMoves(moves: Move[], player: Player): Move[] {
        const core = toCoreSections(sections);
        return moves.map((move) => snapCrashMoveByRaceValue(player, move, core));
    }

    function getMoveLandingKey(move: CandidateMove): string {
        const x = move.crash ? move.safeX ?? move.x : move.x;
        const y = move.crash ? move.safeY ?? move.y : move.y;
        return `${x},${y}`;
    }

    function getOccupiedKeys(excludedPlayerIndex: number): Set<string> {
        return new Set(
            players
                .filter((_, index) => index !== excludedPlayerIndex)
                .map((player) => `${player.x},${player.y}`)
        );
    }

    function getAiSearchMoves(player: Player, core: CoreSection[], occupiedKeys: Set<string>): CandidateMove[] {
        const rawMoves = normalizeRaceMoves(getValidMovesForPlayer(player, core) || [], player);
        const launchMoves = filterStartLaunchMoves(player, rawMoves, core);
        const legalMoves = launchMoves
            .filter((move) => !occupiedKeys.has(getMoveLandingKey(move)))
            .filter((move) => isAiMoveValueLegal(player, move, core));
        const restartMoves = filterPostCrashRestartMoves(player, legalMoves, core);

        return restartMoves.sort((a, b) => scoreAiTerminal({ ...player, x: b.x, y: b.y, dx: b.dx, dy: b.dy }, core)
            - scoreAiTerminal({ ...player, x: a.x, y: a.y, dx: a.dx, dy: a.dy }, core));
    }

    function getAiSearchBudget(): number {
        return AI_TUNING[raceLevel]?.budget ?? AI_TUNING.novice.budget;
    }

    function getActiveAiDepth(): number {
        return AI_TUNING[raceLevel]?.depth ?? AI_TUNING.novice.depth;
    }

    function pruneAiMoves(moves: CandidateMove[]): CandidateMove[] {
        const limit = AI_TUNING[raceLevel]?.prune ?? AI_TUNING.novice.prune;
        return moves.slice(0, limit);
    }

    function scoreAiTerminal(player: Player, core: CoreSection[]): number {
        const sample = sampleRaceValue(player.x, player.y, core);
        if (!sample) return AI_REJECT_SCORE;

        return sample.progress * 1000
            + moveSpeed(player) * 4
            - roadCenterPenalty(player.x, player.y, core) * 1.2;
    }

    function beamSearchAiPlan(player: Player, core: CoreSection[], occupiedKeys: Set<string>, depth: number, budget: number): AiPlanResult {
        const width = AI_TUNING[raceLevel]?.beamWidth ?? AI_TUNING.novice.beamWidth;
        let beam: AiBeamNode[] = [{
            player,
            firstMove: null,
            score: scoreAiTerminal(player, core),
            complete: false,
        }];
        let best = beam[0];

        for (let step = 0; step < depth; step++) {
            const nextBeam: AiBeamNode[] = [];

            for (const node of beam) {
                if (node.complete) {
                    nextBeam.push(node);
                    continue;
                }
                if (aiSearchIterationsRef.current >= budget) break;

                const moves = pruneAiMoves(getAiSearchMoves(node.player, core, occupiedKeys));
                if (moves.length === 0) {
                    nextBeam.push({
                        ...node,
                        score: scoreAiTerminal(node.player, core) - 100000,
                        complete: false,
                    });
                    continue;
                }

                for (let i = 0; i < moves.length; i++) {
                    if (aiSearchIterationsRef.current >= budget) break;
                    aiSearchIterationsRef.current += 1;

                    const move = moves[i];
                    const updated: Player = {
                        ...node.player,
                        x: move.x,
                        y: move.y,
                        dx: move.dx,
                        dy: move.dy,
                    };
                    const finishedMove = isFinishCrossing(node.player, updated, core);
                    const score = finishedMove
                        ? 1000000 + (depth - step)
                        : scoreAiTerminal(updated, core);

                    nextBeam.push({
                        player: updated,
                        firstMove: node.firstMove ?? move,
                        score,
                        complete: finishedMove || step === depth - 1,
                    });
                }
            }

            if (nextBeam.length === 0) break;
            nextBeam.sort((a, b) =>
                a.complete === b.complete ? b.score - a.score : a.complete ? -1 : 1
            );
            best = nextBeam[0];
            beam = nextBeam.slice(0, width);
            if (best.score >= 1000000) break;
        }

        return {
            move: best.firstMove,
            score: best.score,
            complete: best.complete,
            iterations: aiSearchIterationsRef.current,
            budgetHit: aiSearchIterationsRef.current >= budget,
        };
    }

    async function pickAiMoveWithProgress(player: Player, moves: CandidateMove[], core: CoreSection[], occupiedKeys: Set<string>): Promise<CandidateMove | null> {
        console.assert(!!player, "AI player must exist");
        console.assert(Array.isArray(moves), "AI moves must be an array");
        if (moves.length === 0) return null;

        const searchDepth = Math.max(1, getActiveAiDepth());
        const budget = getAiSearchBudget();
        const initialMoves = pruneAiMoves(getAiSearchMoves(player, core, occupiedKeys));
        aiSearchIterationsRef.current = 0;

        const result = beamSearchAiPlan(player, core, occupiedKeys, searchDepth, budget);
        if (result.move) return result.move;

        const restartContext = {
            direction: getRaceDirectionAt(player.x, player.y, core) ?? sampleRaceValue(player.x, player.y, core)?.tangent ?? null,
            centerPenalty: (x: number, y: number) => roadCenterPenalty(x, y, core),
        };
        const fallbackCandidates = isPostCrashRestartMove(player)
            ? [...initialMoves].sort((a, b) => scorePostCrashRestartMove(player, b, restartContext) - scorePostCrashRestartMove(player, a, restartContext))
            : initialMoves;
        const fallback = fallbackCandidates[0]
            ?? moves.find((move) => !move.crash && !occupiedKeys.has(getMoveLandingKey(move)))
            ?? moves.find((move) => !occupiedKeys.has(getMoveLandingKey(move)))
            ?? null;
        return fallback;
    }

    // Execute one AI move for the CURRENT player index (which should be AI)
    async function aiDoMove(): Promise<void> {
        // 🔒 Guard: never let AI move during placement
        if (phase !== "race") return;

        const idx = currentPlayerIndex;
        console.assert(idx >= 0 && idx < players.length, "currentPlayerIndex in range");
        if (playerControllers[idx] !== "AI") return;

        const ai = players[idx];
        const core = toCoreSections(sections);
        const occupiedKeys = getOccupiedKeys(idx);
        const allMoves = filterStartLaunchMoves(ai, normalizeRaceMoves(getValidMovesForPlayer(ai, core) || [], ai), core)
            .filter((move) => !occupiedKeys.has(getMoveLandingKey(move)));
        const safeMoves = allMoves.filter((move) => !move.crash);
        const moves = safeMoves.length > 0 ? safeMoves : allMoves;
        const choice = await pickAiMoveWithProgress(ai, moves, core, occupiedKeys);
        if (!choice) {
            console.warn("[AI] No legal move; skipping turn.");
            setCurrentPlayerIndex(prev => (prev + 1) % playerCount);
            return;
        }

        const updated: Player = {
            ...ai,
            x: choice.crash ? choice.safeX ?? ai.x : choice.x,
            y: choice.crash ? choice.safeY ?? ai.y : choice.y,
            dx: choice.crash ? 0 : choice.dx,
            dy: choice.crash ? 0 : choice.dy,
            penalties: (ai.penalties ?? 0) + (choice.crash ? 1 : 0),
        };
        commitMove(updated);
    }

    function toCoreSections(input: Section[]): CoreSection[] {
        const out: CoreSection[] = [];
        for (let i = 0; i < input.length; i++) {            // fixed-bound loop
            const s = input[i];
            if (isCoreType(s.type)) {
                out.push({
                    id: s.id,
                    type: s.type,                                  // narrowed to SectionType
                    x: s.x,
                    y: s.y,
                    rotation: s.rotation,
                });
            }
        }
        console.assert(Array.isArray(out), "toCoreSections must return an array");
        return out;
    }

    const isCoreType = (t: AnySectionType): t is SectionType =>
        t === "start" || t === "straight" || t === "curve90";

    const imageMap: Record<AnySectionType, string> = {
        start: "/tiles/start.png",
        straight: "/tiles/straight.png",
        curve90: "/tiles/curve.png",
        grass: "/tiles/Grass.png",
        Tree_1: "/tiles/Tree_1.png",
        Tree_2: "/tiles/Tree_2.png",
        Tree_3: "/tiles/Tree_3.png",
        Tree_4: "/tiles/Tree_4.png",
        Tree_5: "/tiles/Tree_5.png",
        Tree_6: "/tiles/Tree_6.png",
        Tree_7: "/tiles/Tree_7.png",
        Tree_8: "/tiles/Tree_8.png",
        Tree_9: "/tiles/Tree_9.png",
        Tree_10: "/tiles/Tree_10.png",
    };

    function shuffleOrder(count: number): number[] {
        const order = Array.from({ length: count }, (_, index) => index);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        return order;
    }

    function getStartOrder(level: RaceLevel, count: number): number[] {
        if (level === "novice") return Array.from({ length: count }, (_, index) => index);

        const order = shuffleOrder(count);
        if (level === "king" && order[0] === 0 && order.length > 1) {
            [order[0], order[1]] = [order[1], order[0]];
        }
        return order;
    }

    function applyStartOrder<T>(items: T[], order: number[]): T[] {
        return order.map((sourceIndex) => items[sourceIndex]);
    }

    useEffect(() => {
        if (
            players.length > 0 &&
            players.length < playerCount &&
            playerControllers[players.length] === "AI"
        ) {
            autoPlaceAIPlayers();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [players, startGrid, playerControllers, playerCount]);

    useEffect(() => {
        if (
            raceStarted &&
            phase === "placement" &&
            players.length < playerCount &&
            playerControllers[players.length] === "AI"
        ) {
            const timer = window.setTimeout(() => autoPlaceAIPlayers(), 150);
            return () => window.clearTimeout(timer);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [raceStarted, phase, players.length, playerCount, playerControllers, startGrid]);

    useEffect(() => {
        if (
            raceStarted &&
            phase === "race" &&
            !raceOver &&
            players.length === playerCount &&
            playerControllers[currentPlayerIndex] === "AI"
        ) {
            const timer = window.setTimeout(() => aiDoMove(), AI_MOVE_DELAY_MS);
            return () => window.clearTimeout(timer);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [raceStarted, phase, raceOver, players, playerCount, playerControllers, currentPlayerIndex]);

    const gridUnit = 90;
    const cols = Math.floor(boardSize / gridUnit);
    const rows = Math.floor(boardSize / gridUnit);
    const boardWidth = cols * gridUnit;
    const boardHeight = rows * gridUnit;
    const hasLoadedTrack = sections.some((section) => isCoreType(section.type));

    function handleLoadClick(): void {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    }

    function resetLoadedRace(): void {
        setSections([]);
        setLoadedTrackName("");
        setTrackRecord(null);
        setPlayers([]);
        setStartGrid([]);
        setCurrentPlayerIndex(0);
        setStartOrder([0, 1, 2, 3]);
        setRaceDirection(1);
        setRaceStarted(false);
        setPhase("placement");
        setRaceOver(false);
        setEventMessage(null);
        lapProgressRef.current = [];
        setError(null);
    }

    function getTrackRecordKey(name = loadedTrackName): string {
        return `racetrack-record:${boardSize}:${name || "unnamed-track"}`;
    }

    function loadTrackRecord(name: string): void {
        try {
            const raw = window.localStorage.getItem(getTrackRecordKey(name));
            setTrackRecord(raw ? JSON.parse(raw) : null);
        } catch {
            setTrackRecord(null);
        }
    }

    function maybeSaveTrackRecord(turns: number): void {
        if (!loadedTrackName) return;
        if (trackRecord && turns >= trackRecord.turns) return;

        const record = { trigram: "YOU", turns };
        window.localStorage.setItem(getTrackRecordKey(), JSON.stringify(record));
        setTrackRecord(record);
    }

    function restartRace(): void {
        const coreSections = toCoreSections(sections);
        const grid = getStartGrid(coreSections);
        if (grid.length === 0) return;

        setStartGrid(grid);
        setPlayers([]);
        setCurrentPlayerIndex(0);
        setPhase("placement");
        setMoveCounts(Array(playerCount).fill(0));
        setFinished(Array(playerCount).fill(false));
        setOverrun(Array(playerCount).fill(0));
        setRaceOver(false);
        setEventMessage(null);
        lapProgressRef.current = Array(playerCount).fill(-100000);
    }

    function inferBoardSizeFromFileName(name: string): number | null {
        const match = name.match(/(?:^|_)(400|600|900|1200)_(?:400|600|900|1200)(?:_|\.|$)/);
        return match ? Number(match[1]) : null;
    }

    function fitsBoardSize(input: Section[], selectedSize: number): boolean {
        const selectedCols = Math.floor(selectedSize / gridUnit);
        const selectedRows = Math.floor(selectedSize / gridUnit);
        return input.every((section) => section.x >= 0 && section.y >= 0 && section.x < selectedCols && section.y < selectedRows);
    }


    function handleFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) throw new Error("File format invalid");

                const validTypes: AnySectionType[] = [
                    "start", "straight", "curve90",
                    "grass",
                    "Tree_1", "Tree_2", "Tree_3", "Tree_4", "Tree_5",
                    "Tree_6", "Tree_7", "Tree_8", "Tree_9", "Tree_10"
                ];

                const filtered = parsed.filter((s: any) =>
                    typeof s?.type === "string" &&
                    validTypes.includes(s.type as AnySectionType) &&
                    Number.isFinite(s.x) &&
                    Number.isFinite(s.y) &&
                    Number.isFinite(s.rotation)
                );

                const dropped = parsed.length - filtered.length;
                if (dropped > 0) {
                    console.warn(`[INFO] Ignored ${dropped} unknown/invalid items.`);
                }

                const fileBoardSize = inferBoardSizeFromFileName(file.name);
                if (fileBoardSize !== null && fileBoardSize !== boardSize) {
                    throw new Error(`This track is ${fileBoardSize} x ${fileBoardSize}. Select that board size before loading it.`);
                }

                if (!fitsBoardSize(filtered as Section[], boardSize)) {
                    throw new Error(`This track does not fit the selected ${boardSize} x ${boardSize} board.`);
                }

                setSections(filtered as Section[]);
                setLoadedTrackName(file.name);
                loadTrackRecord(file.name);
                setPlayers([]);
                setStartGrid([]);
                setRaceDirection(1);
                setRaceStarted(false);
                setPhase("placement");
                setRaceOver(false);
                lapProgressRef.current = [];
                setError(null);
            } catch (err: any) {
                setSections([]);
                setLoadedTrackName("");
                setTrackRecord(null);
                setError(err.message);
                lapProgressRef.current = [];
            }
        };
        reader.readAsText(file);
    }

    function getBoundingBox(sections: Section[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
        if (sections.length === 0) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of sections) {
            minX = Math.min(minX, s.x);
            minY = Math.min(minY, s.y);
            maxX = Math.max(maxX, s.x);
            maxY = Math.max(maxY, s.y);
        }

        return { minX, minY, maxX, maxY };
    }
    function handleStartSpotClick(spot: StartSpot): void {
        // 🛑 Reject if already taken or race hasn't started
        if (spot.taken || !raceStarted) {
            return;
        }

        // 🛑 Reject if current player is not a real-life (human) player
        const isHuman = playerControllers[currentPlayerIndex] === "RL";
        if (!isHuman) {
            return;
        }

        // ✅ Valid click — register the player
        const driverIndex = startOrder[currentPlayerIndex] ?? currentPlayerIndex;
        const newPlayer: Player = {
            id: driverIndex + 1,
            x: spot.x,
            y: spot.y,
            dx: 0,
            dy: 0,
            color: ["red", "blue", "green", "orange"][driverIndex],
            trail: [{ x: spot.x, y: spot.y }],
            penalties: 0,
        };

        setPlayers((prev) => {
            const updated = [...prev, newPlayer];
            // 🔧 Fix: defer auto placement to next render cycle
            //setTimeout(() => autoPlaceAIPlayers(), 0);
            return updated;
        });

        setStartGrid((prev) =>
            prev.map((s) =>
                s.x === spot.x && s.y === spot.y ? { ...s, taken: true } : s
            )
        );

        setCurrentPlayerIndex((prev) => Math.min(prev + 1, playerCount - 1));
    }

    function autoPlaceAIPlayers(): void {
        let available = startGrid.filter((s) => !s.taken);
        let updatedGrid = [...startGrid];
        let newPlayers = [...players];
        let idx = newPlayers.length;

        while (idx < playerCount && playerControllers[idx] === "AI") {
            const spot = available[Math.floor(available.length / 2)] ?? available[0];
            if (!spot) break;
            available = available.filter((s) => s.x !== spot.x || s.y !== spot.y);

            updatedGrid = updatedGrid.map((s) =>
                s.x === spot.x && s.y === spot.y ? { ...s, taken: true } : s
            );

            const driverIndex = startOrder[idx] ?? idx;
            newPlayers.push({
                id: driverIndex + 1,
                x: spot.x,
                y: spot.y,
                dx: 0,
                dy: 0,
                color: ["red", "blue", "green", "orange"][driverIndex],
                trail: [{ x: spot.x, y: spot.y }],
                penalties: 0,
            });

            idx++;
        }

        setStartGrid(updatedGrid);
        setPlayers(newPlayers);
        setCurrentPlayerIndex(idx >= playerCount ? 0 : idx);
    }

    function getDotStyle(x: number, y: number): React.CSSProperties {
        return {
            position: "absolute",
            left: `${x - 6}px`, // 7px dot size → offset by 3.5 for center
            top: `${y - 5}px`,
            width: 7,
            height: 7,
            backgroundColor: "yellow",
            border: "2px solid black",
            borderRadius: "50%",
            cursor: "pointer",
            zIndex: 1000,
            opacity: 0.7,
        };
    }

    function getStartSection(): Section | null {
        return sections.find((section) => section.type === "start") ?? null;
    }

    function renderStartDirectionArrow(): React.ReactNode {
        const start = getStartSection();
        const forward = getRaceForwardVector();
        if (!start || !forward) return null;

        const cx = 45;
        const cy = 45;
        const fromX = cx - forward.x * 23;
        const fromY = cy - forward.y * 23;
        const neckX = cx + forward.x * 10;
        const neckY = cy + forward.y * 10;
        const toX = cx + forward.x * 24;
        const toY = cy + forward.y * 24;
        const halfShaft = 3.5;
        const halfHead = 8;
        const p = { x: -forward.y, y: forward.x };
        const arrowPath = [
            `M ${fromX + p.x * halfShaft} ${fromY + p.y * halfShaft}`,
            `L ${neckX + p.x * halfShaft} ${neckY + p.y * halfShaft}`,
            `L ${neckX + p.x * halfHead} ${neckY + p.y * halfHead}`,
            `L ${toX} ${toY}`,
            `L ${neckX - p.x * halfHead} ${neckY - p.y * halfHead}`,
            `L ${neckX - p.x * halfShaft} ${neckY - p.y * halfShaft}`,
            `L ${fromX - p.x * halfShaft} ${fromY - p.y * halfShaft}`,
            "Z",
        ].join(" ");

        return (
            <svg
                width={90}
                height={90}
                style={{
                    left: start.x * 90,
                    top: start.y * 90,
                    position: "absolute",
                    pointerEvents: "none",
                    zIndex: 12,
                }}
            >
                <path d={arrowPath} fill="none" stroke="rgba(255,255,255,0.9)" strokeLinejoin="round" strokeWidth={5} />
                <path d={arrowPath} fill="rgba(0,138,90,0.48)" stroke="#071b16" strokeLinejoin="round" strokeWidth={1.5} />
            </svg>
        );
    }

    // Get start/finish line orientation & forward direction, in pixels
    function getStartLine() {
        const core = toCoreSections(sections);
        let start: CoreSection | null = null;
        for (let i = 0; i < core.length; i++) { if (core[i].type === "start") { start = core[i]; break; } }
        console.assert(!!start, "start tile must exist");
        if (!start) return null;

        const rot = ((start.rotation % 360) + 360) % 360;
        const tileLeft = start.x * TILE;
        const tileTop = start.y * TILE;
        const midX = tileLeft + TILE / 2;
        const midY = tileTop + TILE / 2;
        const spanStartX = tileLeft;
        const spanEndX = tileLeft + TILE;
        const spanStartY = tileTop;
        const spanEndY = tileTop + TILE;

        if (rot === 0) return { kind: "vertical" as const, coord: midX, forwardSign: +1, spanStart: spanStartY, spanEnd: spanEndY };
        if (rot === 180) return { kind: "vertical" as const, coord: midX, forwardSign: -1, spanStart: spanStartY, spanEnd: spanEndY };
        if (rot === 90) return { kind: "horizontal" as const, coord: midY, forwardSign: +1, spanStart: spanStartX, spanEnd: spanEndX };
        return { kind: "horizontal" as const, coord: midY, forwardSign: -1, spanStart: spanStartX, spanEnd: spanEndX };
    }

    function getRaceForwardVector(): { x: number; y: number } | null {
        const line = getStartLine();
        if (!line) return null;
        return line.kind === "vertical"
            ? { x: line.forwardSign * raceDirection, y: 0 }
            : { x: 0, y: line.forwardSign * raceDirection };
    }

    // Did segment (x0,y0)→(x1,y1) cross the line forward? If yes, return overrun px; else 0.
    // Did the segment cross the painted start/finish stripe forward? If yes, return overrun px; else 0.
    function forwardCrossOverrun(x0: number, y0: number, x1: number, y1: number): number {
        const line = getStartLine();
        console.assert(!!line, "start line must exist");
        if (!line) return 0;
        const forwardSign = line.forwardSign * raceDirection;
        const EPS = 1e-6;

        if (line.kind === "vertical") {
            const dx = x1 - x0;
            if (Math.abs(dx) < EPS) return 0;

            // Signed distance to finish line along race-forward axis.
            const d0 = (x0 - line.coord) * forwardSign;
            const d1 = (x1 - line.coord) * forwardSign;
            if (!(d0 <= 0 && d1 > 0)) return 0;

            const t = (line.coord - x0) / dx;
            if (t < -EPS || t > 1 + EPS) return 0;
            const crossY = y0 + (y1 - y0) * t;
            if (crossY < line.spanStart - 1 || crossY > line.spanEnd + 1) return 0;

            return Math.max(0, d1);
        }

        const dy = y1 - y0;
        if (Math.abs(dy) < EPS) return 0;

        // Signed distance to finish line along race-forward axis.
        const d0 = (y0 - line.coord) * forwardSign;
        const d1 = (y1 - line.coord) * forwardSign;
        if (!(d0 <= 0 && d1 > 0)) return 0;

        const t = (line.coord - y0) / dy;
        if (t < -EPS || t > 1 + EPS) return 0;
        const crossX = x0 + (x1 - x0) * t;
        if (crossX < line.spanStart - 1 || crossX > line.spanEnd + 1) return 0;

        return Math.max(0, d1);
    }
    const bbox = getBoundingBox(sections);
    return (
        <div className="flex flex-col items-center gap-4 w-full">
            <h2>Play Mode</h2>

            {/* Load & Clear Buttons */}
            {!raceStarted ? (
                <div style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "end" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: "bold" }}>
                        Board size
                        <select
                            value={boardSize}
                            onChange={(event) => {
                                setBoardSize(Number(event.target.value) as BoardSize);
                                resetLoadedRace();
                            }}
                            style={{ padding: "8px", minWidth: 150 }}
                        >
                            <option value={400}>Small 400 x 400</option>
                            <option value={600}>Medium 600 x 600</option>
                            <option value={900}>Large 900 x 900</option>
                            <option value={1200}>Huge 1200 x 1200</option>
                        </select>
                    </label>

                    <button
                        onClick={handleLoadClick}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "#003399",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold"
                        }}
                    >
                        📂 Load Track
                    </button>

                    <button
                        onClick={resetLoadedRace}
                        disabled={!hasLoadedTrack}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "#cc0000",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: hasLoadedTrack ? "pointer" : "not-allowed",
                            fontWeight: "bold"
                        }}
                    >
                        🧹 Clear Track
                    </button>
                </div>
            ) : (
                <div style={{ alignItems: "center", display: "flex", gap: 12, marginBottom: "8px" }}>
                    <div style={{ color: "#334", fontWeight: 700 }}>
                        {raceOver
                            ? "Race complete"
                            : phase === "placement"
                                ? playerControllers[currentPlayerIndex] === "RL" ? "Select your starting position" : `AI selecting position ${currentPlayerIndex + 1}`
                                : `Racing: ${playerControllers[currentPlayerIndex] === "RL" ? "your move" : `AI driver ${currentPlayerIndex + 1}`}`}
                    </div>
                    {eventMessage && (
                        <div style={{ color: "#8b1e1e", fontWeight: 800 }}>
                            {eventMessage}
                        </div>
                    )}
                    {phase === "race" && (
                        <div style={{ color: "#566", fontWeight: 700 }}>
                            Turn {Math.max(0, ...moveCounts) + 1}
                        </div>
                    )}
                    <button
                        onClick={restartRace}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "#003399",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold"
                        }}
                    >
                        Restart Race
                    </button>
                    <button
                        onClick={() => {
                            setRaceStarted(false);
                            setPlayerCount(2);
                            setPlayerControllers(["RL", "AI", "AI", "AI"]);
                            setRaceLevel("novice");
                            setRaceDirection(1);
                            setStartOrder([0, 1, 2, 3]);
                            setPlayers([]);             // ✅ Clear player dots
                            setStartGrid([]);           // ✅ Clear start positions
                            setCurrentPlayerIndex(0);   // ✅ Reset turn logic
                            setEventMessage(null);
                        }}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "#990000",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold"
                        }}
                    >
                        Cancel Race
                    </button>
                </div>
            )}


            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileChange} />

            {/* Error Display */}
            {error && (
                <div style={{ color: "red", marginTop: "8px" }}>
                    <strong>Error:</strong> {error}
                </div>
            )}
            {loadedTrackName && (
                <div style={{ color: "#566", fontSize: 13, fontWeight: 700 }}>
                    Track: {loadedTrackName}
                    {trackRecord ? ` | Record: ${trackRecord.turns} turns by ${trackRecord.trigram}` : " | No record yet"}
                </div>
            )}

            {/* Player Setup (before race starts) */}
            {!raceStarted && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                    <div>
                        <label style={{ marginRight: "8px", fontWeight: "bold" }}>Level:</label>
                        <select
                            value={raceLevel}
                            onChange={(e) => {
                                const level = e.target.value as RaceLevel;
                                setRaceLevel(level);
                            }}
                            style={{ marginBottom: "8px" }}
                        >
                            <option value="novice">Novice</option>
                            <option value="pro">Pro Driver</option>
                            <option value="king">King</option>
                        </select>
                    </div>

                    <div>
                        <label style={{ marginRight: "8px", fontWeight: "bold" }}>Race direction:</label>
                        <button
                            onClick={() => setRaceDirection((current) => current === 1 ? -1 : 1)}
                            disabled={!hasLoadedTrack}
                            style={{
                                padding: "6px 12px",
                                backgroundColor: hasLoadedTrack ? "#004c99" : "#999",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: hasLoadedTrack ? "pointer" : "not-allowed",
                                fontWeight: "bold",
                            }}
                        >
                            Reverse direction
                        </button>
                    </div>

                    <div>
                        <label style={{ marginRight: "8px", fontWeight: "bold" }}>Players:</label>
                        <select
                            value={playerCount}
                            onChange={(e) => {
                                const count = parseInt(e.target.value);
                                setPlayerCount(count);
                                setPlayerControllers((prev) => {
                                    const updated = [...prev];
                                    while (updated.length < count) updated.push("AI");
                                    const sliced = updated.slice(0, count);
                                    sliced[0] = "RL"; // ✅ Enforce first player is always RL
                                    while (sliced.length < 4) sliced.push("AI");
                                    return sliced;
                                });
                            }}
                        >
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                            <option value={4}>4</option>
                        </select>
                    </div>

                    <div>
                        <strong>Player 1:</strong> You
                    </div>

                    {Array.from({ length: playerCount - 1 }, (_, i) => (
                        <div key={i + 1}>
                            <label style={{ marginRight: "8px" }}>Player {i + 2}:</label>
                            <button
                                onClick={() => {
                                    setPlayerControllers((prev) => {
                                        const updated = [...prev];
                                        updated[i + 1] = updated[i + 1] === "AI" ? "RL" : "AI";
                                        return updated;
                                    });
                                }}
                                style={{
                                    padding: "4px 12px",
                                    backgroundColor: playerControllers[i + 1] === "AI" ? "#999" : "#0a0",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                    fontWeight: "bold",
                                }}
                            >
                                {playerControllers[i + 1] === "AI" ? "🤖 AI" : "👤 RL"}
                            </button>
                        </div>
                    ))}

                    <button
                        onClick={() => {
                            if (!hasLoadedTrack) {
                                alert("⚠️ Please load a track before starting the race.");
                                return;
                            }

                            // Use only core tiles for start-grid computation, and map to shared type
                            const coreSections: CoreSection[] = sections.reduce<CoreSection[]>((acc, s) => {
                                if (isCoreType(s.type)) {
                                    acc.push({
                                        id: s.id,
                                        type: s.type, // now correctly narrowed
                                        x: s.x,
                                        y: s.y,
                                        rotation: s.rotation,
                                    });
                                }
                                return acc;
                            }, []);

                            console.assert(Array.isArray(coreSections), "coreSections must be an array");

                            const grid = getStartGrid(coreSections);
                            if (grid.length === 0) {
                                alert("⚠️ No valid start positions found.");
                                return;
                            }

                            const order = getStartOrder(raceLevel, playerCount);
                            const orderedControllers = applyStartOrder(playerControllers.slice(0, playerCount), order);
                            while (orderedControllers.length < 4) orderedControllers.push("AI");

                            setStartOrder(order);
                            setPlayerControllers(orderedControllers as ("AI" | "RL")[]);
                            setStartGrid(grid);
                            setPlayers([]);
                            setCurrentPlayerIndex(0);

                            // Begin in placement phase
                            setRaceStarted(true);
                            setPhase("placement");

                            setMoveCounts(Array(playerCount).fill(0));
                            setFinished(Array(playerCount).fill(false));
                            setOverrun(Array(playerCount).fill(0));
                            setRaceOver(false);
                            lapProgressRef.current = Array(playerCount).fill(-100000);

                            const humanSlot = order.indexOf(0);
                            if (raceLevel !== "novice" && humanSlot >= 0) {
                                alert(`You are running ${humanSlot + 1}${humanSlot === 0 ? "st" : humanSlot === 1 ? "nd" : humanSlot === 2 ? "rd" : "th"}.`);
                            }

                        }}


                        disabled={!hasLoadedTrack}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: hasLoadedTrack ? "#007700" : "#777",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            cursor: hasLoadedTrack ? "pointer" : "not-allowed",
                            fontWeight: "bold"
                        }}
                    >
                        🚦 Start Race
                    </button>
                </div>
            )}

            {/* Grid & Tiles */}
            <div
                style={{
                    width: boardWidth,
                    height: boardHeight,
                    background: "#f0f0f0",
                    border: "2px dashed gray",
                    display: "grid",
                    gridTemplateColumns: `repeat(${cols}, ${gridUnit}px)`,
                    gridTemplateRows: `repeat(${rows}, ${gridUnit}px)`,
                    position: "relative",
                }}
            >
                {/* Grid cells */}
                {Array.from({ length: rows * cols }).map((_, i) => (
                    <div key={`cell-${i}`} style={{ border: "1px solid #ccc" }} />
                ))}

                {/* Track tiles */}
                {sections.map((section) => {
                    const isCore = section.type === "start" || section.type === "straight" || section.type === "curve90";
                    return (
                        <div
                            key={section.id}
                            style={{
                                gridColumnStart: section.x + 1,
                                gridRowStart: section.y + 1,
                                position: "relative",
                                width: "90px",
                                height: "90px",
                                transform: `rotate(${section.rotation}deg)`,
                                transformOrigin: "center",
                                zIndex: isCore ? 1 : 0,   // decorations below track
                            }}
                        >
                            <img
                                src={imageMap[section.type]}
                                alt={section.type}
                                style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
                            />
                        </div>

                    );
                })}
                {renderStartDirectionArrow()}
                {/* ✅ Clickable player placement spots */}
                {phase === "placement" &&
                    raceStarted &&
                    playerControllers[currentPlayerIndex] === "RL" &&
                    players.length === currentPlayerIndex &&
                    (() => {
                        return startGrid.filter(s => !s.taken).map((s, idx) => (
                            <div
                                key={`start-${idx}`}
                                onClick={() => handleStartSpotClick(s)}
                                style={getDotStyle(s.x, s.y)}
                            />
                        ));
                    })()}
                {/* 🔴 Show all players (RL = red, AI = gray) */}
                {(() => {
                    return players.map((player, idx) => {
                        return (
                            <div
                                key={`player-start-${idx}`}
                                style={{
                                    position: "absolute",
                                    left: `${player.x - 6}px`,
                                    top: `${player.y - 5}px`,
                                    width: 7,
                                    height: 7,
                                    backgroundColor: playerControllers[idx] === "RL" ? "red" : "#666",
                                    border: "2px solid black",
                                    borderRadius: "50%",
                                    zIndex: 10,
                                }}
                            />
                        );
                    });
                })()}
                {/* Grid overlay */}
                {bbox && (
                    <GlobalGridOverlay
                        spacing={15}
                        tileSize={gridUnit}
                        x={bbox.minX}
                        y={bbox.minY}
                        cols={bbox.maxX - bbox.minX + 1}
                        rows={bbox.maxY - bbox.minY + 1}
                        sections={sections.filter(s => isCoreType(s.type)) as unknown as CoreSection[]}
                    />
                )}
                {phase === "race" && (
                    <GameCanvas
                        size={boardWidth}
                        tileSize={90}
                        spacing={15}
                        sections={
                            sections.filter(s => isCoreType(s.type)) as unknown as CoreSection[]
                        }
                        players={players}
                        currentPlayerIndex={currentPlayerIndex}
                        onCommitMove={commitMove}
                        showValidDots={playerControllers[currentPlayerIndex] === "RL" && !finished[currentPlayerIndex] && !raceOver}
                        raceForward={getRaceForwardVector()}
                        normalizeMoves={normalizeRaceMoves}
                        enableClicks={playerControllers[currentPlayerIndex] === "RL" && !finished[currentPlayerIndex] && !raceOver}
                    />
                )}
            </div>
        </div>

    );
};








