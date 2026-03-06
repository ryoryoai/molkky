import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api";

const NAME_KEY = "molkky:display-name";

function readSavedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState<string>(() => readSavedName());
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizedRoomId = useMemo(() => roomId.trim(), [roomId]);

  const persistName = (): string => {
    const n = name.trim();
    if (n.length > 0) {
      localStorage.setItem(NAME_KEY, n);
      return n;
    }
    return "Guest";
  };

  const onCreate = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const finalName = persistName();
      const created = await createRoom();
      navigate(`/room/${encodeURIComponent(created.roomId)}#edit=${created.editToken}`, {
        state: { name: finalName }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "ルーム作成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const onJoin = (event: FormEvent): void => {
    event.preventDefault();
    setError("");

    if (!normalizedRoomId) {
      setError("roomId を入力してください");
      return;
    }

    persistName();
    navigate(`/room/${encodeURIComponent(normalizedRoomId)}`);
  };

  return (
    <main className="app">
      <div className="shell">
        <section className="setup-card card">
          <div className="title-row">
            <div className="title-wrap">
              <h1>Molkky Score Sync</h1>
              <p className="subtitle">モルックのスコアを、試合の流れを崩さずリアルタイム同期。</p>
            </div>
            <span className="pill">観戦URL / 編集URL を分離</span>
          </div>

          <div className="draft-list compact">
            <label className="field-block" htmlFor="display-name">
              <span>表示名</span>
              <input
                id="display-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例: Taro"
                maxLength={24}
              />
            </label>
          </div>

          <div className="setup-actions">
            <button type="button" className="primary-btn" onClick={() => void onCreate()} disabled={loading}>
              {loading ? "作成中..." : "ルームをつくる"}
            </button>
          </div>

          <form onSubmit={onJoin} className="join-form">
            <label className="field-block" htmlFor="room-id">
              <span>ルームID</span>
              <input
                id="room-id"
                type="text"
                value={roomId}
                onChange={(event) => setRoomId(event.currentTarget.value)}
                placeholder="roomId"
              />
            </label>
            <button type="submit" className="ghost-btn">
              ルームに入る
            </button>
          </form>

          <div className="tip-grid">
            <div className="tip">
              <strong>編集トークン方式</strong>
              入力できるのは編集URLだけ。観戦URLは読み取り専用です。
            </div>
            <div className="tip">
              <strong>サーバー正の進行</strong>
              手番とルール計算はDurable Objectで一元管理します。
            </div>
            <div className="tip">
              <strong>undoは直前1手</strong>
              誤入力に対応しつつ、競技進行を止めません。
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
        </section>
      </div>
    </main>
  );
}
