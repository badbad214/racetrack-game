import { Player, Section } from "../types/types";
import { GRID, TILE, isPointOnGrass, isPointOnTrack } from "./trackMaskGeometry";

export type Move = {
    x: number;
    y: number;
    dx: number;
    dy: number;
    crash: boolean;
    safeX: number;
    safeY: number;
};

type Direction = "top" | "bottom" | "left" | "right";

function normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360;
}

function getConnections(type: Section["type"], rotation: number): Direction[] {
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

function reverseDir(dir: Direction): Direction {
    if (dir === "top") return "bottom";
    if (dir === "bottom") return "top";
    if (dir === "left") return "right";
    return "left";
}

function getSectionAt(x: number, y: number, sections: Section[]): Section | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return sections.find((section) => section.x === tx && section.y === ty) ?? null;
}

function getDirectionBetween(from: Section, to: Section): Direction | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0) return "right";
    if (dx === -1 && dy === 0) return "left";
    if (dx === 0 && dy === 1) return "bottom";
    if (dx === 0 && dy === -1) return "top";
    return null;
}

function sectionsConnect(from: Section, to: Section): boolean {
    if (from.id === to.id) return true;
    const dir = getDirectionBetween(from, to);
    if (!dir) return false;
    return getConnections(from.type, from.rotation).includes(dir)
        && getConnections(to.type, to.rotation).includes(reverseDir(dir));
}

function nearestTrackPoint(x: number, y: number, sections: Section[], allowedSections = sections): { x: number; y: number } {
    let best = { x, y };
    let bestDist = Number.POSITIVE_INFINITY;

    for (const section of allowedSections) {
        const minX = section.x * TILE;
        const minY = section.y * TILE;
        for (let px = minX; px <= minX + TILE; px += GRID) {
            for (let py = minY; py <= minY + TILE; py += GRID) {
                if (!isPointOnTrack(px, py, sections)) continue;
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

function crashSnapSections(previousSection: Section | null, currentSection: Section | null): Section[] {
    const sections: Section[] = [];
    if (currentSection) sections.push(currentSection);
    if (previousSection && !sections.some((section) => section.id === previousSection.id)) {
        sections.push(previousSection);
    }
    return sections;
}

function traceMove(fromX: number, fromY: number, toX: number, toY: number, sections: Section[]): { crash: boolean; safeX: number; safeY: number } {
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

        if (crossedBlockedTileEdge || isPointOnGrass(x, y, sections) || !isPointOnTrack(x, y, sections)) {
            const snapSections = crashSnapSections(previousSection, currentSection);
            const nearest = nearestTrackPoint(x, y, sections, snapSections.length > 0 ? snapSections : sections);
            return { crash: true, safeX: nearest.x, safeY: nearest.y };
        }
        previousSection = currentSection ?? previousSection;
    }

    return { crash: false, safeX: toX, safeY: toY };
}

export function getValidMovesForPlayer(player: Player, sections: Section[]): Move[] {
    const result: Move[] = [];

    for (let ax = -GRID; ax <= GRID; ax += GRID) {
        for (let ay = -GRID; ay <= GRID; ay += GRID) {
            if (ax === 0 && ay === 0) continue;

            const dx = player.dx + ax;
            const dy = player.dy + ay;
            const x = player.x + dx;
            const y = player.y + dy;

            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

            const traced = traceMove(player.x, player.y, x, y, sections);
            result.push({ x, y, dx, dy, ...traced });
        }
    }

    return result;
}
