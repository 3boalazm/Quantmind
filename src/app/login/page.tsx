import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="app">
      <div className="frame" style={{ flexDirection: "column" }}>
        <div className="auth">
          <LoginForm configured={Boolean(process.env.APP_PASSWORD)} />
        </div>
      </div>
    </div>
  );
}
