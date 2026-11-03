"use client";

import { useEffect, useMemo, useState } from "react";

// 2026-11-03 24:00 at UTC+8, represented in UTC for an unambiguous cutoff.
const LUMINA_SHUTDOWN_AT = Date.parse("2026-11-03T16:00:00.000Z");

function getRemaining() {
  const total = Math.max(0, LUMINA_SHUTDOWN_AT - Date.now());
  const seconds = Math.floor(total / 1000);
  return {
    closed: total <= 0,
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const [remaining, setRemaining] = useState(getRemaining);

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(getRemaining()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const title = useMemo(() => (remaining.closed ? "Lumina 已关闭" : "Lumina 服务维护倒计时"), [remaining.closed]);

  if (remaining.closed) {
    return <MaintenanceScreen title={title} closed />;
  }

  void children;
  return <MaintenanceScreen title={title} />;
}

function MaintenanceScreen({
  title,
  closed = false,
}: {
  title: string;
  closed?: boolean;
}) {
  const remaining = getRemaining();

  if (closed) {
    return (
      <main className="lumina-maintenance-page">
        <div className="lumina-maintenance-orbit"><span>L</span></div>
        <p className="lumina-maintenance-eyebrow">LUMINA WALLET</p>
        <h1>{title}</h1>
        <p className="lumina-maintenance-copy">Lumina Wallet 已停止运营，前台功能已关闭。感谢你曾经使用 Lumina。</p>
      </main>
    );
  }

  return (
    <main className="lumina-maintenance-page">
      <div className="lumina-maintenance-orbit"><span>L</span></div>
      <p className="lumina-maintenance-eyebrow">LUMINA WALLET</p>
      <h1>{title}</h1>
      <p className="lumina-maintenance-copy">Lumina 将于今天 UTC+8 24:00 关闭前台服务。请在关闭前完成必要的资产操作。</p>
      <div className="lumina-maintenance-countdown" aria-label="Maintenance countdown">
        <div><strong>{remaining.days}</strong><span>天</span></div>
        <div><strong>{pad(remaining.hours)}</strong><span>时</span></div>
        <div><strong>{pad(remaining.minutes)}</strong><span>分</span></div>
        <div><strong>{pad(remaining.seconds)}</strong><span>秒</span></div>
      </div>
      <p className="lumina-maintenance-note">Scheduled shutdown: 2026-11-03 24:00 (UTC+8)</p>
    </main>
  );
}
