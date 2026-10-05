// === types.ts ===
// Shared types for Racetrack Game

// Tile types
export type SectionType = "start" | "straight" | "curve90"; // Add more as needed

// Single track tile (section)
export interface Section {
    id: string;          // Unique identifier
    type: SectionType;   // Tile type
    x: number;           // Top-left X position in pixels
    y: number;           // Top-left Y position in pixels
    rotation: number;    // Rotation in degrees: 0, 90, 180, 270
}

// Player data structure
export interface Player {
    id: number;
    x: number;           // Position in pixels (aligned to grid)
    y: number;
    dx: number;          // Facing direction vector
    dy: number;
    color: string;       // For visual rendering
    trail: { x: number; y: number }[];
    penalties: number;
}

export interface StartSpot {
    x: number;
    y: number;
    dx: number;
    dy: number;
    taken: boolean;
}
