import { Section } from "../types/types";

export function getValidPositionsOnTile(tile: Section): { x: number; y: number }[] {
    // Explicit positions for unrotated curve90 tile
    const localCurve90Points: { x: number; y: number }[] = [
        { x: 15, y: 0 }, { x: 30, y: 0 }, { x: 45, y: 0 }, { x: 60, y: 0 }, { x: 75, y: 0 },
        { x: 15, y: 15 }, { x: 30, y: 15 }, { x: 45, y: 15 }, { x: 60, y: 15 }, { x: 75, y: 15 }, { x: 90, y: 15 },
        { x: 15, y: 30 }, { x: 30, y: 30 }, { x: 45, y: 30 }, { x: 60, y: 30 }, { x: 75, y: 30 }, { x: 90, y: 30 },
        { x: 30, y: 45 }, { x: 45, y: 45 }, { x: 60, y: 45 }, { x: 75, y: 45 }, { x: 90, y: 45 },
        { x: 30, y: 60 }, { x: 45, y: 60 }, { x: 60, y: 60 }, { x: 75, y: 60 }, { x: 90, y: 60 },
        { x: 60, y: 75 }, { x: 75, y: 75 }, { x: 90, y: 75 },
    ];

    return tile.type === "curve90"
        ? rotateLocalPositions(tile, localCurve90Points)
        : generateDefaultTilePositions(tile);
}

function generateDefaultTilePositions(tile: Section): { x: number; y: number }[] {
    const grid = 15;
    const tileSize = 90;
    const localPoints: { x: number; y: number }[] = [];

    for (let gx = 0; gx <= tileSize; gx += grid) {
        for (let gy = 15; gy <= 75; gy += grid) {
            localPoints.push({ x: gx, y: gy });
        }
    }

    return rotateLocalPositions(tile, localPoints);
}

function rotateLocalPositions(tile: Section, points: { x: number; y: number }[]): { x: number; y: number }[] {
    const tileSize = 90;
    const rot = ((tile.rotation % 360) + 360) % 360;

    return points.map((pt) => {
        let rx = pt.x;
        let ry = pt.y;

        switch (rot) {
            case 90:
                [rx, ry] = [tileSize - pt.y, pt.x];
                break;
            case 180:
                [rx, ry] = [tileSize - pt.x, tileSize - pt.y];
                break;
            case 270:
                [rx, ry] = [pt.y, tileSize - pt.x];
                break;
        }

        return {
            x: tile.x * tileSize + rx,
            y: tile.y * tileSize + ry,
        };
    });
}
