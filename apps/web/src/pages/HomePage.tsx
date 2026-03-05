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
      navigate(`/room/${created.roomId}#edit=${created.editToken}`, {
        state: { name: finalName }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "ルーム作成に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const onJoin = (e: FormEvent): void => {
    e.preventDefault();
    setError("");
    if (!normalizedRoomId) {
      setError("roomId を入力してください");
      return;
    }
    persistName();
    navigate(`/room/${normalizedRoomId}`);
  };

  return (
    <main className="container">
      <section className="panel">
        <h1>Molkky Score Sync</h1>
        <p className="muted">リアルタイムでスコアと手番を同期</p>

        <label className="field">
          <span>表示名</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例: Taro"
          />
        </label>

        <div className="actions-row">
          <button type="button" onClick={() => void onCreate()} disabled={loading}>
            {loading ? "作成中..." : "新規ルーム作成"}
          </button>
        </div>

        <form onSubmit={onJoin} className="join-form">
          <label className="field">
            <span>参加する roomId</span>
            <input
              type="text"
              value={roomId}
              onChange={(event) => setRoomId(event.currentTarget.value)}
              placeholder="roomId"
            />
          </label>
          <button type="submit">ルーム参加</button>
        </form>

        {error && <p className="error-text">{error}</p>}
      </section>
    </main>
  );
}
