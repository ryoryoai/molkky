import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchSnapshot, wsUrl } from "../api";
import type { ActionInput, HistoryEntry, Player, RoomState } from "../types";

const NAME_KEY = "molkky:display-name";

type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";
type ScoreMode = "single" | "multi";

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

function isReach(player: Player): boolean {
  return !player.eliminated && player.score >= 38 && player.score < 50;
}

function remainingToWin(player: Player): number {
  return Math.max(0, 50 - player.score);
}

function winningShot(player: Player): number | null {
  return isReach(player) ? remainingToWin(player) : null;
}

function progress(player: Player): number {
  return Math.max(0, Math.min(100, (player.score / 50) * 100));
}

function actionLabel(entry: HistoryEntry): string {
  if (entry.input.type === "single") {
    return `single ${entry.input.value}`;
  }
  if (entry.input.type === "multi") {
    return `multi ${entry.input.value}`;
  }
  if (entry.input.type === "foul") {
    return "foul";
  }
  return "miss";
}

function historyText(entry: HistoryEntry): string {
  const overshoot = entry.delta > 0 && entry.prevScore + entry.delta > 50 && entry.nextScore === 25;
  if (entry.nextScore === 50) {
    return `${actionLabel(entry)} で 50 点`;
  }
  if (overshoot) {
    return `${actionLabel(entry)} で 50 超過 → 25 点`;
  }
  if (entry.input.type === "miss" || entry.input.type === "foul") {
    return `${actionLabel(entry)} (${entry.nextMissStreak}/3)`;
  }
  return `${actionLabel(entry)} (${entry.prevScore} → ${entry.nextScore})`;
}

function connectionLabel(connection: ConnectionState): string {
  if (connection === "open") return "同期しました";
  if (connection === "reconnecting") return "再接続しています";
  if (connection === "closed") return "切断されています";
  return "接続中";
}

function classByPlayerState(player: Player, active: boolean): string {
  const classes = ["player-card", `miss-${Math.min(player.missStreak, 3)}`];
  if (active) classes.push("active");
  if (isReach(player)) classes.push("reach");
  if (player.eliminated) classes.push("retired");
  return classes.join(" ");
}

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "Guest");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [scoreMode, setScoreMode] = useState<ScoreMode>("single");
  const [correctionMode, setCorrectionMode] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const latestNameRef = useRef(name);
  const token = useMemo(() => parseEditToken(window.location.hash), []);
  const players = state?.players ?? [];
  const lastEntry = state?.history.length ? state.history[state.history.length - 1] : null;

  useEffect(() => {
    latestNameRef.current = name;
  }, [name]);

  useEffect(() => {
    if (!lastEntry) {
      setCorrectionMode(false);
    }
  }, [lastEntry?.id]);

  useEffect(() => {
    if (!roomId) {
      navigate("/", { replace: true });
      return;
    }

    let active = true;

    const clearReconnectTimer = (): void => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const endpoint = new URL(wsUrl(`/api/room/${encodeURIComponent(roomId)}/ws`));
    if (token) {
      endpoint.searchParams.set("token", token);
    }

    const connect = (): void => {
      if (!active) return;
      setConnection((prev) => (prev === "open" ? "reconnecting" : "connecting"));

      const socket = new WebSocket(endpoint);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (!active) return;
        setConnection("open");
        setError("");
        const joinName = latestNameRef.current.trim() || "Guest";
        socket.send(JSON.stringify({ type: "join", name: joinName }));
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
          return;
        }

        if (message.type === "error" && message.message) {
          setError(message.message);
          return;
        }

        if (message.type === "info" && message.message) {
          setInfo(message.message);
        }
      });

      socket.addEventListener("close", () => {
        if (!active) return;
        setConnection("reconnecting");
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      });

      socket.addEventListener("error", () => {
        if (!active) return;
        setError("WebSocket error");
      });
    };

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

    connect();

    return () => {
      active = false;
      clearReconnectTimer();
      setConnection("closed");
      socketRef.current?.close();
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

  const sendCorrectLast = (action: ActionInput): void => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("WebSocketが未接続です");
      return;
    }
    socket.send(JSON.stringify({ type: "correct_last", action }));
    setCorrectionMode(false);
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

  if (!roomId) {
    return null;
  }

  const canEdit = state?.session.canEdit ?? false;
  const currentPlayer = players.find((player) => player.id === state?.turn.playerId) ?? null;
  const winner = players.find((player) => player.id === state?.winnerPlayerId) ?? null;
  const correctionTarget = lastEntry ? players.find((player) => player.id === lastEntry.playerId) : null;

  const lastMessage = (() => {
    if (state?.status === "finished" && winner) {
      return `${winner.name} が勝利しました`;
    }
    if (lastEntry) {
      const actor = players.find((player) => player.id === lastEntry.playerId);
      return actor ? `${actor.name}: ${historyText(lastEntry)}` : historyText(lastEntry);
    }
    if (currentPlayer) {
      return `${currentPlayer.name} さんの番です`;
    }
    return "参加待ち";
  })();

  const encodedRoomId = encodeURIComponent(roomId);
  const viewUrl = `${window.location.origin}/room/${encodedRoomId}`;
  const editUrl = token ? `${window.location.origin}/room/${encodedRoomId}#edit=${token}` : "（編集トークンなし）";

  const scoreValues = scoreMode === "single" ? Array.from({ length: 12 }, (_, idx) => idx + 1) : Array.from({ length: 11 }, (_, idx) => idx + 2);
  const currentWinningShot = currentPlayer ? winningShot(currentPlayer) : null;
  const canInput =
    canEdit &&
    connection === "open" &&
    state?.status === "ongoing" &&
    Boolean(currentPlayer) &&
    !currentPlayer?.eliminated;
  const canCorrect = canEdit && connection === "open" && Boolean(lastEntry);
  const scorepadEnabled = correctionMode ? canCorrect : canInput;
  const scorepadTitle = correctionMode
    ? `${correctionTarget?.name ?? "直前入力"} を訂正`
    : currentPlayer
      ? `${currentPlayer.name} の得点入力`
      : "得点入力";
  const scorepadNote = correctionMode
    ? "下のボタンで正しい結果に置き換えます。手番と得点はサーバーで再計算されます。"
    : currentPlayer && isReach(currentPlayer)
      ? `${currentWinningShot} 点で勝ち。50 を超えると 25 点へ戻ります。`
      : "1本だけ倒したら single、2本以上は multi を選んで入力します。";

  return (
    <main className="app">
      <div className="shell">
        <section className="panel card">
          <div className="game-header">
            <div className="title-wrap">
              <h1>Room: {roomId}</h1>
              <p className="subtitle">モルックの試合をリアルタイム同期しています。</p>
            </div>
            <div className="top-actions">
              <span className={`pill connection ${connection}`}>
                <span className="status-dot" aria-hidden="true" />
                {connectionLabel(connection)}
              </span>
              <button type="button" className="ghost-btn" onClick={sendUndo} disabled={!canInput || !state?.history.length}>
                取り消す
              </button>
              <button
                type="button"
                className={`ghost-btn ${correctionMode ? "active-toggle" : ""}`}
                onClick={() => setCorrectionMode((prev) => !prev)}
                disabled={!canCorrect}
              >
                {correctionMode ? "訂正を終了" : "直前を訂正"}
              </button>
            </div>
          </div>

          <div className="identity-row">
            <input type="text" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={24} />
            <button type="button" className="mini-btn" onClick={onNameSave}>
              名前を更新
            </button>
          </div>

          <div className="share-list">
            <p>
              <strong>閲覧URL:</strong> <code>{viewUrl}</code>
            </p>
            <p>
              <strong>編集URL:</strong> <code>{editUrl}</code>
            </p>
          </div>
        </section>

        {!state && (
          <section className="panel card">
            <p className="subtitle">試合状態を読み込み中です...</p>
          </section>
        )}

        {state && players.length === 0 && (
          <section className="setup-card card">
            <div className="title-row">
              <div className="title-wrap">
                <h2>参加待ち</h2>
                <p className="subtitle">参加者が接続するとレーンが表示されます。</p>
              </div>
              <span className="pill">ルーム共有中</span>
            </div>
          </section>
        )}

        {state && players.length > 0 && (
          <section className="game-layout">
            <div className="game-main">
              {currentPlayer && (
                <section className={`hero card ${isReach(currentPlayer) ? "reach" : ""} miss-${Math.min(currentPlayer.missStreak, 3)} ${currentPlayer.eliminated ? "retired" : ""}`}>
                  <div className="hero-top">
                    <div>
                      <div className="turn-pill">いま投げる人</div>
                      <h2 className="hero-title">{currentPlayer.name}</h2>
                      <p className="hero-sub">{isReach(currentPlayer) ? `リーチ中。次に ${currentWinningShot} 点で勝利です。` : "50 点ちょうどを目指します。"}</p>
                    </div>
                    <div className="badge-row">
                      {isReach(currentPlayer) && <span className="badge reach">リーチ</span>}
                      {currentPlayer.missStreak > 0 && <span className="badge warn">miss {currentPlayer.missStreak}/3</span>}
                      {currentPlayer.eliminated && <span className="badge out">失格</span>}
                    </div>
                  </div>

                  <div className="hero-score-row">
                    <div className="hero-score">{currentPlayer.score}</div>
                    <div className="meta-stack">
                      <div className="meta-box">
                        <span className="meta-label">50まで</span>
                        <span className="meta-value">あと {remainingToWin(currentPlayer)} 点</span>
                      </div>
                      <div className="meta-box">
                        <span className="meta-label">ラウンド</span>
                        <span className="meta-value">{state.turn.round}</span>
                      </div>
                    </div>
                  </div>

                  {isReach(currentPlayer) && (
                    <div className="reach-callout" aria-live="polite">
                      <div className="reach-copy">
                        <div className="reach-label">勝負どころ</div>
                        <span>次に {currentWinningShot} 点で 50 点ちょうど。超えると 25 点に戻ります。</span>
                      </div>
                      <div className="reach-target">{currentWinningShot} で勝ち</div>
                    </div>
                  )}

                  <div className="progress" aria-hidden="true">
                    <div className="progress-fill" style={{ width: `${progress(currentPlayer)}%` }} />
                  </div>

                  <div className="miss-strip">
                    <span>連続 miss</span>
                    <span className="miss-dots" aria-label={`連続 miss ${currentPlayer.missStreak} 回`}>
                      {Array.from({ length: 3 }, (_, idx) => (
                        <span key={idx} className={`miss-dot ${currentPlayer.missStreak > idx ? "on" : ""}`} />
                      ))}
                    </span>
                  </div>

                  <div className="message" aria-live="polite">
                    {lastMessage}
                  </div>
                </section>
              )}

              <section className="panel card">
                <div className="title-row">
                  <div className="title-wrap">
                    <h3>スコアボード</h3>
                    <p className="subtitle">点数の大きさと進捗バーで、50までの距離を一目で把握できます。</p>
                  </div>
                  <span className="pill">{players.length} 人</span>
                </div>

                <div className="players-grid">
                  {players.map((player) => {
                    const active = player.id === state.turn.playerId;
                    const reach = winningShot(player);

                    return (
                      <article key={player.id} className={classByPlayerState(player, active)}>
                        <div className="player-top">
                          <div className="player-name">{player.name}</div>
                          {active && !player.eliminated && <span className="badge safe">番</span>}
                        </div>
                        <div className="player-score">{player.score}</div>
                        <div className="player-meta">
                          <span>あと {remainingToWin(player)} 点</span>
                          <span>miss {player.missStreak}/3</span>
                        </div>
                        <div className="progress" aria-hidden="true">
                          <div className="progress-fill" style={{ width: `${progress(player)}%` }} />
                        </div>
                        <div className="miss-strip">
                          <span className="miss-dots" aria-hidden="true">
                            {Array.from({ length: 3 }, (_, idx) => (
                              <span key={idx} className={`miss-dot ${player.missStreak > idx ? "on" : ""}`} />
                            ))}
                          </span>
                          <span>
                            {player.eliminated ? "失格" : isReach(player) ? `${reach} で勝ち` : "プレイ中"}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>

            <aside className="game-side">
              <section className={`scorepad card ${currentPlayer && isReach(currentPlayer) ? "reach-mode" : ""}`}>
                <div className="scorepad-head">
                  <div>
                    <h3>{scorepadTitle}</h3>
                    <div className="scorepad-note">{scorepadNote}</div>
                  </div>
                  <span className="pill">{canEdit ? "編集可能" : "閲覧専用"}</span>
                </div>

                {correctionMode && lastEntry && (
                  <div className="correction-banner" aria-live="polite">
                    直前: {correctionTarget?.name ?? "unknown"} / {historyText(lastEntry)}
                  </div>
                )}

                <div className="mode-switch" role="tablist" aria-label="score mode">
                  <button
                    type="button"
                    className={`mode-btn ${scoreMode === "single" ? "active" : ""}`}
                    onClick={() => setScoreMode("single")}
                    disabled={!scorepadEnabled}
                  >
                    single
                  </button>
                  <button
                    type="button"
                    className={`mode-btn ${scoreMode === "multi" ? "active" : ""}`}
                    onClick={() => setScoreMode("multi")}
                    disabled={!scorepadEnabled}
                  >
                    multi
                  </button>
                </div>

                <div className="score-grid">
                  {scoreValues.map((value) => {
                    const isFinisher = currentWinningShot === value;
                    return (
                      <button
                        key={`${scoreMode}-${value}`}
                        type="button"
                        className={`score-btn ${isFinisher ? "finisher" : ""}`}
                        onClick={() =>
                          correctionMode ? sendCorrectLast({ type: scoreMode, value }) : sendAction({ type: scoreMode, value })
                        }
                        disabled={!scorepadEnabled}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>

                <div className="action-row compact">
                  <button
                    type="button"
                    className="miss-btn"
                    onClick={() => (correctionMode ? sendCorrectLast({ type: "miss" }) : sendAction({ type: "miss" }))}
                    disabled={!scorepadEnabled}
                  >
                    miss
                  </button>
                  <button
                    type="button"
                    className="miss-btn foul"
                    onClick={() => (correctionMode ? sendCorrectLast({ type: "foul" }) : sendAction({ type: "foul" }))}
                    disabled={!scorepadEnabled}
                  >
                    foul
                  </button>
                </div>

                {!canEdit && <p className="readonly-note">編集トークンがないため閲覧専用です。</p>}
              </section>

              <section className="panel card">
                <div className="title-row">
                  <div className="title-wrap">
                    <h3>履歴</h3>
                    <p className="subtitle">最新 8 手を表示しています。</p>
                  </div>
                  <span className="pill">{state.history.length} 手</span>
                </div>

                <div className="history-list">
                  {state.history.length === 0 && (
                    <div className="history-item">
                      <div className="history-main">
                        <strong>まだ履歴はありません</strong>
                        <span className="muted">最初の入力がここに表示されます。</span>
                      </div>
                      <div className="history-score">-</div>
                    </div>
                  )}

                  {state.history
                    .slice()
                    .reverse()
                    .slice(0, 8)
                    .map((entry) => {
                      const actor = players.find((player) => player.id === entry.playerId);
                      return (
                        <div className="history-item" key={entry.id}>
                          <div className="history-main">
                            <strong>{actor?.name ?? "unknown"}</strong>
                            <span className="muted">{historyText(entry)}</span>
                          </div>
                          <div className="history-score">
                            {entry.prevScore} → {entry.nextScore}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            </aside>
          </section>
        )}

        {state?.status === "finished" && (
          <section className="finish card">
            <div className="winner-mark">🏆</div>
            <h2 className="winner-name">{winner ? `${winner.name} の勝利` : "試合終了"}</h2>
            <p className="finish-text">最終スコアを確認して、同じルームで次の試合を始めてください。</p>
          </section>
        )}

        {info && <p className="info-text">{info}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </main>
  );
}
