"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rotateRelativePosition = void 0;
function rotateRelativePosition(p, rotation) {
    // Rotates a position (x, y) around the tile center (45, 45) based on rotation
    const cx = 45;
    const cy = 45;
    const dx = p.x - cx;
    const dy = p.y - cy;
    switch (rotation % 360) {
        case 0:
            return { x: cx + dx, y: cy + dy };
        case 90:
            return { x: cx - dy, y: cy + dx };
        case 180:
            return { x: cx - dx, y: cy - dy };
        case 270:
            return { x: cx + dy, y: cy - dx };
        default:
            return { x: p.x, y: p.y }; // fallback (shouldn't happen)
    }
}
exports.rotateRelativePosition = rotateRelativePosition;
