"use client";

import { useEffect, useState } from "react";
import {
  disconnectGoogleCalendarAction,
  loadOrderNotifications,
  saveOrderNotificationsAction,
  testOrderNotificationAction,
} from "@/app/actions/order-notifications-admin";
import type { OrderNotificationsDTO } from "@/lib/order-notifications";
import { adminClass } from "@/components/admin/tokens";
import { showAdminToast } from "@/components/admin/toast";

/**
 * The order notification settings.
 *
 * A single record with two independent channels (email via SMTP and
 * Telegram), so there is no list page — the form is the page. Each channel
 * has its own "Kirim Tes" button that sends a test message with the current
 * (possibly unsaved) values, and one shared "Simpan" at the bottom.
 */
export default function NotificationsSettingsForm() {
  const [values, setValues] = useState<OrderNotificationsDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"smtp" | "telegram" | "googleCalendar" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const settings = await loadOrderNotifications();
      setValues(settings);
    })();
  }, []);

  // Report the result of the "Hubungkan Google Calendar" OAuth round-trip —
  // the callback route redirects back here with a status query parameter.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gc");
    if (!status) return;
    if (status === "ok") {
      showAdminToast(
        `Akun Google berhasil dihubungkan${params.get("email") ? `: ${params.get("email")}` : ""}.`,
      );
    } else {
      showAdminToast(params.get("msg") ?? "Gagal menghubungkan akun Google.", "error");
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!values) {
    return (
      <div className={`${adminClass.panel} px-6 py-12 text-center text-[13px] text-[var(--admin-muted)]`}>
        Memuat data…
      </div>
    );
  }

  const smtpOff = !values.smtp.enabled;
  const telegramOff = !values.telegram.enabled;
  const gcOff = !values.googleCalendar.enabled;
  const gcConnected = values.googleCalendar.accountEmail.trim().length > 0;

  const setSmtp = <K extends keyof OrderNotificationsDTO["smtp"]>(
    key: K,
    value: OrderNotificationsDTO["smtp"][K],
  ) => {
    setValues((prev) =>
      prev ? { ...prev, smtp: { ...prev.smtp, [key]: value } } : prev,
    );
    setFieldError(undefined);
  };

  const setTelegram = <K extends keyof OrderNotificationsDTO["telegram"]>(
    key: K,
    value: OrderNotificationsDTO["telegram"][K],
  ) => {
    setValues((prev) =>
      prev ? { ...prev, telegram: { ...prev.telegram, [key]: value } } : prev,
    );
    setFieldError(undefined);
  };

  const setGc = <K extends keyof OrderNotificationsDTO["googleCalendar"]>(
    key: K,
    value: OrderNotificationsDTO["googleCalendar"][K],
  ) => {
    setValues((prev) =>
      prev
        ? { ...prev, googleCalendar: { ...prev.googleCalendar, [key]: value } }
        : prev,
    );
    setFieldError(undefined);
  };

  // --- Dynamic recipient / chat id lists ---

  const updateRecipient = (index: number, value: string) => {
    setValues((prev) => {
      if (!prev) return prev;
      const recipients = [...prev.smtp.recipients];
      recipients[index] = value;
      return { ...prev, smtp: { ...prev.smtp, recipients } };
    });
    setFieldError(undefined);
  };

  const addRecipient = () => {
    setValues((prev) =>
      prev
        ? { ...prev, smtp: { ...prev.smtp, recipients: [...prev.smtp.recipients, ""] } }
        : prev,
    );
  };

  const removeRecipient = (index: number) => {
    setValues((prev) =>
      prev
        ? {
            ...prev,
            smtp: {
              ...prev.smtp,
              recipients: prev.smtp.recipients.filter((_, i) => i !== index),
            },
          }
        : prev,
    );
  };

  const updateChatId = (index: number, value: string) => {
    setValues((prev) => {
      if (!prev) return prev;
      const chatIds = [...prev.telegram.chatIds];
      chatIds[index] = value;
      return { ...prev, telegram: { ...prev.telegram, chatIds } };
    });
    setFieldError(undefined);
  };

  const addChatId = () => {
    setValues((prev) =>
      prev
        ? { ...prev, telegram: { ...prev.telegram, chatIds: [...prev.telegram.chatIds, ""] } }
        : prev,
    );
  };

  const removeChatId = (index: number) => {
    setValues((prev) =>
      prev
        ? {
            ...prev,
            telegram: {
              ...prev.telegram,
              chatIds: prev.telegram.chatIds.filter((_, i) => i !== index),
            },
          }
        : prev,
    );
  };

  const updateAttendee = (index: number, value: string) => {
    setValues((prev) => {
      if (!prev) return prev;
      const attendees = [...prev.googleCalendar.attendees];
      attendees[index] = value;
      return { ...prev, googleCalendar: { ...prev.googleCalendar, attendees } };
    });
    setFieldError(undefined);
  };

  const addAttendee = () => {
    setValues((prev) =>
      prev
        ? {
            ...prev,
            googleCalendar: {
              ...prev.googleCalendar,
              attendees: [...prev.googleCalendar.attendees, ""],
            },
          }
        : prev,
    );
  };

  const removeAttendee = (index: number) => {
    setValues((prev) =>
      prev
        ? {
            ...prev,
            googleCalendar: {
              ...prev.googleCalendar,
              attendees: prev.googleCalendar.attendees.filter((_, i) => i !== index),
            },
          }
        : prev,
    );
  };

  const updateReminder = (index: number, value: number) => {
    setValues((prev) => {
      if (!prev) return prev;
      const reminderMinutes = [...prev.googleCalendar.reminderMinutes];
      reminderMinutes[index] = value;
      return { ...prev, googleCalendar: { ...prev.googleCalendar, reminderMinutes } };
    });
    setFieldError(undefined);
  };

  const addReminder = () => {
    setValues((prev) =>
      prev && prev.googleCalendar.reminderMinutes.length < 5
        ? {
            ...prev,
            googleCalendar: {
              ...prev.googleCalendar,
              reminderMinutes: [...prev.googleCalendar.reminderMinutes, 60],
            },
          }
        : prev,
    );
  };

  const removeReminder = (index: number) => {
    setValues((prev) =>
      prev
        ? {
            ...prev,
            googleCalendar: {
              ...prev.googleCalendar,
              reminderMinutes: prev.googleCalendar.reminderMinutes.filter(
                (_, i) => i !== index,
              ),
            },
          }
        : prev,
    );
  };

  // --- Actions ---

  /** The plain `{ smtp, telegram, googleCalendar }` object handed to the server actions. */
  const buildValues = (current: OrderNotificationsDTO): Record<string, unknown> => ({
    smtp: {
      enabled: current.smtp.enabled,
      host: current.smtp.host,
      port: current.smtp.port,
      secure: current.smtp.secure,
      user: current.smtp.user,
      pass: current.smtp.pass,
      fromName: current.smtp.fromName,
      fromEmail: current.smtp.fromEmail,
      recipients: current.smtp.recipients,
    },
    telegram: {
      enabled: current.telegram.enabled,
      botToken: current.telegram.botToken,
      chatIds: current.telegram.chatIds,
    },
    googleCalendar: {
      enabled: current.googleCalendar.enabled,
      calendarId: current.googleCalendar.calendarId,
      durationMinutes: current.googleCalendar.durationMinutes,
      reminderMinutes: current.googleCalendar.reminderMinutes,
      attendees: current.googleCalendar.attendees,
    },
  });

  const runTest = async (channel: "smtp" | "telegram" | "googleCalendar") => {
    if (testing) return;
    setTesting(channel);
    const result = await testOrderNotificationAction(channel, buildValues(values));
    if (result.ok) {
      showAdminToast(
        channel === "smtp"
          ? "Email uji berhasil dikirim."
          : channel === "telegram"
            ? "Pesan uji Telegram berhasil dikirim."
            : "Event uji berhasil dibuat di Google Calendar.",
      );
    } else {
      showAdminToast(result.error ?? "Gagal mengirim pesan uji.", "error");
    }
    setTesting(null);
  };

  const disconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    const result = await disconnectGoogleCalendarAction();
    if (result.ok) {
      showAdminToast("Koneksi Google Calendar diputus.");
      const settings = await loadOrderNotifications();
      setValues(settings);
    } else {
      showAdminToast(result.error ?? "Gagal memutuskan koneksi.", "error");
    }
    setDisconnecting(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setFieldError(undefined);

    const result = await saveOrderNotificationsAction(buildValues(values));

    if (!result.ok) {
      setError(result.error);
      setFieldError(result.field);
      showAdminToast(result.error, "error");
      setSaving(false);
      return;
    }

    showAdminToast(result.message);
    setSaving(false);
  };

  const fieldErrorClass = (field: string) =>
    fieldError === field ? "border-danger" : "";

  return (
    <form onSubmit={submit} className="pb-6">
      <div className="mb-5">
        <h1 className={adminClass.h1}>Notifikasi Order</h1>
        <p className="mt-1 text-[13px] text-[var(--admin-muted)]">
          Notifikasi yang dikirim ke admin setiap kali sebuah order dibayar,
          lewat email (SMTP), Telegram, dan/atau event Google Calendar. Setiap
          kanal dapat diaktifkan sendiri-sendiri. Pengaturan tersimpan di
          database dan langsung berlaku.
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {/* Email (SMTP) */}
      <div className={`${adminClass.panel} mb-5 p-5 sm:p-6`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--admin-ink)]">
            Email (SMTP)
          </h2>
          <button
            type="button"
            onClick={() => void runTest("smtp")}
            disabled={testing !== null || smtpOff}
            className={adminClass.buttonSecondary}
          >
            {testing === "smtp" ? "Mengirim…" : "Kirim Tes"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Switch */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={values.smtp.enabled}
                onChange={(e) => setSmtp("enabled", e.target.checked)}
                className="h-4 w-4 rounded border-[var(--admin-line)]"
              />
              <span className="text-[13px] font-medium text-[var(--admin-ink)]">
                Aktifkan notifikasi email
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
              Email berisi ringkasan order dikirim ke semua penerima di bawah
              saat order dibayar.
            </p>
          </div>

          {/* Host */}
          <label className="block">
            <span className={adminClass.label}>Host SMTP</span>
            <input
              type="text"
              value={values.smtp.host}
              onChange={(e) => setSmtp("host", e.target.value)}
              disabled={smtpOff}
              placeholder="smtp.gmail.com"
              className={`${adminClass.input} mt-1.5 ${fieldErrorClass("smtp.host")}`}
            />
          </label>

          {/* Port */}
          <label className="block">
            <span className={adminClass.label}>Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              step={1}
              value={values.smtp.port}
              onChange={(e) => setSmtp("port", Number(e.target.value))}
              disabled={smtpOff}
              className={`${adminClass.input} mt-1.5 tabular-nums ${fieldErrorClass("smtp.port")}`}
            />
          </label>

          {/* Secure */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={values.smtp.secure}
                onChange={(e) => setSmtp("secure", e.target.checked)}
                disabled={smtpOff}
                className="h-4 w-4 rounded border-[var(--admin-line)]"
              />
              <span className="text-[13px] font-medium text-[var(--admin-ink)]">
                Gunakan SSL/TLS (port 465)
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
              Biarkan mati untuk STARTTLS pada port 587 atau 25.
            </p>
          </div>

          {/* User */}
          <label className="block">
            <span className={adminClass.label}>Username</span>
            <input
              type="text"
              value={values.smtp.user}
              onChange={(e) => setSmtp("user", e.target.value)}
              disabled={smtpOff}
              autoComplete="off"
              placeholder="noreply@domain.com"
              className={`${adminClass.input} mt-1.5`}
            />
          </label>

          {/* Pass */}
          <label className="block">
            <span className={adminClass.label}>Password</span>
            <input
              type="password"
              value={values.smtp.pass}
              onChange={(e) => setSmtp("pass", e.target.value)}
              disabled={smtpOff}
              autoComplete="new-password"
              placeholder="••••••••"
              className={`${adminClass.input} mt-1.5`}
            />
            <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
              Kosongkan untuk mempertahankan password yang tersimpan.
            </span>
          </label>

          {/* From name */}
          <label className="block">
            <span className={adminClass.label}>Nama pengirim</span>
            <input
              type="text"
              value={values.smtp.fromName}
              onChange={(e) => setSmtp("fromName", e.target.value)}
              disabled={smtpOff}
              placeholder="Booking VIP"
              className={`${adminClass.input} mt-1.5`}
            />
          </label>

          {/* From email */}
          <label className="block">
            <span className={adminClass.label}>Email pengirim</span>
            <input
              type="email"
              value={values.smtp.fromEmail}
              onChange={(e) => setSmtp("fromEmail", e.target.value)}
              disabled={smtpOff}
              placeholder="noreply@domain.com"
              className={`${adminClass.input} mt-1.5 ${fieldErrorClass("smtp.fromEmail")}`}
            />
          </label>

          {/* Recipients */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className={adminClass.label}>Penerima email</span>
              <button
                type="button"
                onClick={addRecipient}
                disabled={smtpOff}
                className={adminClass.buttonSecondary}
              >
                + Tambah Penerima
              </button>
            </div>
            {values.smtp.recipients.length === 0 ? (
              <p className="text-[13px] text-[var(--admin-muted)]">
                Belum ada penerima. Tambahkan minimal satu.
              </p>
            ) : (
              <div className="space-y-2">
                {values.smtp.recipients.map((recipient, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="email"
                      value={recipient}
                      onChange={(e) => updateRecipient(index, e.target.value)}
                      disabled={smtpOff}
                      placeholder="ops@domain.com"
                      className={`${adminClass.input} ${
                        fieldError === "smtp.recipients" ? "border-danger" : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRecipient(index)}
                      disabled={smtpOff}
                      className={`${adminClass.buttonGhost} shrink-0 text-danger`}
                      title="Hapus penerima"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Telegram */}
      <div className={`${adminClass.panel} mb-5 p-5 sm:p-6`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--admin-ink)]">
            Telegram
          </h2>
          <button
            type="button"
            onClick={() => void runTest("telegram")}
            disabled={testing !== null || telegramOff}
            className={adminClass.buttonSecondary}
          >
            {testing === "telegram" ? "Mengirim…" : "Kirim Tes"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Switch */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={values.telegram.enabled}
                onChange={(e) => setTelegram("enabled", e.target.checked)}
                className="h-4 w-4 rounded border-[var(--admin-line)]"
              />
              <span className="text-[13px] font-medium text-[var(--admin-ink)]">
                Aktifkan notifikasi Telegram
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
              Pesan berisi ringkasan order dikirim ke semua chat id di bawah
              saat order dibayar.
            </p>
          </div>

          {/* Bot token */}
          <label className="block sm:col-span-2">
            <span className={adminClass.label}>Bot token</span>
            <input
              type="password"
              value={values.telegram.botToken}
              onChange={(e) => setTelegram("botToken", e.target.value)}
              disabled={telegramOff}
              autoComplete="new-password"
              placeholder="123456789:ABCdef…"
              className={`${adminClass.input} mt-1.5 ${fieldErrorClass("telegram.botToken")}`}
            />
            <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
              Token dari @BotFather. Kosongkan untuk mempertahankan token yang
              tersimpan.
            </span>
          </label>

          {/* Chat ids */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className={adminClass.label}>Chat id</span>
              <button
                type="button"
                onClick={addChatId}
                disabled={telegramOff}
                className={adminClass.buttonSecondary}
              >
                + Tambah Chat
              </button>
            </div>
            {values.telegram.chatIds.length === 0 ? (
              <p className="text-[13px] text-[var(--admin-muted)]">
                Belum ada chat id. Tambahkan minimal satu.
              </p>
            ) : (
              <div className="space-y-2">
                {values.telegram.chatIds.map((chatId, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chatId}
                      onChange={(e) => updateChatId(index, e.target.value)}
                      disabled={telegramOff}
                      placeholder="123456789, -1001234567890, atau @namachannel"
                      className={`${adminClass.input} ${
                        fieldError === "telegram.chatIds" ? "border-danger" : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeChatId(index)}
                      disabled={telegramOff}
                      className={`${adminClass.buttonGhost} shrink-0 text-danger`}
                      title="Hapus chat id"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Google Calendar */}
      <div className={`${adminClass.panel} p-5 sm:p-6`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--admin-ink)]">
            Google Calendar
          </h2>
          <button
            type="button"
            onClick={() => void runTest("googleCalendar")}
            disabled={testing !== null || gcOff || !gcConnected}
            className={adminClass.buttonSecondary}
          >
            {testing === "googleCalendar" ? "Mengirim…" : "Kirim Tes"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Switch */}
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={values.googleCalendar.enabled}
                onChange={(e) => setGc("enabled", e.target.checked)}
                className="h-4 w-4 rounded border-[var(--admin-line)]"
              />
              <span className="text-[13px] font-medium text-[var(--admin-ink)]">
                Aktifkan sinkronisasi Google Calendar
              </span>
            </label>
            <p className="mt-1 text-[12px] text-[var(--admin-muted)]">
              Setiap order yang dibayar otomatis dibuatkan event di calendar
              pada waktu layanan. Penerima di bawah mendapat email undangan
              dari Google, dan alarm (popup) berbunyi sesuai pengingat yang
              diatur.
            </p>
          </div>

          {/* Connection status */}
          <div className="sm:col-span-2">
            <span className={adminClass.label}>Akun Google</span>
            {gcConnected ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--admin-line)] bg-[var(--admin-hover)] px-3 py-2">
                <span className="text-[13px] font-medium text-[var(--admin-ink)]">
                  ✓ Terhubung: {values.googleCalendar.accountEmail}
                </span>
                <a
                  href="/api/google/calendar/start"
                  className={`${adminClass.buttonSecondary} ml-auto`}
                >
                  Hubungkan Ulang
                </a>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={disconnecting}
                  className={`${adminClass.buttonGhost} text-danger`}
                >
                  {disconnecting ? "Memutus…" : "Putuskan"}
                </button>
              </div>
            ) : (
              <div className="mt-1.5">
                <a href="/api/google/calendar/start" className={adminClass.buttonPrimary}>
                  Hubungkan Google Calendar
                </a>
                <p className="mt-1.5 text-[12px] text-[var(--admin-muted)]">
                  Sekali saja: berikan izin akses Calendar untuk satu akun
                  Google. Event order akan dibuat di calendar akun ini.
                </p>
              </div>
            )}
          </div>

          {/* Calendar id */}
          <label className="block">
            <span className={adminClass.label}>Calendar ID</span>
            <input
              type="text"
              value={values.googleCalendar.calendarId}
              onChange={(e) => setGc("calendarId", e.target.value)}
              disabled={gcOff}
              placeholder="primary"
              className={`${adminClass.input} mt-1.5`}
            />
            <span className="mt-1 block text-[12px] text-[var(--admin-muted)]">
              Biarkan <code>primary</code> untuk kalender utama akun yang
              terhubung.
            </span>
          </label>

          {/* Duration */}
          <label className="block">
            <span className={adminClass.label}>Durasi event (menit)</span>
            <input
              type="number"
              min={15}
              max={1440}
              step={5}
              value={values.googleCalendar.durationMinutes}
              onChange={(e) => setGc("durationMinutes", Number(e.target.value))}
              disabled={gcOff}
              className={`${adminClass.input} mt-1.5 tabular-nums`}
            />
          </label>

          {/* Reminders */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className={adminClass.label}>
                Pengingat / alarm (menit sebelum layanan)
              </span>
              <button
                type="button"
                onClick={addReminder}
                disabled={gcOff || values.googleCalendar.reminderMinutes.length >= 5}
                className={adminClass.buttonSecondary}
              >
                + Tambah Pengingat
              </button>
            </div>
            {values.googleCalendar.reminderMinutes.length === 0 ? (
              <p className="text-[13px] text-[var(--admin-muted)]">
                Tanpa pengingat — alarm tidak akan berbunyi.
              </p>
            ) : (
              <div className="space-y-2">
                {values.googleCalendar.reminderMinutes.map((minutes, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={40320}
                      step={5}
                      value={minutes}
                      onChange={(e) => updateReminder(index, Number(e.target.value))}
                      disabled={gcOff}
                      className={`${adminClass.input} tabular-nums`}
                    />
                    <button
                      type="button"
                      onClick={() => removeReminder(index)}
                      disabled={gcOff}
                      className={`${adminClass.buttonGhost} shrink-0 text-danger`}
                      title="Hapus pengingat"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
                <p className="text-[12px] text-[var(--admin-muted)]">
                  Contoh: 1440 = 1 hari, 60 = 1 jam sebelum waktu layanan.
                  Maksimal 5 pengingat.
                </p>
              </div>
            )}
          </div>

          {/* Attendees */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className={adminClass.label}>
                Penerima notifikasi (email undangan event)
              </span>
              <button
                type="button"
                onClick={addAttendee}
                disabled={gcOff}
                className={adminClass.buttonSecondary}
              >
                + Tambah Penerima
              </button>
            </div>
            {values.googleCalendar.attendees.length === 0 ? (
              <p className="text-[13px] text-[var(--admin-muted)]">
                Belum ada penerima. Event tetap dibuat, tetapi tanpa undangan
                email.
              </p>
            ) : (
              <div className="space-y-2">
                {values.googleCalendar.attendees.map((attendee, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="email"
                      value={attendee}
                      onChange={(e) => updateAttendee(index, e.target.value)}
                      disabled={gcOff}
                      placeholder="ops@domain.com"
                      className={`${adminClass.input} ${
                        fieldError === "googleCalendar.attendees" ? "border-danger" : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => removeAttendee(index)}
                      disabled={gcOff}
                      className={`${adminClass.buttonGhost} shrink-0 text-danger`}
                      title="Hapus penerima"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-40 mt-5 flex items-center justify-end gap-2 border-t border-[var(--admin-line)] bg-white py-3">
        <button type="submit" disabled={saving} className={adminClass.buttonPrimary}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
      </div>
    </form>
  );
}
