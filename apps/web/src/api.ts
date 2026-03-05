import type { CreateRoomResponse, RoomState } from "./types";

const RAW_API_BASE = import.meta.env.VITE_API_BASE?.trim();
const API_BASE = RAW_API_BASE && RAW_API_BASE.length > 0 ? RAW_API_BASE.replace(/\/$/, "") : "";

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

export async function createRoom(): Promise<CreateRoomResponse> {
  const response = await fetch(apiUrl("/api/room"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
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
