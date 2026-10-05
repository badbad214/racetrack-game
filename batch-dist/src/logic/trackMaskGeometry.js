"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPointOnGrass = exports.isPointOnTrack = exports.isLocalOnGrass = exports.isLocalOnRoad = exports.grassSvgPath = exports.tileSvgPath = exports.straightRoadSvgPath = exports.roadSvgPath = exports.rotateLocalBack = exports.normalizeRotation = exports.CURVE_MARGIN = exports.CURB_INSET = exports.TILE = exports.GRID = void 0;
exports.GRID = 15;
exports.TILE = 90;
exports.CURB_INSET = 6;
exports.CURVE_MARGIN = 2;
function normalizeRotation(rotation) {
    return ((rotation % 360) + 360) % 360;
}
exports.normalizeRotation = normalizeRotation;
function rotateLocalBack(x, y, rotation) {
    const cx = exports.TILE / 2;
    const cy = exports.TILE / 2;
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
exports.rotateLocalBack = rotateLocalBack;
function roadSvgPath(tileSize = exports.TILE) {
    const scale = tileSize / exports.TILE;
    const curveInset = 2 * scale;
    const control = 5 * scale;
    return `M ${curveInset} ${tileSize} Q ${control} ${control} ${tileSize} ${curveInset} L ${tileSize} ${tileSize} Z`;
}
exports.roadSvgPath = roadSvgPath;
function straightRoadSvgPath(tileSize = exports.TILE) {
    const curbInset = exports.CURB_INSET * (tileSize / exports.TILE);
    return `M 0 ${curbInset} H ${tileSize} V ${tileSize - curbInset} H 0 Z`;
}
exports.straightRoadSvgPath = straightRoadSvgPath;
function tileSvgPath(tileSize = exports.TILE) {
    return `M 0 0 H ${tileSize} V ${tileSize} H 0 Z`;
}
exports.tileSvgPath = tileSvgPath;
function grassSvgPath(type, tileSize = exports.TILE) {
    if (type === "straight" || type === "start")
        return "";
    return `${tileSvgPath(tileSize)} ${roadSvgPath(tileSize)}`;
}
exports.grassSvgPath = grassSvgPath;
function isLocalOnRoad(type, x, y) {
    const tolerance = 1;
    if (x < -tolerance || y < -tolerance || x > exports.TILE + tolerance || y > exports.TILE + tolerance) {
        return false;
    }
    if (type === "straight" || type === "start") {
        return true;
    }
    const distFromOuterCorner = Math.hypot(exports.TILE - x, exports.TILE - y);
    return distFromOuterCorner <= exports.TILE - exports.CURVE_MARGIN + tolerance;
}
exports.isLocalOnRoad = isLocalOnRoad;
function isLocalOnGrass(type, x, y) {
    if (x < 0 || y < 0 || x > exports.TILE || y > exports.TILE)
        return false;
    return !isLocalOnRoad(type, x, y);
}
exports.isLocalOnGrass = isLocalOnGrass;
function isPointOnTrack(x, y, sections) {
    for (const section of sections) {
        const tileLeft = section.x * exports.TILE;
        const tileTop = section.y * exports.TILE;
        if (x < tileLeft - 1 || y < tileTop - 1 || x > tileLeft + exports.TILE + 1 || y > tileTop + exports.TILE + 1) {
            continue;
        }
        const local = rotateLocalBack(x - tileLeft, y - tileTop, section.rotation);
        if (isLocalOnRoad(section.type, local.x, local.y)) {
            return true;
        }
    }
    return false;
}
exports.isPointOnTrack = isPointOnTrack;
function isPointOnGrass(x, y, sections) {
    for (const section of sections) {
        const tileLeft = section.x * exports.TILE;
        const tileTop = section.y * exports.TILE;
        if (x < tileLeft || y < tileTop || x > tileLeft + exports.TILE || y > tileTop + exports.TILE) {
            continue;
        }
        const local = rotateLocalBack(x - tileLeft, y - tileTop, section.rotation);
        if (isLocalOnGrass(section.type, local.x, local.y)) {
            return true;
        }
    }
    return false;
}
exports.isPointOnGrass = isPointOnGrass;
