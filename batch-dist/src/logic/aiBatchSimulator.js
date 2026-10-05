"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resultsToCsv = exports.summarizeResults = exports.simulateAiRun = void 0;
const getValidMovesForPlayer_1 = require("./getValidMovesForPlayer");
const startGrid_1 = require("./startGrid");
const trackMaskGeometry_1 = require("./trackMaskGeometry");
const DEPTH = { novice: 4, pro: 6, king: 12 };
const BUDGET = { novice: 2500, pro: 6000, king: 12000 };
const PRUNE = { novice: 5, pro: 6, king: 8 };
const BEAM_WIDTH = { novice: 14, pro: 24, king: 36 };
const MAX_TURNS = 260;
const BASE_RUN_MS = { novice: 10000, pro: 20000, king: 45000 };
const MAX_RUN_MS = 120000;
const trackCaches = new WeakMap();
function getTrackCache(sections) {
    let cache = trackCaches.get(sections);
    if (!cache) {
        cache = { samples: new Map() };
        trackCaches.set(sections, cache);
    }
    return cache;
}
function getRunTimeLimitMs(sections, level) {
    const scale = Math.max(1, sections.length / 20);
    return Math.min(MAX_RUN_MS, Math.round(BASE_RUN_MS[level] * scale));
}
function normalizeRotation(rotation) {
    return ((rotation % 360) + 360) % 360;
}
function getConnections(type, rotation) {
    const normalized = normalizeRotation(rotation);
    if (type === "start" || type === "straight")
        return normalized % 180 === 0 ? ["left", "right"] : ["top", "bottom"];
    if (normalized === 0)
        return ["bottom", "right"];
    if (normalized === 90)
        return ["left", "bottom"];
    if (normalized === 180)
        return ["top", "left"];
    return ["right", "top"];
}
function dirOffset(dir) {
    if (dir === "top")
        return { x: 0, y: -1 };
    if (dir === "bottom")
        return { x: 0, y: 1 };
    if (dir === "left")
        return { x: -1, y: 0 };
    return { x: 1, y: 0 };
}
function reverseDir(dir) {
    if (dir === "top")
        return "bottom";
    if (dir === "bottom")
        return "top";
    if (dir === "left")
        return "right";
    return "left";
}
function startForwardDirection(rotation) {
    const normalized = normalizeRotation(rotation);
    if (normalized === 0)
        return "right";
    if (normalized === 90)
        return "bottom";
    if (normalized === 180)
        return "left";
    return "top";
}
function buildTrackOrder(sections) {
    const cache = getTrackCache(sections);
    if (cache.order)
        return cache.order;
    const start = sections.find((section) => section.type === "start");
    if (!start) {
        cache.order = sections;
        return sections;
    }
    const byKey = new Map(sections.map((section) => [`${section.x},${section.y}`, section]));
    const ordered = [start];
    const visited = new Set([`${start.x},${start.y}`]);
    let current = start;
    let previousKey = null;
    for (let guard = 0; guard < sections.length + 2; guard++) {
        let next = null;
        const connections = getConnections(current.type, current.rotation);
        const forward = startForwardDirection(start.rotation);
        const dirs = previousKey === null && current.id === start.id
            ? [forward, ...connections.filter((dir) => dir !== forward)]
            : connections;
        for (const dir of dirs) {
            const offset = dirOffset(dir);
            const key = `${current.x + offset.x},${current.y + offset.y}`;
            if (key === previousKey)
                continue;
            const candidate = byKey.get(key);
            if (!candidate)
                continue;
            if (!getConnections(candidate.type, candidate.rotation).includes(reverseDir(dir)))
                continue;
            next = candidate;
            break;
        }
        if (!next)
            break;
        const nextKey = `${next.x},${next.y}`;
        if (visited.has(nextKey))
            break;
        ordered.push(next);
        visited.add(nextKey);
        previousKey = `${current.x},${current.y}`;
        current = next;
    }
    cache.order = ordered;
    return ordered;
}
function getTileAt(x, y, sections) {
    const cache = getTrackCache(sections);
    if (!cache.tileMap) {
        cache.tileMap = new Map(sections.map((section) => [`${section.x},${section.y}`, section]));
    }
    const tx = Math.floor(x / trackMaskGeometry_1.TILE);
    const ty = Math.floor(y / trackMaskGeometry_1.TILE);
    for (let ox = 0; ox >= -1; ox--) {
        for (let oy = 0; oy >= -1; oy--) {
            const section = cache.tileMap.get(`${tx + ox},${ty + oy}`);
            if (section &&
                x >= section.x * trackMaskGeometry_1.TILE &&
                x <= section.x * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE &&
                y >= section.y * trackMaskGeometry_1.TILE &&
                y <= section.y * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE) {
                return section;
            }
        }
    }
    return null;
}
function sampleRaceValue(x, y, sections) {
    var _a, _b;
    const cache = getTrackCache(sections);
    const sampleKey = `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    if (cache.samples.has(sampleKey))
        return (_a = cache.samples.get(sampleKey)) !== null && _a !== void 0 ? _a : null;
    const order = buildTrackOrder(sections);
    const points = (_b = cache.points) !== null && _b !== void 0 ? _b : (() => {
        const nextPoints = order.map((section) => ({ x: section.x * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE / 2, y: section.y * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE / 2 }));
        if (nextPoints.length > 2)
            nextPoints.push(nextPoints[0]);
        cache.points = nextPoints;
        return nextPoints;
    })();
    if (points.length < 2)
        return null;
    let best = null;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const lenSq = Math.max(1, vx * vx + vy * vy);
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / lenSq));
        const px = a.x + vx * t;
        const py = a.y + vy * t;
        const len = Math.max(1, Math.hypot(vx, vy));
        const sample = {
            progress: i + t,
            tangent: { x: vx / len, y: vy / len },
            distance: Math.hypot(x - px, y - py),
        };
        if (!best || sample.distance < best.distance)
            best = sample;
    }
    cache.samples.set(sampleKey, best);
    return best;
}
function roadCenterPenalty(x, y, sections) {
    const sample = sampleRaceValue(x, y, sections);
    return sample ? sample.distance : 10000;
}
function getStartLine(sections) {
    const start = sections.find((section) => section.type === "start");
    if (!start)
        return null;
    const rot = normalizeRotation(start.rotation);
    const midX = start.x * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE / 2;
    const midY = start.y * trackMaskGeometry_1.TILE + trackMaskGeometry_1.TILE / 2;
    if (rot === 0)
        return { kind: "vertical", coord: midX, forwardSign: 1 };
    if (rot === 180)
        return { kind: "vertical", coord: midX, forwardSign: -1 };
    if (rot === 90)
        return { kind: "horizontal", coord: midY, forwardSign: 1 };
    return { kind: "horizontal", coord: midY, forwardSign: -1 };
}
function forwardCrossOverrun(x0, y0, x1, y1, sections) {
    const line = getStartLine(sections);
    if (!line)
        return 0;
    if (line.kind === "vertical") {
        if (line.forwardSign > 0 && x0 < line.coord && x1 >= line.coord)
            return x1 - line.coord;
        if (line.forwardSign < 0 && x0 > line.coord && x1 <= line.coord)
            return line.coord - x1;
    }
    else {
        if (line.forwardSign > 0 && y0 < line.coord && y1 >= line.coord)
            return y1 - line.coord;
        if (line.forwardSign < 0 && y0 > line.coord && y1 <= line.coord)
            return line.coord - y1;
    }
    return 0;
}
function eligibleToFinish(player, sections) {
    const sample = sampleRaceValue(player.x, player.y, sections);
    const order = buildTrackOrder(sections);
    return !!sample && sample.progress >= Math.max(1, order.length - 2);
}
function getOrderedTileIndexAt(x, y, order) {
    const tile = getTileAt(x, y, order);
    if (!tile)
        return -1;
    return order.findIndex((section) => section.id === tile.id);
}
function approachedFinishAfterLap(player, move, sections) {
    var _a;
    const order = buildTrackOrder(sections);
    if (order.length < 3)
        return false;
    const finishZoneIndex = Math.max(1, order.length - 2);
    const currentIndex = getOrderedTileIndexAt(player.x, player.y, order);
    const nextIndex = getOrderedTileIndexAt(move.x, move.y, order);
    if (currentIndex >= finishZoneIndex || nextIndex >= finishZoneIndex)
        return true;
    const trail = (_a = player.trail) !== null && _a !== void 0 ? _a : [];
    const start = Math.max(0, trail.length - 4);
    for (let i = start; i < trail.length; i++) {
        if (getOrderedTileIndexAt(trail[i].x, trail[i].y, order) >= finishZoneIndex)
            return true;
    }
    return false;
}
function finishedMove(player, move, sections) {
    if (!eligibleToFinish(player, sections) && !approachedFinishAfterLap(player, move, sections))
        return false;
    if (forwardCrossOverrun(player.x, player.y, move.x, move.y, sections) > 0)
        return true;
    const order = buildTrackOrder(sections);
    const currentIndex = getOrderedTileIndexAt(player.x, player.y, order);
    const nextIndex = getOrderedTileIndexAt(move.x, move.y, order);
    return currentIndex >= order.length - 2 && nextIndex === 0;
}
function localPointInTile(x, y, tile) {
    const rawX = x - tile.x * trackMaskGeometry_1.TILE;
    const rawY = y - tile.y * trackMaskGeometry_1.TILE;
    const cx = trackMaskGeometry_1.TILE / 2;
    const cy = trackMaskGeometry_1.TILE / 2;
    const dx = rawX - cx;
    const dy = rawY - cy;
    const normalized = normalizeRotation(tile.rotation);
    if (normalized === 90)
        return { x: cx + dy, y: cy - dx };
    if (normalized === 180)
        return { x: cx - dx, y: cy - dy };
    if (normalized === 270)
        return { x: cx - dy, y: cy + dx };
    return { x: rawX, y: rawY };
}
function getRaceDirectionAt(x, y, sections) {
    var _a;
    const order = buildTrackOrder(sections);
    const tile = getTileAt(x, y, order);
    const sample = sampleRaceValue(x, y, sections);
    if (!tile || !sample)
        return (_a = sample === null || sample === void 0 ? void 0 : sample.tangent) !== null && _a !== void 0 ? _a : null;
    if (tile.type !== "curve90")
        return sample.tangent;
    const local = localPointInTile(x, y, tile);
    const tangent = { x: -(local.y - trackMaskGeometry_1.TILE), y: local.x - trackMaskGeometry_1.TILE };
    const len = Math.max(1, Math.hypot(tangent.x, tangent.y));
    return { x: tangent.x / len, y: tangent.y / len };
}
function isMoveValueLegal(player, move, sections) {
    if (move.crash)
        return false;
    if (finishedMove(player, move, sections))
        return true;
    const from = sampleRaceValue(player.x, player.y, sections);
    const to = sampleRaceValue(move.x, move.y, sections);
    if (!from || !to)
        return false;
    const travelX = move.x - player.x;
    const travelY = move.y - player.y;
    return to.progress >= from.progress - 0.02 && travelX * from.tangent.x + travelY * from.tangent.y >= -0.2;
}
function snapCrashMove(player, move, sections) {
    if (!move.crash)
        return move;
    const from = sampleRaceValue(player.x, player.y, sections);
    if (!from)
        return move;
    const anchor = { x: move.safeX, y: move.safeY };
    const candidates = [getTileAt(anchor.x, anchor.y, sections), getTileAt(player.x, player.y, sections)]
        .filter((section, index, list) => !!section && list.findIndex((item) => (item === null || item === void 0 ? void 0 : item.id) === section.id) === index);
    let best = null;
    for (const section of candidates.length > 0 ? candidates : sections) {
        const left = section.x * trackMaskGeometry_1.TILE;
        const top = section.y * trackMaskGeometry_1.TILE;
        for (let x = left; x <= left + trackMaskGeometry_1.TILE; x += trackMaskGeometry_1.GRID) {
            for (let y = top; y <= top + trackMaskGeometry_1.TILE; y += trackMaskGeometry_1.GRID) {
                if (!(0, trackMaskGeometry_1.isPointOnTrack)(x, y, sections))
                    continue;
                const sample = sampleRaceValue(x, y, sections);
                if (!sample)
                    continue;
                const forward = sample.progress >= from.progress - 0.05;
                const score = Math.hypot(x - anchor.x, y - anchor.y) * 100 + (forward ? 0 : 10000);
                if (!best || (forward && !best.forward) || (forward === best.forward && score < best.score)) {
                    best = { x, y, score, forward };
                }
            }
        }
    }
    return best ? { ...move, safeX: best.x, safeY: best.y } : move;
}
function postCrashDirectionScore(player, move, sections) {
    var _a, _b;
    const direction = (_a = getRaceDirectionAt(player.x, player.y, sections)) !== null && _a !== void 0 ? _a : (_b = sampleRaceValue(player.x, player.y, sections)) === null || _b === void 0 ? void 0 : _b.tangent;
    const travelX = move.x - player.x;
    const travelY = move.y - player.y;
    const directionGain = direction ? travelX * direction.x + travelY * direction.y : 0;
    const centerGain = roadCenterPenalty(player.x, player.y, sections) - roadCenterPenalty(move.x, move.y, sections);
    return directionGain * 100 + centerGain;
}
function filterPostCrashMoves(player, moves, sections) {
    if (!(player.dx === 0 && player.dy === 0 && player.penalties > 0) || moves.length <= 1)
        return moves;
    const forward = moves.filter((move) => postCrashDirectionScore(player, move, sections) > -1);
    const candidates = forward.length > 0 ? forward : moves;
    const center = candidates.filter((move) => roadCenterPenalty(move.x, move.y, sections) <= roadCenterPenalty(player.x, player.y, sections) + 2);
    return center.length > 0 ? center : candidates;
}
function normalizeMoves(player, moves, sections) {
    return moves.map((move) => snapCrashMove(player, move, sections));
}
function legalMoves(player, sections, level) {
    const moves = normalizeMoves(player, (0, getValidMovesForPlayer_1.getValidMovesForPlayer)(player, sections), sections)
        .filter((move) => isMoveValueLegal(player, move, sections));
    const filtered = filterPostCrashMoves(player, moves, sections);
    return filtered
        .sort((a, b) => terminalScore({ ...player, x: b.x, y: b.y, dx: b.dx, dy: b.dy }, sections) -
        terminalScore({ ...player, x: a.x, y: a.y, dx: a.dx, dy: a.dy }, sections))
        .slice(0, PRUNE[level]);
}
function moveLandingKey(move) {
    return `${move.crash ? move.safeX : move.x},${move.crash ? move.safeY : move.y}`;
}
function playerPositionKey(player) {
    return `${player.x},${player.y}`;
}
function occupiedKeys(players, activeId) {
    return new Set(players.filter((player) => player.id !== activeId).map(playerPositionKey));
}
function legalMovesForRace(player, sections, level, occupied) {
    return legalMoves(player, sections, level).filter((move) => !occupied.has(moveLandingKey(move)));
}
function fallbackMoveForRace(player, sections, occupied) {
    var _a;
    const candidates = normalizeMoves(player, (0, getValidMovesForPlayer_1.getValidMovesForPlayer)(player, sections), sections)
        .filter((move) => !occupied.has(moveLandingKey(move)));
    const safe = candidates
        .filter((move) => !move.crash && isMoveValueLegal(player, move, sections))
        .sort((a, b) => terminalScore({ ...player, x: b.x, y: b.y, dx: b.dx, dy: b.dy }, sections) -
        terminalScore({ ...player, x: a.x, y: a.y, dx: a.dx, dy: a.dy }, sections));
    if (safe.length > 0)
        return safe[0];
    return (_a = candidates
        .sort((a, b) => terminalScore({ ...player, x: b.safeX, y: b.safeY, dx: 0, dy: 0 }, sections) -
        terminalScore({ ...player, x: a.safeX, y: a.safeY, dx: 0, dy: 0 }, sections))[0]) !== null && _a !== void 0 ? _a : null;
}
function terminalScore(player, sections) {
    const sample = sampleRaceValue(player.x, player.y, sections);
    if (!sample)
        return -1e9;
    return sample.progress * 1000 + Math.hypot(player.dx, player.dy) * 4 - roadCenterPenalty(player.x, player.y, sections) * 1.2;
}
function beamSearch(player, sections, level, depth, budget, state, occupied = new Set()) {
    var _a;
    let beam = [{
            player,
            firstMove: null,
            path: [],
            score: terminalScore(player, sections),
            complete: false,
        }];
    let best = beam[0];
    for (let step = 0; step < depth; step++) {
        const nextBeam = [];
        for (const node of beam) {
            if (node.complete) {
                nextBeam.push(node);
                continue;
            }
            if (state.iterations >= budget || Date.now() >= state.deadline)
                break;
            const moves = legalMovesForRace(node.player, sections, level, occupied);
            if (moves.length === 0) {
                nextBeam.push({ ...node, score: terminalScore(node.player, sections) - 100000 });
                continue;
            }
            for (const move of moves) {
                if (state.iterations >= budget || Date.now() >= state.deadline)
                    break;
                state.iterations += 1;
                const nextPlayer = { ...node.player, x: move.x, y: move.y, dx: move.dx, dy: move.dy };
                const finished = finishedMove(node.player, move, sections);
                const score = finished ? 1000000 + (depth - step) : terminalScore(nextPlayer, sections);
                nextBeam.push({
                    player: nextPlayer,
                    firstMove: (_a = node.firstMove) !== null && _a !== void 0 ? _a : move,
                    path: [...node.path, move],
                    score,
                    complete: finished || step === depth - 1,
                });
            }
        }
        if (nextBeam.length === 0)
            break;
        nextBeam.sort((a, b) => (a.complete === b.complete ? b.score - a.score : a.complete ? -1 : 1));
        best = nextBeam[0];
        beam = nextBeam.slice(0, BEAM_WIDTH[level]);
        if (best.score >= 1000000)
            break;
    }
    return {
        move: best.firstMove,
        path: best.path,
        score: best.score,
        complete: best.complete,
    };
}
function pickStart(grid, runIndex) {
    if (grid.length === 0)
        return null;
    return grid[runIndex % grid.length];
}
function pickStartPlayers(grid, runIndex, count) {
    if (grid.length < count)
        return [];
    const startIndex = runIndex % grid.length;
    const ordered = [...grid.slice(startIndex), ...grid.slice(0, startIndex)];
    return ordered.slice(0, count);
}
function leadingPlayer(players, sections) {
    return [...players].sort((a, b) => { var _a, _b, _c, _d; return ((_b = (_a = sampleRaceValue(b.x, b.y, sections)) === null || _a === void 0 ? void 0 : _a.progress) !== null && _b !== void 0 ? _b : -1) - ((_d = (_c = sampleRaceValue(a.x, a.y, sections)) === null || _c === void 0 ? void 0 : _c.progress) !== null && _d !== void 0 ? _d : -1); })[0];
}
function simulateAiRun(track, level, run, options = {}) {
    var _a, _b, _c, _d, _e, _f;
    const deadline = Date.now() + ((_a = options.cpuLimitMs) !== null && _a !== void 0 ? _a : getRunTimeLimitMs(track.sections, level));
    const grid = (0, startGrid_1.getStartGrid)(track.sections);
    const aiCount = (_b = options.aiCount) !== null && _b !== void 0 ? _b : 1;
    const starts = aiCount === 1
        ? [pickStart(grid, run)].filter((start) => !!start)
        : pickStartPlayers(grid, run, aiCount);
    if (starts.length < aiCount) {
        return { track: track.name, level, run, aiCount, status: "no-start", turns: 0, crashes: 0, iterations: 0, maxProgress: 0, finishCrossings: 0, finalX: 0, finalY: 0 };
    }
    let players = starts.map((start, index) => {
        var _a;
        return ({
            id: index + 1,
            x: start.x,
            y: start.y,
            dx: 0,
            dy: 0,
            color: (_a = ["red", "blue", "green", "purple", "orange"][index]) !== null && _a !== void 0 ? _a : "red",
            trail: [{ x: start.x, y: start.y }],
            penalties: 0,
        });
    });
    let totalIterations = 0;
    let maxProgress = Math.max(...players.map((player) => { var _a, _b; return (_b = (_a = sampleRaceValue(player.x, player.y, track.sections)) === null || _a === void 0 ? void 0 : _a.progress) !== null && _b !== void 0 ? _b : 0; }));
    let finishCrossings = 0;
    let totalMoves = 0;
    for (let round = 1; round <= MAX_TURNS; round++) {
        for (const current of players) {
            if (Date.now() >= deadline) {
                const leader = leadingPlayer(players, track.sections);
                return { track: track.name, level, run, aiCount, status: "cpu-limit", turns: totalMoves, crashes: players.reduce((sum, player) => sum + player.penalties, 0), iterations: totalIterations, maxProgress, finishCrossings, finalX: leader.x, finalY: leader.y };
            }
            const occupied = occupiedKeys(players, current.id);
            const state = { iterations: 0, deadline };
            const plan = beamSearch(current, track.sections, level, DEPTH[level], BUDGET[level], state, occupied);
            totalIterations += state.iterations;
            const move = (_c = plan.move) !== null && _c !== void 0 ? _c : fallbackMoveForRace(current, track.sections, occupied);
            if (!move) {
                const leader = leadingPlayer(players, track.sections);
                return { track: track.name, level, run, aiCount, status: "stuck", turns: totalMoves, crashes: players.reduce((sum, player) => sum + player.penalties, 0), iterations: totalIterations, maxProgress, finishCrossings, finalX: leader.x, finalY: leader.y };
            }
            if (!move.crash && forwardCrossOverrun(current.x, current.y, move.x, move.y, track.sections) > 0) {
                finishCrossings += 1;
            }
            const finished = !move.crash && finishedMove(current, move, track.sections);
            players = players.map((player) => player.id === current.id ? {
                ...player,
                x: move.crash ? move.safeX : move.x,
                y: move.crash ? move.safeY : move.y,
                dx: move.crash ? 0 : move.dx,
                dy: move.crash ? 0 : move.dy,
                penalties: player.penalties + (move.crash ? 1 : 0),
                trail: [...player.trail, { x: move.crash ? move.safeX : move.x, y: move.crash ? move.safeY : move.y }],
            } : player);
            totalMoves += 1;
            const updated = (_d = players.find((player) => player.id === current.id)) !== null && _d !== void 0 ? _d : current;
            maxProgress = Math.max(maxProgress, (_f = (_e = sampleRaceValue(updated.x, updated.y, track.sections)) === null || _e === void 0 ? void 0 : _e.progress) !== null && _f !== void 0 ? _f : maxProgress);
            if (finished) {
                return { track: track.name, level, run, aiCount, winnerId: current.id, finishedPlayers: 1, status: "finished", turns: totalMoves, crashes: players.reduce((sum, player) => sum + player.penalties, 0), iterations: totalIterations, maxProgress, finishCrossings, finalX: updated.x, finalY: updated.y };
            }
        }
    }
    const leader = leadingPlayer(players, track.sections);
    return { track: track.name, level, run, aiCount, status: "timeout", turns: totalMoves, crashes: players.reduce((sum, player) => sum + player.penalties, 0), iterations: totalIterations, maxProgress, finishCrossings, finalX: leader.x, finalY: leader.y };
}
exports.simulateAiRun = simulateAiRun;
function summarizeResults(results) {
    var _a, _b, _c;
    const summary = {};
    for (const result of results) {
        const status = result.status;
        const key = `${result.track} | ${result.level}`;
        const row = (_a = summary[key]) !== null && _a !== void 0 ? _a : { runs: 0, finished: 0, avgTurns: 0, crashes: 0, timeouts: 0, cpuLimits: 0, avgMaxProgress: 0, finishCrossings: 0 };
        row.runs += 1;
        row.finished += status === "finished" ? 1 : 0;
        row.avgTurns += result.turns;
        row.crashes += result.crashes;
        row.timeouts += status === "timeout" ? 1 : 0;
        row.cpuLimits += status === "cpu-limit" || status === "time-limit" ? 1 : 0;
        row.avgMaxProgress += (_b = result.maxProgress) !== null && _b !== void 0 ? _b : 0;
        row.finishCrossings += (_c = result.finishCrossings) !== null && _c !== void 0 ? _c : 0;
        summary[key] = row;
    }
    for (const key of Object.keys(summary)) {
        summary[key].avgTurns = summary[key].runs > 0 ? summary[key].avgTurns / summary[key].runs : 0;
        summary[key].avgMaxProgress = summary[key].runs > 0 ? summary[key].avgMaxProgress / summary[key].runs : 0;
    }
    return summary;
}
exports.summarizeResults = summarizeResults;
function resultsToCsv(results) {
    const header = "track,level,run,aiCount,winnerId,finishedPlayers,status,startedAt,finishedAt,elapsedMs,iterations,iterationsPerSecond,turns,crashes,maxProgress,finishCrossings,finalX,finalY";
    const rows = results.map((result) => {
        var _a, _b, _c, _d, _e, _f, _g;
        return [
            result.track,
            result.level,
            result.run,
            (_a = result.aiCount) !== null && _a !== void 0 ? _a : 1,
            (_b = result.winnerId) !== null && _b !== void 0 ? _b : "",
            (_c = result.finishedPlayers) !== null && _c !== void 0 ? _c : "",
            result.status,
            (_d = result.startedAt) !== null && _d !== void 0 ? _d : "",
            (_e = result.finishedAt) !== null && _e !== void 0 ? _e : "",
            (_f = result.elapsedMs) !== null && _f !== void 0 ? _f : "",
            result.iterations,
            (_g = result.iterationsPerSecond) !== null && _g !== void 0 ? _g : "",
            result.turns,
            result.crashes,
            result.maxProgress,
            result.finishCrossings,
            result.finalX,
            result.finalY,
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
    });
    return [header, ...rows].join("\n");
}
exports.resultsToCsv = resultsToCsv;
