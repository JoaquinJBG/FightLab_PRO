"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useProfile } from "@/lib/hooks";
import {
  PREF_KEYS,
  currentSubscription,
  disablePush,
  enablePush,
  pushSupport,
  resyncPush,
  usePushState,
  useSavePrefs,
  useTestPush,
  vapidPublicKey,
  type Support,
} from "@/lib/push";

type Device = "unknown" | "on" | "off";
type Permission = NotificationPermission | "unknown";

const noSubscribe = () => () => {};
const readPermission = (): Permission => (typeof Notification === "undefined" ? "unknown" : Notification.permission);
// "denied" / "blocked": se pidió el permiso y no quedó concedido. Chrome puede dejarlo en
// `default` sin preguntar (notificaciones apagadas en Android: "blocked") o en `denied`; en los
// dos casos se explica cómo activarlo (F8 de la prueba en móvil).
type Notice = "error" | "denied" | "blocked" | "testSent" | "testFailed" | null;

const section = "glass rise mt-4 p-4";

function Switch({ id, checked, onChange, label, body }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; body: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 border-b border-[rgba(150,190,255,0.08)] py-3 last:border-0">
      <span>
        <span className="t-label block text-ink">{label}</span>
        <span className="t-body block text-xs text-muted">{body}</span>
      </span>
      <input
        data-testid={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-[#35e6ff]"
      />
    </label>
  );
}

/** Cómo dar el permiso de avisos a mano, en Android y en iPhone. */
function PermissionHelp({ denied }: { denied: boolean }) {
  const t = useTranslations("reminders.help");
  return (
    <div data-testid="reminders-permission-help" role="alert" className="mt-3 rounded-2xl border border-[rgba(255,210,90,0.3)] bg-[rgba(255,210,90,0.06)] p-3">
      <p className="t-label text-warn">{denied ? t("titleDenied") : t("titleDefault")}</p>
      <ul className="t-body mt-2 list-disc space-y-1.5 pl-4 text-xs text-ink">
        <li>{t("android")}</li>
        <li>{t("ios")}</li>
      </ul>
      <p className="t-body mt-2 text-xs text-muted">{t("retry")}</p>
    </div>
  );
}

export function RemindersSettings() {
  const t = useTranslations("reminders");
  const qc = useQueryClient();
  const key = vapidPublicKey();
  const { data: state, isLoading } = usePushState();
  const { data: profile } = useProfile();
  const savePrefs = useSavePrefs();
  const test = useTestPush();
  // Dependen del navegador: en el servidor no se saben ("unknown") y se leen al hidratar.
  const support = useSyncExternalStore<Support | "unknown">(noSubscribe, pushSupport, () => "unknown");
  const permission = useSyncExternalStore<Permission>(noSubscribe, readPermission, () => "unknown");
  const [device, setDevice] = useState<Device>("unknown");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  // ¿Este navegador ya estaba suscrito? Si lo está, se vuelve a mandar al backend.
  useEffect(() => {
    if (support !== "ok" || !key) return;
    let alive = true;
    currentSubscription()
      .then(async (sub) => {
        if (!alive) return;
        setDevice(sub ? "on" : "off");
        if (sub && (await resyncPush().catch(() => false))) qc.invalidateQueries({ queryKey: ["push"] });
      })
      .catch(() => alive && setDevice("off"));
    return () => {
      alive = false;
    };
  }, [support, key, qc]);

  const serverOff = !!state && (!state.configured || (state.public_key !== null && state.public_key !== key));

  const enable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const permission = await enablePush(key);
      if (permission === "granted") {
        setDevice("on");
        qc.invalidateQueries({ queryKey: ["push"] });
      } else {
        setNotice(permission === "denied" ? "denied" : "blocked");
      }
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await disablePush();
      setDevice("off");
      qc.invalidateQueries({ queryKey: ["push"] });
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };
  const sendTest = () =>
    test.mutate(undefined, {
      onSuccess: (data) => setNotice((data as { ok?: number }).ok ? "testSent" : "testFailed"),
      onError: () => setNotice("testFailed"),
    });

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
      <p className="t-body mt-1 text-sm text-muted">{t("intro")}</p>

      {!key || serverOff ? (
        <section data-testid="reminders-off" className={`${section} neon-edge`} role="status">
          <p className="t-label text-ink">{t("off.title")}</p>
          <p className="t-body mt-1 text-sm text-muted">{!key ? t("off.noKey") : t("off.server")}</p>
        </section>
      ) : support === "unknown" ? (
        <div className="glass mt-4 h-24 animate-pulse rounded-3xl" aria-label={t("loading")} />
      ) : support !== "ok" ? (
        <section data-testid="reminders-unsupported" className={`${section} neon-edge`} role="status">
          <p className="t-body text-sm text-ink">{support === "ios-browser" ? t("support.iosNow") : t("support.unsupported")}</p>
        </section>
      ) : (
        <section data-testid="reminders-device" className={section}>
          <p className="t-label text-ink">{t("device.title")}</p>
          <p className="t-body mt-1 text-sm text-muted">{device === "on" ? t("device.on") : t("device.offState")}</p>
          {device === "on" ? (
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" data-testid="reminders-test" className="btn btn-tonal btn-sm" disabled={test.isPending} onClick={sendTest}>
                {t("device.test")}
              </button>
              <button type="button" data-testid="reminders-disable" className="btn btn-outline btn-sm" disabled={busy} onClick={disable}>
                {t("device.disable")}
              </button>
            </div>
          ) : (
            <button type="button" data-testid="reminders-enable" className="btn btn-primary btn-sm mt-3 w-full" disabled={busy || device === "unknown"} onClick={enable}>
              {t("device.enable")}
            </button>
          )}
          {state && <p className="t-body mt-2 text-[11px] text-muted">{t("device.devices", { count: state.devices })}</p>}
          {device !== "on" && (notice === "denied" || notice === "blocked" || (!notice && permission === "denied")) && (
            <PermissionHelp denied={notice === "denied" || permission === "denied"} />
          )}
          {notice && notice !== "denied" && notice !== "blocked" && (
            <p role={notice === "testSent" ? "status" : "alert"} className={`t-body mt-2 text-xs ${notice === "testSent" ? "text-good" : "text-warn"}`}>
              {notice === "error" ? t("device.error") : t(`device.${notice}`)}
            </p>
          )}
        </section>
      )}

      <section className={section}>
        <p className="t-label text-ink">{t("kinds.title")}</p>
        {isLoading || !state ? (
          <div className="mt-2 h-24 animate-pulse rounded-2xl bg-white/5" aria-label={t("loading")} />
        ) : (
          <div className="mt-1">
            {PREF_KEYS.map((k) => (
              <Switch
                key={k}
                id={`pref-${k}`}
                checked={state.prefs[k]}
                onChange={(v) => savePrefs.mutate({ [k]: v })}
                label={t(`kinds.${k}`)}
                body={t(`kinds.${k}Body`)}
              />
            ))}
          </div>
        )}
      </section>

      <section className={section}>
        <p className="t-label text-ink">{t("hours.title")}</p>
        <p className="t-body mt-1 text-xs text-muted">{t("hours.body", { tz: profile?.timezone ?? "UTC" })}</p>
      </section>

      <section className={section}>
        <p className="t-label text-ink">{t("support.title")}</p>
        <ul className="t-body mt-1 list-disc space-y-1 pl-4 text-xs text-muted">
          <li>{t("support.android")}</li>
          <li>{t("support.ios")}</li>
        </ul>
      </section>
    </div>
  );
}
