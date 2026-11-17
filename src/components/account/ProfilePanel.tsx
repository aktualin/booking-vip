"use client";

import { useEffect, useState } from "react";
import AccountPageHeader from "@/components/account/AccountPageHeader";
import EmailVerificationBanner from "@/components/account/EmailVerificationBanner";
import PhoneInput from "@/components/ui/PhoneInput";
import { showToast } from "@/components/ui/toast";
import {
  changeAccountPassword,
  updateAccountProfile,
} from "@/app/actions/account";
import { useAccountOverview } from "@/components/providers/AccountProvider";
import { useLocale } from "@/components/providers/LocaleProvider";
import { formatInternational, parseInternationalPhone } from "@/lib/flag";

/**
 * The profile page.
 *
 * Two blocks: the account information (name, email, phone, member since) and
 * the two forms — update the profile and change the password. The email is
 * read-only because it is the Firebase identity.
 */
export default function ProfilePanel() {
  const { overview, refresh } = useAccountOverview();
  const { t, lang } = useLocale();
  const dateLocale = lang === "id" ? "id-ID" : "en-US";
  const [name, setName] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("ID");
  const [phone, setPhone] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileField, setProfileField] = useState<string | undefined>(undefined);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordField, setPasswordField] = useState<string | undefined>(undefined);

  // The forms start from whatever the shared overview holds, and follow it
  // when the row arrives or is refreshed after a save.
  useEffect(() => {
    if (!overview) return;
    setName(overview.name ?? "");
    const parsed = parseInternationalPhone(overview.phone ?? "");
    setPhoneCountryCode(parsed.countryCode);
    setPhone(parsed.phone);
  }, [overview]);

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingProfile) return;

    setSavingProfile(true);
    setProfileError("");
    setProfileField(undefined);

    const result = await updateAccountProfile({
      name,
      phone: formatInternational(phoneCountryCode, phone),
    });
    if (!result.ok) {
      setProfileError(result.error);
      setProfileField(result.field);
    } else {
      showToast(t("profile.savedToast"));
      void refresh();
    }
    setSavingProfile(false);
  };

  const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingPassword) return;

    setSavingPassword(true);
    setPasswordError("");
    setPasswordField(undefined);

    const result = await changeAccountPassword({
      currentPassword,
      newPassword,
      confirmPassword,
    });

    if (!result.ok) {
      setPasswordError(result.error);
      setPasswordField(result.field);
    } else {
      showToast(t("profile.passwordSavedToast"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setSavingPassword(false);
  };

  const memberSince = overview?.memberSince
    ? new Date(overview.memberSince).toLocaleDateString(dateLocale, {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <div>
      <AccountPageHeader
        title={t("profile.title")}
        description={t("profile.subtitle")}
      />

      <EmailVerificationBanner />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account information */}
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("profile.infoTitle")}
          </h2>

          <dl className="mt-4 space-y-3.5">
            <div className="flex items-start justify-between gap-4 border-b border-line pb-3.5">
              <dt className="text-[13px] text-muted">{t("profile.email")}</dt>
              <dd className="flex items-center gap-2 text-right text-[13px] font-medium text-ink">
                {overview?.email ?? "—"}
                {overview?.emailVerified ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-brand-dark">
                    {t("profile.verified")}
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-line pb-3.5">
              <dt className="text-[13px] text-muted">{t("profile.role")}</dt>
              <dd className="text-[13px] font-medium text-ink">{t("profile.roleCustomer")}</dd>
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-line pb-3.5">
              <dt className="text-[13px] text-muted">{t("profile.points")}</dt>
              <dd className="text-[13px] font-medium text-ink">
                {(overview?.points ?? 0).toLocaleString(dateLocale)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-[13px] text-muted">{t("profile.memberSince")}</dt>
              <dd className="text-right text-[13px] font-medium text-ink">{memberSince}</dd>
            </div>
          </dl>
        </section>

        {/* Update profile */}
        <section className="rounded-2xl border border-line bg-white p-5 md:p-6">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {t("profile.updateTitle")}
          </h2>

          <form onSubmit={submitProfile} className="mt-4 space-y-3.5">
            {profileError ? (
              <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-danger">
                {profileError}
              </p>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">{t("profile.nameLabel")}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
                placeholder={t("profile.namePlaceholder")}
              />
            </label>

            <PhoneInput
              label={t("profile.phoneLabel")}
              countryCode={phoneCountryCode}
              phone={phone}
              onChange={({ countryCode, phone }) => {
                setPhoneCountryCode(countryCode);
                setPhone(phone);
              }}
              placeholder={t("profile.phonePlaceholder")}
              inputClassName="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />

            <button
              type="submit"
              disabled={savingProfile}
              className="h-10 rounded-lg bg-brand px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {savingProfile ? t("profile.saving") : t("profile.save")}
            </button>
          </form>
        </section>
      </div>

      {/* Password */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5 md:p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {t("profile.passwordTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          {t("profile.passwordHint")}
        </p>

        <form onSubmit={submitPassword} className="mt-4 grid gap-3.5 sm:grid-cols-3">
          {passwordError ? (
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-danger sm:col-span-3">
              {passwordError}
            </p>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              {t("profile.currentPassword")}
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              {t("profile.newPassword")}
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              {t("profile.confirmPassword")}
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="h-10 w-full rounded-lg border border-line bg-white px-3 text-[13px] text-ink outline-none transition-colors focus:border-brand"
            />
          </label>

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={savingPassword}
              className="h-10 rounded-lg border border-line bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-canvas disabled:opacity-50"
            >
              {savingPassword ? t("profile.updating") : t("profile.passwordTitle")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
