import type { CreateRoomResponse, RoomState } from "./types";

const RAW_API_BASE = import.meta.env.VITE_API_BASE?.trim();
const PAGES_DEV_API_BASE = "https://molkky-worker.rswt1018.workers.dev";

function detectApiBase(): string {
  if (RAW_API_BASE && RAW_API_BASE.length > 0) {
    return RAW_API_BASE.replace(/\/$/, "");
  }

  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith(".pages.dev")) {
    return PAGES_DEV_API_BASE;
  }

  return "";
}

const API_BASE = detectApiBase();

function apiUrl(path: string): string {
  if (API_BASE) {
    return `${API_BASE}${path}`;
  }
  return path;
}

export function wsUrl(path: string): string {
  const full = API_BASE ? new URL(path, `${API_BASE}/`).toString() : new URL(path, window.location.origin).toString();
  if (full.startsWith("https://")) return `wss://${full.slice("https://".length)}`;
  if (full.startsWith("http://")) return `ws://${full.slice("http://".length)}`;
  return full;
}

interface CreateRoomInput {
  roomId?: string;
}

export async function createRoom(input?: CreateRoomInput): Promise<CreateRoomResponse> {
  const trimmedRoomId = input?.roomId?.trim();
  const payload = trimmedRoomId ? { roomId: trimmedRoomId } : {};

  const response = await fetch(apiUrl("/api/room"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`create room failed: ${response.status}`);
  }

  return (await response.json()) as CreateRoomResponse;
}

export async function fetchSnapshot(roomId: string): Promise<RoomState> {
  const response = await fetch(apiUrl(`/api/room/${encodeURIComponent(roomId)}/snapshot`));
  if (!response.ok) {
    throw new Error(`snapshot failed: ${response.status}`);
  }

  const data = (await response.json()) as { state: RoomState };
  return data.state;
}
