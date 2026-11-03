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

  const title = useMemo(() => (remaining.closed ? "Lumina is closed" : "Lumina shutdown countdown"), [remaining.closed]);

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
        <p className="lumina-maintenance-copy">Lumina Wallet operations have ended and the public app is now closed. Thank you for using Lumina.</p>
      </main>
    );
  }

  return (
    <main className="lumina-maintenance-page">
      <div className="lumina-maintenance-orbit"><span>L</span></div>
      <p className="lumina-maintenance-eyebrow">LUMINA WALLET</p>
      <h1>{title}</h1>
      <p className="lumina-maintenance-copy">Lumina will close its public services today at 24:00 UTC+8. Please complete any necessary asset actions before the shutdown.</p>
      <div className="lumina-maintenance-countdown" aria-label="Maintenance countdown">
        <div><strong>{remaining.days}</strong><span>Days</span></div>
        <div><strong>{pad(remaining.hours)}</strong><span>Hours</span></div>
        <div><strong>{pad(remaining.minutes)}</strong><span>Minutes</span></div>
        <div><strong>{pad(remaining.seconds)}</strong><span>Seconds</span></div>
      </div>
      <p className="lumina-maintenance-note">Scheduled shutdown: 2026-11-03 24:00 (UTC+8)</p>
    </main>
  );
}
