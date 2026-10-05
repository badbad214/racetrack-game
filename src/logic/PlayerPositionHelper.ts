// === PlayerPositionHelper.ts ===
// Returns allowed player positions for a given tile section (x,y) and rotation.
// Used for spawn validation and movement constraints.

import { Section } from "../types/types"; // adjust import based on your project structure

// A grid snap of 15px is assumed
const grid = 15;

// Relative positions (in pixels) from top-left of tile
// Includes direction vector (dx, dy)
interface RelativePlayerPos {
    x: number;
    y: number;
    dx: number;
    dy: number;
}

// Rotation utility – rotates a local position and direction vector
function rotatePos(pos: RelativePlayerPos, angle: number): RelativePlayerPos {
    const { x, y, dx, dy } = pos;
    switch (angle % 360) {
        case 0:
            return { x, y, dx, dy };
        case 90:
            return {
                x: 90 - y,
                y: x,
                dx: -dy,
                dy: dx,
            };
        case 180:
            return {
                x: 90 - x,
                y: 90 - y,
                dx: -dx,
                dy: -dy,
            };
        case 270:
            return {
                x: y,
                y: 90 - x,
                dx: dy,
                dy: -dx,
            };
        default:
            // Fail-safe
            return { x, y, dx, dy };
    }
}

// Main function to export
export function getAllowedPlayerPositions(section: Section): { x: number; y: number; dx: number; dy: number }[] {
    const result: { x: number; y: number; dx: number; dy: number }[] = [];

    // Local grid-relative positions for each tile type (before rotation)
    let positions: RelativePlayerPos[] = [];

    if (section.type === "start") {
        const centerLine = [15, 30, 45, 60, 75];

        switch (section.rotation % 360) {
            case 0:
                // Left → Right (start line = left edge)
                for (const y of centerLine) {
                    positions.push({ x: 45, y, dx: 1, dy: 0 });
                }
                break;

            case 90:
                // Top → Bottom (start line = top edge)
                for (const x of centerLine) {
                    positions.push({ x, y: 45, dx: 0, dy: 1 });
                }
                break;

            case 180:
                // Right → Left (start line = right edge)
                for (const y of centerLine) {
                    positions.push({ x: 45, y, dx: -1, dy: 0 });
                }
                break;

            case 270:
                // Bottom → Top (start line = bottom edge)
                for (const x of centerLine) {
                    positions.push({ x, y: 45, dx: 0, dy: -1 });
                }
                break;

            default:
                console.warn("[ASSERT] Unexpected rotation on start tile:", section.rotation);
        }
    }



    // Convert each local position into global coordinates
    for (const rel of positions) {
        const rot = rotatePos(rel, section.rotation);

        // Snap to grid (section.x and section.y are tile origin in pixels)
        const gx = section.x + rot.x;
        const gy = section.y + rot.y;

        // Runtime assertions for Power of 10
        if (gx < 0 || gy < 0 || gx % grid !== 0 || gy % grid !== 0) {
            console.warn(`[ASSERT] Invalid grid-aligned position: (${gx}, ${gy})`);
        }

        result.push({ x: gx, y: gy, dx: rot.dx, dy: rot.dy });
    }

    // At minimum two assertions per function (Power of 10)
    if (result.length === 0) {
        console.warn("[ASSERT] No allowed player positions returned for tile type:", section.type);
    }

    return result;
}
