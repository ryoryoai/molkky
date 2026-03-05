export type MatchStatus = "ongoing" | "finished";

export interface Player {
  id: string;
  name: string;
  order: number;
  score: number;
  missStreak: number;
  eliminated: boolean;
}

export interface TurnState {
  index: number;
  playerId: string | null;
  round: number;
}

export interface ActionInput {
  type: "single" | "multi" | "miss" | "foul";
  value?: number;
}

export interface HistoryEntry {
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

export interface RoomState {
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

export interface CreateRoomResponse {
  roomId: string;
  editToken: string;
  viewUrl: string;
  editUrl: string;
}
