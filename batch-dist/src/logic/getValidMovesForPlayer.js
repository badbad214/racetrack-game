"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValidMovesForPlayer = void 0;
const trackMaskGeometry_1 = require("./trackMaskGeometry");
function normalizeRotation(rotation) {
    return ((rotation % 360) + 360) % 360;
}
function getConnections(type, rotation) {
    const normalized = normalizeRotation(rotation);
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
function reverseDir(dir) {
    if (dir === "top")
        return "bottom";
    if (dir === "bottom")
        return "top";
    if (dir === "left")
        return "right";
    return "left";
}
function getSectionAt(x, y, sections) {
    var _a;
    const tx = Math.floor(x / trackMaskGeometry_1.TILE);
    const ty = Math.floor(y / trackMaskGeometry_1.TILE);
    return (_a = sections.find((section) => section.x === tx && section.y === ty)) !== null && _a !== void 0 ? _a : null;
}
function getDirectionBetween(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0)
        return "right";
    if (dx === -1 && dy === 0)
        return "left";
    if (dx === 0 && dy === 1)
        return "bottom";
    if (dx === 0 && dy === -1)
        return "top";
    return null;
}
function sectionsConnect(from, to) {
    if (from.id === to.id)
        return true;
    const dir = getDirectionBetween(from, to);
    if (!dir)
        return false;
    return getConnections(from.type, from.rotation).includes(dir)
        && getConnections(to.type, to.rotation).includes(reverseDir(dir));
}
function nearestTrackPoint(x, y, sections, allowedSections = sections) {
    let best = { x, y };
    let bestDist = Number.POSITIVE_INFINITY;
    for (const section of allowedSections) {
        const minX = section.x * trackMaskGeometry_1.TILE;
        const minY = section.y * trackMaskGeometry_1.TILE;
        for (let px = minX; px <= minX + trackMaskGeometry_1.TILE; px += trackMaskGeometry_1.GRID) {
            for (let py = minY; py <= minY + trackMaskGeometry_1.TILE; py += trackMaskGeometry_1.GRID) {
                if (!(0, trackMaskGeometry_1.isPointOnTrack)(px, py, sections))
                    continue;
                const dist = (px - x) * (px - x) + (py - y) * (py - y);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = { x: px, y: py };
                }
            }
        }
    }
    return Number.isFinite(bestDist) ? best : nearestTrackPoint(x, y, sections, sections);
}
function crashSnapSections(previousSection, currentSection) {
    const sections = [];
    if (currentSection)
        sections.push(currentSection);
    if (previousSection && !sections.some((section) => section.id === previousSection.id)) {
        sections.push(previousSection);
    }
    return sections;
}
function traceMove(fromX, fromY, toX, toY, sections) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    const steps = Math.max(1, Math.ceil(distance / 1.5));
    let previousSection = getSectionAt(fromX, fromY, sections);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = fromX + (toX - fromX) * t;
        const y = fromY + (toY - fromY) * t;
        const currentSection = getSectionAt(x, y, sections);
        const crossedBlockedTileEdge = previousSection && currentSection && previousSection.id !== currentSection.id
            ? !sectionsConnect(previousSection, currentSection)
            : false;
        if (crossedBlockedTileEdge || (0, trackMaskGeometry_1.isPointOnGrass)(x, y, sections) || !(0, trackMaskGeometry_1.isPointOnTrack)(x, y, sections)) {
            const snapSections = crashSnapSections(previousSection, currentSection);
            const nearest = nearestTrackPoint(x, y, sections, snapSections.length > 0 ? snapSections : sections);
            return { crash: true, safeX: nearest.x, safeY: nearest.y };
        }
        previousSection = currentSection !== null && currentSection !== void 0 ? currentSection : previousSection;
    }
    return { crash: false, safeX: toX, safeY: toY };
}
function getValidMovesForPlayer(player, sections) {
    const result = [];
    for (let ax = -trackMaskGeometry_1.GRID; ax <= trackMaskGeometry_1.GRID; ax += trackMaskGeometry_1.GRID) {
        for (let ay = -trackMaskGeometry_1.GRID; ay <= trackMaskGeometry_1.GRID; ay += trackMaskGeometry_1.GRID) {
            if (ax === 0 && ay === 0)
                continue;
            const dx = player.dx + ax;
            const dy = player.dy + ay;
            const x = player.x + dx;
            const y = player.y + dy;
            if (!Number.isFinite(x) || !Number.isFinite(y))
                continue;
            const traced = traceMove(player.x, player.y, x, y, sections);
            result.push({ x, y, dx, dy, ...traced });
        }
    }
    return result;
}
exports.getValidMovesForPlayer = getValidMovesForPlayer;
