import type { Section } from "../types/types";

export const GRID = 15;
export const TILE = 90;
export const CURB_INSET = 6;
export const CURVE_MARGIN = 2;

export function normalizeRotation(rotation: number): number {
    return ((rotation % 360) + 360) % 360;
}

export function rotateLocalBack(x: number, y: number, rotation: number): { x: number; y: number } {
    const cx = TILE / 2;
    const cy = TILE / 2;
    const dx = x - cx;
    const dy = y - cy;

    switch (normalizeRotation(rotation)) {
        case 90:
            return { x: cx + dy, y: cy - dx };
        case 180:
            return { x: cx - dx, y: cy - dy };
        case 270:
            return { x: cx - dy, y: cy + dx };
        default:
            return { x, y };
    }
}

export function roadSvgPath(tileSize = TILE): string {
    const scale = tileSize / TILE;
    const curveInset = 2 * scale;
    const control = 5 * scale;

    return `M ${curveInset} ${tileSize} Q ${control} ${control} ${tileSize} ${curveInset} L ${tileSize} ${tileSize} Z`;
}

export function straightRoadSvgPath(tileSize = TILE): string {
    const curbInset = CURB_INSET * (tileSize / TILE);
    return `M 0 ${curbInset} H ${tileSize} V ${tileSize - curbInset} H 0 Z`;
}

export function tileSvgPath(tileSize = TILE): string {
    return `M 0 0 H ${tileSize} V ${tileSize} H 0 Z`;
}

export function grassSvgPath(type: Section["type"], tileSize = TILE): string {
    if (type === "straight" || type === "start") return "";
    return `${tileSvgPath(tileSize)} ${roadSvgPath(tileSize)}`;
}

export function isLocalOnRoad(type: Section["type"], x: number, y: number): boolean {
    const tolerance = 1;
    if (x < -tolerance || y < -tolerance || x > TILE + tolerance || y > TILE + tolerance) {
        return false;
    }

    if (type === "straight" || type === "start") {
        return true;
    }

    const distFromOuterCorner = Math.hypot(TILE - x, TILE - y);
    return distFromOuterCorner <= TILE - CURVE_MARGIN + tolerance;
}

export function isLocalOnGrass(type: Section["type"], x: number, y: number): boolean {
    if (x < 0 || y < 0 || x > TILE || y > TILE) return false;
    return !isLocalOnRoad(type, x, y);
}

export function isPointOnTrack(x: number, y: number, sections: Section[]): boolean {
    for (const section of sections) {
        const tileLeft = section.x * TILE;
        const tileTop = section.y * TILE;
        if (x < tileLeft - 1 || y < tileTop - 1 || x > tileLeft + TILE + 1 || y > tileTop + TILE + 1) {
            continue;
        }

        const local = rotateLocalBack(x - tileLeft, y - tileTop, section.rotation);
        if (isLocalOnRoad(section.type, local.x, local.y)) {
            return true;
        }
    }

    return false;
}

export function isPointOnGrass(x: number, y: number, sections: Section[]): boolean {
    for (const section of sections) {
        const tileLeft = section.x * TILE;
        const tileTop = section.y * TILE;
        if (x < tileLeft || y < tileTop || x > tileLeft + TILE || y > tileTop + TILE) {
            continue;
        }

        const local = rotateLocalBack(x - tileLeft, y - tileTop, section.rotation);
        if (isLocalOnGrass(section.type, local.x, local.y)) {
            return true;
        }
    }

    return false;
}
