import Link from "next/link";

export default function NotFound() {
  return (
    <div className="app">
      <div className="frame" style={{ flexDirection: "column" }}>
        <div className="auth">
          <section className="card auth__card" style={{ textAlign: "center", alignItems: "center" }}>
            <h1 className="t-display">404</h1>
            <p className="t-label">الصفحة دي مش موجودة.</p>
            <Link href="/" className="btn btn--ink">
              رجوع للوحة المحفظة
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
