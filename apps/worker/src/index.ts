/* eslint-disable no-console */
export interface Env {
  ROOM_DO: DurableObjectNamespace;
  TOKEN_PEPPER: string;
}

type MatchStatus = "ongoing" | "finished";
type ActionType = "single" | "multi" | "miss" | "foul";

interface Player {
  id: string;
  name: string;
  order: number;
  score: number;
  missStreak: number;
  eliminated: boolean;
}

interface TurnState {
  index: number;
  playerId: string | null;
  round: number;
}

interface ActionInput {
  type: ActionType;
  value?: number;
}

interface HistoryEntry {
  id: string;
  playerId: string;
  input: ActionInput;
  delta: number;
  prevScore: number;
  nextScore: number;
  prevMissStreak: number;
  nextMissStreak: number;
  prevEliminated: boolean;
  nextEliminated: boolean;
  prevTurn: TurnState;
  nextTurn: TurnState;
  prevStatus: MatchStatus;
  nextStatus: MatchStatus;
  prevWinnerPlayerId: string | null;
  nextWinnerPlayerId: string | null;
  ts: number;
}

interface MatchState {
  roomId: string;
  status: MatchStatus;
  createdAt: number;
  hostPlayerId: string | null;
  winnerPlayerId: string | null;
  editTokenHash: string;
  players: Player[];
  turn: TurnState;
  history: HistoryEntry[];
  revision: number;
}

interface PublicMatchState {
  roomId: string;
  status: MatchStatus;
  createdAt: number;
  hostPlayerId: string | null;
  winnerPlayerId: string | null;
  players: Player[];
  turn: TurnState;
  history: HistoryEntry[];
  revision: number;
  session: {
    canEdit: boolean;
  };
}

interface ClientJoinMessage {
  type: "join";
  name: string;
}

interface ClientActionMessage {
  type: "action";
  action: ActionInput;
}

interface ClientUndoMessage {
  type: "undo";
}

interface ClientCorrectLastMessage {
  type: "correct_last";
  action: ActionInput;
}

type ClientMessage = ClientJoinMessage | ClientActionMessage | ClientUndoMessage | ClientCorrectLastMessage;

interface ConnectionMeta {
  socketId: string;
  canEdit: boolean;
  playerId: string | null;
  name: string | null;
}

const STORAGE_KEY = "roomState";
const HISTORY_LIMIT = 500;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    })
  );
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function randomBase64Url(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  let binary = "";
  for (const value of array) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashEditToken(token: string, pepper: string): Promise<string> {
  return sha256Hex(`${pepper}:${token}`);
}

function decodeRoomSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function cloneTurn(turn: TurnState): TurnState {
  return { index: turn.index, playerId: turn.playerId, round: turn.round };
}

function toPublicState(state: MatchState, canEdit: boolean): PublicMatchState {
  return {
    roomId: state.roomId,
    status: state.status,
    createdAt: state.createdAt,
    hostPlayerId: state.hostPlayerId,
    winnerPlayerId: state.winnerPlayerId,
    players: state.players,
    turn: state.turn,
    history: state.history,
    revision: state.revision,
    session: {
      canEdit
    }
  };
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Guest";
  }
  return trimmed.slice(0, 24);
}

function parseRequestedRoomId(value: unknown): { roomId: string | null; error?: string } {
  if (value === undefined || value === null) {
    return { roomId: null };
  }

  if (typeof value !== "string") {
    return { roomId: null, error: "roomId must be string" };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { roomId: null };
  }

  if (trimmed.length > 64) {
    return { roomId: null, error: "roomId must be 64 characters or less" };
  }

  if (/[/?#]/.test(trimmed)) {
    return { roomId: null, error: "roomId contains invalid characters: / ? #" };
  }

  return { roomId: trimmed };
}

function buildShareUrls(origin: string, roomId: string, editToken: string): { viewUrl: string; editUrl: string } {
  const encodedRoomId = encodeURIComponent(roomId);
  const viewUrl = `${origin}/room/${encodedRoomId}`;
  const editUrl = `${origin}/room/${encodedRoomId}#edit=${editToken}`;
  return { viewUrl, editUrl };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    if (request.method === "POST" && url.pathname === "/api/room") {
      const origin = request.headers.get("origin") ?? url.origin;
      let payload: { roomId?: unknown } = {};

      try {
        const rawBody = await request.text();
        if (rawBody.trim()) {
          payload = JSON.parse(rawBody) as { roomId?: unknown };
        }
      } catch {
        return errorResponse("invalid json payload", 400);
      }

      const parsedRoomId = parseRequestedRoomId(payload.roomId);
      if (parsedRoomId.error) {
        return errorResponse(parsedRoomId.error, 400);
      }

      const createSpecificRoom = async (roomId: string): Promise<Response> => {
        const editToken = randomBase64Url(24);
        const editTokenHash = await hashEditToken(editToken, env.TOKEN_PEPPER ?? "");
        const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
        const initRes = await stub.fetch("https://room/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, editTokenHash })
        });

        if (initRes.status === 201) {
          const { viewUrl, editUrl } = buildShareUrls(origin, roomId, editToken);
          return jsonResponse({ roomId, editToken, viewUrl, editUrl }, 201);
        }

        return withCors(initRes);
      };

      if (parsedRoomId.roomId) {
        const response = await createSpecificRoom(parsedRoomId.roomId);
        if (response.status === 409) {
          return errorResponse("room already exists", 409);
        }
        return response;
      }

      for (let i = 0; i < 5; i += 1) {
        const roomId = randomBase64Url(16);
        const response = await createSpecificRoom(roomId);
        if (response.status === 201) {
          return response;
        }
        if (response.status !== 409) {
          return response;
        }
      }

      return errorResponse("failed to create unique room", 500);
    }

    const snapshotMatch = url.pathname.match(/^\/api\/room\/([^/]+)\/snapshot$/);
    if (request.method === "GET" && snapshotMatch) {
      const roomId = decodeRoomSegment(snapshotMatch[1]);
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
      const response = await stub.fetch("https://room/snapshot");
      return withCors(response);
    }

    const wsMatch = url.pathname.match(/^\/api\/room\/([^/]+)\/ws$/);
    if (request.method === "GET" && wsMatch) {
      const roomId = decodeRoomSegment(wsMatch[1]);
      const token = url.searchParams.get("token");
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));

      const doUrl = new URL("https://room/ws");
      if (token) {
        doUrl.searchParams.set("token", token);
      }

      const proxyReq = new Request(doUrl.toString(), request);
      return stub.fetch(proxyReq);
    }

    return errorResponse("not found", 404);
  }
};

export class RoomDurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly connections: Map<WebSocket, ConnectionMeta>;
  private roomState: MatchState | null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.connections = new Map();
    this.roomState = null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/init") {
      return this.handleInit(request);
    }

    if (request.method === "GET" && url.pathname === "/snapshot") {
      const state = await this.loadState();
      if (!state) {
        return errorResponse("room not found", 404);
      }
      return jsonResponse({ state: toPublicState(state, false) });
    }

    if (request.method === "GET" && url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return errorResponse("websocket upgrade required", 426);
      }
      return this.handleWebSocket(request);
    }

    return errorResponse("not found", 404);
  }

  private async handleInit(request: Request): Promise<Response> {
    const existing = await this.ctx.storage.get<MatchState>(STORAGE_KEY);
    if (existing) {
      return errorResponse("room already exists", 409);
    }

    const body = (await request.json()) as { roomId?: string; editTokenHash?: string };
    if (!body.roomId || !body.editTokenHash) {
      return errorResponse("invalid init payload", 400);
    }

    const room: MatchState = {
      roomId: body.roomId,
      status: "ongoing",
      createdAt: Date.now(),
      hostPlayerId: null,
      winnerPlayerId: null,
      editTokenHash: body.editTokenHash,
      players: [],
      turn: {
        index: -1,
        playerId: null,
        round: 1
      },
      history: [],
      revision: 0
    };

    await this.ctx.storage.put(STORAGE_KEY, room);
    this.roomState = room;

    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("room not found", 404);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const canEdit = await this.isValidToken(state, token);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    this.connections.set(server, {
      socketId: randomBase64Url(8),
      canEdit,
      playerId: null,
      name: null
    });

    server.addEventListener("message", (event) => {
      void this.onSocketMessage(server, String(event.data));
    });

    server.addEventListener("close", () => {
      this.detachSocket(server);
    });

    server.addEventListener("error", () => {
      this.detachSocket(server);
    });

    this.sendInfo(server, canEdit ? "editor connected" : "viewer connected");
    this.sendState(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async onSocketMessage(socket: WebSocket, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(socket, "invalid json");
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      this.sendError(socket, "invalid message");
      return;
    }

    const message = parsed as Partial<ClientMessage>;
    switch (message.type) {
      case "join":
        await this.handleJoin(socket, String((message as ClientJoinMessage).name ?? ""));
        return;
      case "action":
        await this.handleAction(socket, (message as ClientActionMessage).action);
        return;
      case "undo":
        await this.handleUndo(socket);
        return;
      case "correct_last":
        await this.handleCorrectLast(socket, (message as ClientCorrectLastMessage).action);
        return;
      default:
        this.sendError(socket, "unknown message type");
    }
  }

  private async handleJoin(socket: WebSocket, nameInput: string): Promise<void> {
    const state = await this.loadState();
    if (!state) {
      this.sendError(socket, "room not found");
      return;
    }

    const meta = this.connections.get(socket);
    if (!meta) {
      return;
    }

    const name = sanitizeName(nameInput);
    meta.name = name;

    const existing = state.players.find((player) => player.name === name);
    if (existing) {
      meta.playerId = existing.id;
      this.sendInfo(socket, `joined as ${existing.name}`);
      this.sendState(socket);
      return;
    }

    if (state.history.length > 0 || state.status !== "ongoing") {
      this.sendInfo(socket, "spectator mode (new players are locked after match starts)");
      this.sendState(socket);
      return;
    }

    const player: Player = {
      id: randomBase64Url(8),
      name,
      order: state.players.length,
      score: 0,
      missStreak: 0,
      eliminated: false
    };
    state.players.push(player);

    if (!state.hostPlayerId) {
      state.hostPlayerId = player.id;
    }

    if (!state.turn.playerId) {
      state.turn = {
        index: state.players.findIndex((p) => p.id === player.id),
        playerId: player.id,
        round: 1
      };
    }

    meta.playerId = player.id;

    state.revision += 1;
    await this.saveState(state);
    this.broadcastState();
    this.broadcastInfo(`${player.name} joined`);
  }

  private async handleAction(socket: WebSocket, action: ActionInput | undefined): Promise<void> {
    const state = await this.loadState();
    if (!state) {
      this.sendError(socket, "room not found");
      return;
    }

    const meta = this.connections.get(socket);
    if (!meta?.canEdit) {
      this.sendError(socket, "edit token required");
      return;
    }

    if (state.status === "finished") {
      this.sendError(socket, "match already finished");
      return;
    }

    if (!action || !this.isValidAction(action)) {
      this.sendError(socket, "invalid action payload");
      return;
    }

    const result = this.applyActionToCurrentTurn(state, action);
    if (result.error) {
      this.sendError(socket, result.error);
      return;
    }

    state.revision += 1;
    await this.saveState(state);

    if (result.playerEliminatedNow) {
      this.broadcastInfo(`${result.playerName} eliminated`);
    }
    if (result.winnerName) {
      this.broadcastInfo(`winner: ${result.winnerName}`);
    }

    this.broadcastState();
  }

  private async handleUndo(socket: WebSocket): Promise<void> {
    const state = await this.loadState();
    if (!state) {
      this.sendError(socket, "room not found");
      return;
    }

    const meta = this.connections.get(socket);
    if (!meta?.canEdit) {
      this.sendError(socket, "edit token required");
      return;
    }

    if (state.status === "finished") {
      this.sendError(socket, "undo is disabled after finish");
      return;
    }

    const entry = state.history[state.history.length - 1];
    if (!entry) {
      this.sendError(socket, "nothing to undo");
      return;
    }

    const restoreError = this.restorePreviousFromEntry(state, entry);
    if (restoreError) {
      this.sendError(socket, restoreError);
      return;
    }

    state.history.pop();
    state.revision += 1;
    await this.saveState(state);
    this.broadcastInfo("last action undone");
    this.broadcastState();
  }

  private async handleCorrectLast(socket: WebSocket, action: ActionInput | undefined): Promise<void> {
    const state = await this.loadState();
    if (!state) {
      this.sendError(socket, "room not found");
      return;
    }

    const meta = this.connections.get(socket);
    if (!meta?.canEdit) {
      this.sendError(socket, "edit token required");
      return;
    }

    if (!action || !this.isValidAction(action)) {
      this.sendError(socket, "invalid action payload");
      return;
    }

    const lastEntry = state.history[state.history.length - 1];
    if (!lastEntry) {
      this.sendError(socket, "nothing to correct");
      return;
    }

    const draft = structuredClone(state) as MatchState;
    const targetEntry = draft.history[draft.history.length - 1];
    if (!targetEntry) {
      this.sendError(socket, "nothing to correct");
      return;
    }

    const restoreError = this.restorePreviousFromEntry(draft, targetEntry);
    if (restoreError) {
      this.sendError(socket, restoreError);
      return;
    }
    draft.history.pop();

    const result = this.applyActionToCurrentTurn(draft, action);
    if (result.error) {
      this.sendError(socket, result.error);
      return;
    }

    draft.revision += 1;
    await this.saveState(draft);

    this.broadcastInfo(`last action corrected by ${result.playerName}`);
    if (result.playerEliminatedNow) {
      this.broadcastInfo(`${result.playerName} eliminated`);
    }
    if (result.winnerName) {
      this.broadcastInfo(`winner: ${result.winnerName}`);
    }

    this.broadcastState();
  }

  private computeNextTurn(state: MatchState, currentPlayerId: string): TurnState {
    const alive = [...state.players]
      .filter((p) => !p.eliminated)
      .sort((a, b) => a.order - b.order);

    if (alive.length === 0) {
      return {
        index: -1,
        playerId: null,
        round: state.turn.round
      };
    }

    let wrapped = false;
    let nextAliveIndex = alive.findIndex((p) => p.id === currentPlayerId);

    if (nextAliveIndex === -1) {
      const currentOrder = state.players.find((p) => p.id === currentPlayerId)?.order ?? -1;
      nextAliveIndex = alive.findIndex((p) => p.order > currentOrder);
      if (nextAliveIndex === -1) {
        nextAliveIndex = 0;
        wrapped = true;
      }
    } else {
      nextAliveIndex += 1;
      if (nextAliveIndex >= alive.length) {
        nextAliveIndex = 0;
        wrapped = true;
      }
    }

    const nextPlayer = alive[nextAliveIndex];
    return {
      index: state.players.findIndex((p) => p.id === nextPlayer.id),
      playerId: nextPlayer.id,
      round: state.turn.round + (wrapped ? 1 : 0)
    };
  }

  private isValidAction(action: ActionInput): boolean {
    if (!action || typeof action !== "object") {
      return false;
    }

    if (action.type === "miss" || action.type === "foul") {
      return true;
    }

    if ((action.type === "single" || action.type === "multi") && typeof action.value === "number") {
      if (!Number.isInteger(action.value)) {
        return false;
      }
      if (action.type === "single") {
        return action.value >= 1 && action.value <= 12;
      }
      return action.value >= 2 && action.value <= 12;
    }

    return false;
  }

  private computeDelta(action: ActionInput): number {
    if (action.type === "single" || action.type === "multi") {
      return action.value ?? 0;
    }
    return 0;
  }

  private restorePreviousFromEntry(state: MatchState, entry: HistoryEntry): string | null {
    const player = state.players.find((p) => p.id === entry.playerId);
    if (!player) {
      return "history references unknown player";
    }

    // 直前手の反映前へ巻き戻し、手番・勝敗状態まで復元する。
    player.score = entry.prevScore;
    player.missStreak = entry.prevMissStreak;
    player.eliminated = entry.prevEliminated;

    state.turn = cloneTurn(entry.prevTurn);
    state.status = entry.prevStatus;
    state.winnerPlayerId = entry.prevWinnerPlayerId;
    return null;
  }

  private applyActionToCurrentTurn(
    state: MatchState,
    action: ActionInput
  ): { error?: string; playerName: string; playerEliminatedNow: boolean; winnerName: string | null } {
    const currentPlayer = state.players.find((player) => player.id === state.turn.playerId);
    if (!currentPlayer) {
      return { error: "no active turn player", playerName: "", playerEliminatedNow: false, winnerName: null };
    }

    if (currentPlayer.eliminated) {
      return { error: "eliminated player cannot score", playerName: "", playerEliminatedNow: false, winnerName: null };
    }

    const delta = this.computeDelta(action);
    const prevScore = currentPlayer.score;
    const prevMissStreak = currentPlayer.missStreak;
    const prevEliminated: boolean = currentPlayer.eliminated;
    const prevTurn = cloneTurn(state.turn);
    const prevStatus = state.status;
    const prevWinnerPlayerId = state.winnerPlayerId;

    let nextScore = prevScore;
    const nextMissStreak = delta === 0 ? prevMissStreak + 1 : 0;
    let nextEliminated: boolean = prevEliminated;

    if (delta > 0) {
      const provisional = prevScore + delta;
      if (provisional > 50) {
        nextScore = 25;
      } else {
        nextScore = provisional;
      }
    }

    if (delta === 0 && nextMissStreak >= 3) {
      nextEliminated = true;
      nextScore = 0;
    }

    currentPlayer.score = nextScore;
    currentPlayer.missStreak = nextMissStreak;
    currentPlayer.eliminated = nextEliminated;

    let nextStatus: MatchStatus = state.status;
    let nextWinnerPlayerId: string | null = state.winnerPlayerId;
    let nextTurn = cloneTurn(state.turn);
    let winnerName: string | null = null;

    if (nextScore === 50) {
      nextStatus = "finished";
      nextWinnerPlayerId = currentPlayer.id;
      state.status = nextStatus;
      state.winnerPlayerId = nextWinnerPlayerId;
      winnerName = currentPlayer.name;
    } else {
      nextTurn = this.computeNextTurn(state, currentPlayer.id);
      state.turn = nextTurn;
    }

    const entry: HistoryEntry = {
      id: randomBase64Url(10),
      playerId: currentPlayer.id,
      input: action,
      delta,
      prevScore,
      nextScore,
      prevMissStreak,
      nextMissStreak,
      prevEliminated,
      nextEliminated,
      prevTurn,
      nextTurn,
      prevStatus,
      nextStatus,
      prevWinnerPlayerId,
      nextWinnerPlayerId,
      ts: Date.now()
    };

    state.history.push(entry);
    if (state.history.length > HISTORY_LIMIT) {
      state.history.splice(0, state.history.length - HISTORY_LIMIT);
    }

    return {
      playerName: currentPlayer.name,
      playerEliminatedNow: !prevEliminated && nextEliminated,
      winnerName
    };
  }

  private async isValidToken(state: MatchState, token: string | null): Promise<boolean> {
    if (!token) {
      return false;
    }
    const hash = await hashEditToken(token, this.env.TOKEN_PEPPER ?? "");
    return hash === state.editTokenHash;
  }

  private async loadState(): Promise<MatchState | null> {
    if (this.roomState) {
      return this.roomState;
    }

    const state = await this.ctx.storage.get<MatchState>(STORAGE_KEY);
    if (!state) {
      return null;
    }

    this.roomState = state;
    return state;
  }

  private async saveState(state: MatchState): Promise<void> {
    this.roomState = state;
    await this.ctx.storage.put(STORAGE_KEY, state);
  }

  private detachSocket(socket: WebSocket): void {
    this.connections.delete(socket);
    try {
      socket.close();
    } catch {
      // noop
    }
  }

  private sendState(socket: WebSocket): void {
    const meta = this.connections.get(socket);
    if (!meta || !this.roomState) {
      return;
    }

    this.safeSend(socket, {
      type: "state",
      fullState: toPublicState(this.roomState, meta.canEdit)
    });
  }

  private broadcastState(): void {
    for (const socket of this.connections.keys()) {
      this.sendState(socket);
    }
  }

  private sendError(socket: WebSocket, message: string): void {
    this.safeSend(socket, {
      type: "error",
      message
    });
  }

  private sendInfo(socket: WebSocket, message: string): void {
    this.safeSend(socket, {
      type: "info",
      message
    });
  }

  private broadcastInfo(message: string): void {
    for (const socket of this.connections.keys()) {
      this.sendInfo(socket, message);
    }
  }

  private safeSend(socket: WebSocket, payload: unknown): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.detachSocket(socket);
    }
  }
}
