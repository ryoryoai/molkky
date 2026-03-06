import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { fetchSnapshot, wsUrl } from "../api";
import type { ActionInput, Player, RoomState } from "../types";

const NAME_KEY = "molkky:display-name";
const TARGET_SCORE = 50;
const MIDPOINT_SCORE = 25;
const REACH_SCORE = 38;
const OUT_MISS_COUNT = 3;

interface ServerMessage {
  type: "state" | "error" | "info";
  fullState?: RoomState;
  message?: string;
}

type MobileTab = "input" | "board";
type BadgeTone = "neutral" | "mid" | "reach" | "danger" | "win";

interface PlayerBadge {
  tone: BadgeTone;
  label: string;
}

function parseEditToken(hash: string): string | null {
  if (!hash.startsWith("#")) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  return params.get("edit");
}

function getRemaining(score: number): number {
  return Math.max(0, TARGET_SCORE - score);
}

function getPlayerBadges(player: Player, winnerPlayerId: string | null): PlayerBadge[] {
  if (player.id === winnerPlayerId) {
    return [{ tone: "win", label: "WIN" }];
  }

  if (player.eliminated || player.missStreak >= OUT_MISS_COUNT) {
    return [{ tone: "danger", label: "OUT" }];
  }

  const badges: PlayerBadge[] = [];
  if (player.score >= MIDPOINT_SCORE) {
    badges.push({ tone: "mid", label: "25+ 中間" });
  }
  if (player.score >= REACH_SCORE && player.score < TARGET_SCORE) {
    badges.push({ tone: "reach", label: "REACH" });
  }
  if (player.missStreak === OUT_MISS_COUNT - 1) {
    badges.push({ tone: "danger", label: "MISS あと1" });
  }
  if (badges.length === 0) {
    badges.push({ tone: "neutral", label: "通常" });
  }
  return badges;
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "Guest");
  const [mobileTab, setMobileTab] = useState<MobileTab>("input");

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
  const winnerPlayerId = state?.winnerPlayerId ?? null;
  const currentMiss = currentPlayer?.missStreak ?? 0;
  const isFinished = state?.status === "finished";
  const canOperate = canEdit && !isFinished;
  const columnsClassName = `room-columns ${mobileTab === "input" ? "show-input" : "show-board"}`;

  if (!roomId) {
    return null;
  }

  const encodedRoomId = encodeURIComponent(roomId);
  const viewUrl = `${window.location.origin}/room/${encodedRoomId}`;
  const editUrl = token ? `${window.location.origin}/room/${encodedRoomId}#edit=${token}` : "（編集トークンなし）";

  return (
    <main className="container">
      <section className="panel game-panel">
        <header className="room-header">
          <div>
            <h1>Room: {roomId}</h1>
            <p className="muted">25点で中間地点 / 38点からリーチ / miss・foul 3回でOUT</p>
          </div>
          <p className="room-meta">Round: {state?.turn.round ?? "-"}</p>
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
          <div className="qr-grid">
            <figure className="qr-card">
              <figcaption>閲覧QR（仲間向け）</figcaption>
              <QRCodeSVG value={viewUrl} size={168} level="M" includeMargin />
              <small className="muted">読み取るとこのルームを開きます。</small>
            </figure>
            {token && (
              <figure className="qr-card">
                <figcaption>編集QR（スコア入力あり）</figcaption>
                <QRCodeSVG value={editUrl} size={168} level="M" includeMargin />
                <small className="warning-text">編集QRは運営メンバーのみに共有してください。</small>
              </figure>
            )}
          </div>
        </div>

        <div className="mobile-tabs" role="tablist" aria-label="表示切替">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "input"}
            className={`tab-button ${mobileTab === "input" ? "tab-active" : ""}`}
            onClick={() => setMobileTab("input")}
          >
            入力
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "board"}
            className={`tab-button ${mobileTab === "board" ? "tab-active" : ""}`}
            onClick={() => setMobileTab("board")}
          >
            スコアボード
          </button>
        </div>

        <div className={columnsClassName}>
          <section className="column-panel input-column">
            <h2>入力パネル</h2>

            <article className="player-focus">
              <p className="muted">現在の手番</p>
              <h3>{currentPlayer ? currentPlayer.name : "未設定"}</h3>

              {currentPlayer ? (
                <>
                  <div className="focus-stats">
                    <div className="stat-card">
                      <p className="stat-label">今の点数</p>
                      <p className="stat-value">{currentPlayer.score}</p>
                    </div>
                    <div className="stat-card">
                      <p className="stat-label">残り点</p>
                      <p className="stat-value">{getRemaining(currentPlayer.score)}</p>
                    </div>
                    <div className={`stat-card ${currentMiss >= OUT_MISS_COUNT - 1 ? "risk" : ""}`}>
                      <p className="stat-label">失敗</p>
                      <p className="stat-value">
                        {currentMiss}/{OUT_MISS_COUNT}
                      </p>
                      <div className="miss-track" aria-label="失敗カウント">
                        {Array.from({ length: OUT_MISS_COUNT }, (_, idx) => (
                          <span key={`miss-${idx}`} className={`miss-dot ${idx < currentMiss ? "on" : ""}`} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="badge-list">
                    {getPlayerBadges(currentPlayer, winnerPlayerId).map((badge) => (
                      <span
                        key={`focus-${currentPlayer.id}-${badge.label}`}
                        className={`status-badge status-${badge.tone}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">プレイヤー待機中です。</p>
              )}
            </article>

            {!canEdit && <p className="muted">編集トークンがないため閲覧専用モードです。</p>}

            <div className="button-grid">
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((value) => (
                <button
                  key={`single-${value}`}
                  type="button"
                  onClick={() => sendAction({ type: "single", value })}
                  disabled={!canOperate}
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
                  disabled={!canOperate}
                >
                  multi {value}
                </button>
              ))}
            </div>

            <div className="actions-row">
              <button type="button" onClick={() => sendAction({ type: "miss" })} disabled={!canOperate}>
                miss
              </button>
              <button type="button" onClick={() => sendAction({ type: "foul" })} disabled={!canOperate}>
                foul
              </button>
              <button type="button" onClick={sendUndo} disabled={!canOperate}>
                undo
              </button>
            </div>
          </section>

          <section className="column-panel board-column">
            <h2>スコアボード</h2>
            <div className="legend-row">
              <span className="status-badge status-mid">25+ 中間</span>
              <span className="status-badge status-reach">REACH (38-49)</span>
              <span className="status-badge status-danger">MISS 3でOUT</span>
            </div>

            <div className="table-wrap">
              <table className="score-table">
                <thead>
                  <tr>
                    <th>順番</th>
                    <th>名前</th>
                    <th>得点</th>
                    <th>残り</th>
                    <th>失敗</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {state?.players.map((player) => {
                    const rowClasses = [
                      player.id === currentPlayer?.id ? "active-row" : "",
                      player.id === winnerPlayerId ? "winner-row" : "",
                      player.eliminated ? "eliminated-row" : ""
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <tr key={player.id} className={rowClasses}>
                        <td>{player.order + 1}</td>
                        <td>{player.name}</td>
                        <td>{player.score}</td>
                        <td>{getRemaining(player.score)}</td>
                        <td>
                          {player.missStreak}/{OUT_MISS_COUNT}
                        </td>
                        <td>
                          <div className="badge-list">
                            {getPlayerBadges(player, winnerPlayerId).map((badge) => (
                              <span
                                key={`board-${player.id}-${badge.label}`}
                                className={`status-badge status-${badge.tone}`}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {info && <p className="info-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
