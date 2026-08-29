"use client";

import { useTranslations } from "next-intl";

import { useAuth } from "@/lib/auth/AuthProvider";

// Placeholder landing page - the shell (SideNav + TopBar) is real; the
// dashboard content itself (stats, recent activity, etc. - see
// ref/aerokms_dashboard) is a separate future page.
export default function DashboardPage() {
  const { user } = useAuth();
  const t = useTranslations("dashboard");

  return (
    <section>
      <h1 className="font-display text-display text-on-surface">
        {user ? t("welcomeWithName", { name: user.email }) : t("welcome")}
      </h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant mt-2">{t("placeholder")}</p>
    </section>
  );
}
