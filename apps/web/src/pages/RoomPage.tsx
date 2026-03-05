import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchSnapshot, wsUrl } from "../api";
import type { ActionInput, RoomState } from "../types";

const NAME_KEY = "molkky:display-name";

interface ServerMessage {
  type: "state" | "error" | "info";
  fullState?: RoomState;
  message?: string;
}

function parseEditToken(hash: string): string | null {
  if (!hash.startsWith("#")) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  return params.get("edit");
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "Guest");

  const socketRef = useRef<WebSocket | null>(null);

  const token = useMemo(() => parseEditToken(window.location.hash), []);

  useEffect(() => {
    if (!roomId) {
      navigate("/", { replace: true });
      return;
    }

    let active = true;

    void (async () => {
      try {
        const snapshot = await fetchSnapshot(roomId);
        if (!active) return;
        setState(snapshot);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "snapshot 取得に失敗しました");
      }
    })();

    const endpoint = new URL(wsUrl(`/api/room/${encodeURIComponent(roomId)}/ws`));
    if (token) {
      endpoint.searchParams.set("token", token);
    }

    const socket = new WebSocket(endpoint);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "join", name }));
    });

    socket.addEventListener("message", (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        setError("不正なサーバーメッセージ");
        return;
      }

      if (message.type === "state" && message.fullState) {
        setState(message.fullState);
      } else if (message.type === "error" && message.message) {
        setError(message.message);
      } else if (message.type === "info" && message.message) {
        setInfo(message.message);
      }
    });

    socket.addEventListener("close", () => {
      if (active) {
        setInfo("WebSocket closed");
      }
    });

    socket.addEventListener("error", () => {
      setError("WebSocket error");
    });

    return () => {
      active = false;
      socket.close();
      socketRef.current = null;
    };
  }, [navigate, roomId, token]);

  const sendAction = (action: ActionInput): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("WebSocketが未接続です");
      return;
    }
    socket.send(JSON.stringify({ type: "action", action }));
  };

  const sendUndo = (): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("WebSocketが未接続です");
      return;
    }
    socket.send(JSON.stringify({ type: "undo" }));
  };

  const onNameSave = (): void => {
    const next = name.trim() || "Guest";
    localStorage.setItem(NAME_KEY, next);
    setName(next);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "join", name: next }));
    }
  };

  const canEdit = state?.session.canEdit ?? false;
  const currentPlayer = state?.players.find((p) => p.id === state.turn.playerId) ?? null;
  const winner = state?.players.find((p) => p.id === state.winnerPlayerId) ?? null;

  if (!roomId) {
    return null;
  }

  const viewUrl = `${window.location.origin}/room/${roomId}`;
  const editUrl = token ? `${window.location.origin}/room/${roomId}#edit=${token}` : "（編集トークンなし）";

  return (
    <main className="container">
      <section className="panel">
        <header className="room-header">
          <h1>Room: {roomId}</h1>
          <p className="muted">Round: {state?.turn.round ?? "-"}</p>
        </header>

        <div className="inline-fields">
          <input type="text" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          <button type="button" onClick={onNameSave}>
            名前を更新
          </button>
        </div>

        <div className="status-box">
          <strong>手番:</strong> {currentPlayer ? currentPlayer.name : "未設定"}
          {state?.status === "finished" && winner && <p className="winner">勝者: {winner.name}</p>}
        </div>

        <div className="share-links">
          <p>
            <strong>閲覧URL:</strong> <code>{viewUrl}</code>
          </p>
          <p>
            <strong>編集URL:</strong> <code>{editUrl}</code>
          </p>
        </div>

        <section>
          <h2>参加者</h2>
          <table>
            <thead>
              <tr>
                <th>順番</th>
                <th>名前</th>
                <th>得点</th>
                <th>連続ミス</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {state?.players.map((player) => (
                <tr key={player.id} className={player.id === currentPlayer?.id ? "active-row" : ""}>
                  <td>{player.order + 1}</td>
                  <td>{player.name}</td>
                  <td>{player.score}</td>
                  <td>{player.missStreak}</td>
                  <td>{player.eliminated ? "失格" : "参加中"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>入力</h2>
          {!canEdit && <p className="muted">編集トークンがないため閲覧専用モードです。</p>}

          <div className="button-grid">
            {Array.from({ length: 12 }, (_, idx) => idx + 1).map((value) => (
              <button
                key={`single-${value}`}
                type="button"
                onClick={() => sendAction({ type: "single", value })}
                disabled={!canEdit || state?.status === "finished"}
              >
                single {value}
              </button>
            ))}
          </div>

          <div className="button-grid">
            {Array.from({ length: 11 }, (_, idx) => idx + 2).map((value) => (
              <button
                key={`multi-${value}`}
                type="button"
                onClick={() => sendAction({ type: "multi", value })}
                disabled={!canEdit || state?.status === "finished"}
              >
                multi {value}
              </button>
            ))}
          </div>

          <div className="actions-row">
            <button type="button" onClick={() => sendAction({ type: "miss" })} disabled={!canEdit || state?.status === "finished"}>
              miss
            </button>
            <button type="button" onClick={() => sendAction({ type: "foul" })} disabled={!canEdit || state?.status === "finished"}>
              foul
            </button>
            <button type="button" onClick={sendUndo} disabled={!canEdit || state?.status === "finished"}>
              undo
            </button>
          </div>
        </section>

        {info && <p className="info-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
