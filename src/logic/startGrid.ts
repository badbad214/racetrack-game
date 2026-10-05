import { Section, StartSpot } from "../types/types";

// Tile and grid definitions
const TILE_SIZE = 90;
const GRID_SPACING = 15;

// ⬇️ Rotate a point (x, y) around the center of a tile based on rotation
function rotateRelativePosition(p: { x: number; y: number }, rotation: number): { x: number; y: number } {
    const cx = 45;
    const cy = 45;
    const dx = p.x - cx;
    const dy = p.y - cy;

    switch (rotation % 360) {
        case 0: return { x: cx + dx, y: cy + dy };
        case 90: return { x: cx - dy, y: cy + dx };
        case 180: return { x: cx - dx, y: cy - dy };
        case 270: return { x: cx + dy, y: cy - dx };
        default: return { x: p.x, y: p.y };
    }
}

// ⬇️ Rotate a unit vector (dx, dy) based on tile rotation
function rotateDirection(dx: number, dy: number, rotation: number): { dx: number; dy: number } {
    switch (rotation % 360) {
        case 0: return { dx, dy };
        case 90: return { dx: -dy, dy: dx };
        case 180: return { dx: -dx, dy: -dy };
        case 270: return { dx: dy, dy: -dx };
        default: return { dx, dy };
    }
}

// ⬇️ Build allowed grid-aligned positions (global 15×15 grid)
function buildAllowedGrid(max: number): Set<string> {
    const allowed = new Set<string>();
    for (let gx = 0; gx <= max; gx += GRID_SPACING) {
        for (let gy = 0; gy <= max; gy += GRID_SPACING) {
            allowed.add(`${gx},${gy}`);
        }
    }
    return allowed;
}

// ⬇️ Return all valid start spots for the given sections
export function getStartGrid(sections: Section[]): StartSpot[] {
    const result: StartSpot[] = [];
    const allowed = buildAllowedGrid(900);

    for (const section of sections) {
        if (section.type !== "start") continue;

        const { x: tileX, y: tileY, rotation } = section;
        const dir = rotateDirection(1, 0, rotation);

        const basePositions = [
            { x: 45, y: 15 },
            { x: 45, y: 30 },
            { x: 45, y: 45 },
            { x: 45, y: 60 },
            { x: 45, y: 75 }
        ];

        const rotated = basePositions.map(p => rotateRelativePosition(p, rotation));

        for (const p of rotated) {
            const worldX = tileX * TILE_SIZE + p.x;
            const worldY = tileY * TILE_SIZE + p.y;

            const gx = Math.round(worldX / GRID_SPACING) * GRID_SPACING;
            const gy = Math.round(worldY / GRID_SPACING) * GRID_SPACING;

            const spot: StartSpot = {
                x: gx,
                y: gy,
                dx: dir.dx,
                dy: dir.dy,
                taken: false,
            };

            if (!allowed.has(`${gx},${gy}`)) {
                continue;
            }

            result.push(spot);
        }
    }

    return result;
}
