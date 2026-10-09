import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface CloudTrackSummary {
  id: string;
  name: string;
  board_size: number;
  created_at: string;
}

export interface CloudTrackRecord extends CloudTrackSummary {
  sections: unknown[];
  is_public: boolean;
}

interface PublishTrackInput {
  name: string;
  boardSize: number;
  sections: unknown[];
  isPublic?: boolean;
}

let cachedClient: SupabaseClient | null | undefined;

function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const url = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
    },
  });

  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return !!getSupabaseClient();
}

export async function publishCloudTrack(input: PublishTrackInput): Promise<CloudTrackRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
  }

  const { data, error } = await client
    .from("tracks")
    .insert({
      name: input.name,
      board_size: input.boardSize,
      sections: input.sections,
      is_public: input.isPublic ?? true,
    })
    .select("id, name, board_size, sections, is_public, created_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not publish track.");
  }

  return data as CloudTrackRecord;
}

export async function listCloudTracks(boardSize?: number): Promise<CloudTrackSummary[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
  }

  let query = client
    .from("tracks")
    .select("id, name, board_size, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (boardSize) {
    query = query.eq("board_size", boardSize);
  }

  const { data, error } = await query;

  if (error || !data) {
    throw new Error(error?.message ?? "Could not list cloud tracks.");
  }

  return data as CloudTrackSummary[];
}

export async function loadCloudTrackById(id: string): Promise<CloudTrackRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Supabase is not configured. Add REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
  }

  const { data, error } = await client
    .from("tracks")
    .select("id, name, board_size, sections, is_public, created_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not load cloud track.");
  }

  return data as CloudTrackRecord;
}
