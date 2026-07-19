import { FormEvent, useState } from "react";

type LoginPageProps = {
  pending: boolean;
  error: "invalid" | "rate_limited" | "offline" | null;
  retryAfterSeconds?: number;
  onLogin: (username: string, password: string) => Promise<void> | void;
};

export function LoginPage({ pending, error, retryAfterSeconds, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(username, password);
    setPassword("");
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <span className="login-kicker">BallBallChu Odds</span>
          <h1>登入 Dashboard</h1>
        </div>
        <label>
          <span>用戶名</span>
          <input autoComplete="username" disabled={pending} onChange={(event) => setUsername(event.target.value)} value={username} />
        </label>
        <label>
          <span>密碼</span>
          <input autoComplete="current-password" disabled={pending} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </label>
        {error ? <p className="login-error" role="alert">{loginMessage(error, retryAfterSeconds)}</p> : null}
        <button disabled={pending || !username || !password} type="submit">
          {pending ? "登入中..." : "登入"}
        </button>
      </form>
    </main>
  );
}

function loginMessage(error: LoginPageProps["error"], retryAfterSeconds?: number): string {
  if (error === "rate_limited") return `登入太多次，請等 ${Math.ceil((retryAfterSeconds ?? 0) / 60)} 分鐘再試。`;
  if (error === "offline") return "暫時連唔到系統，請稍後再試。";
  return "用戶名或密碼不正確。";
}
