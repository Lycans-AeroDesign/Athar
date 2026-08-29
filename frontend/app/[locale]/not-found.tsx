import { Link } from "@/i18n/navigation";
import { Icon } from "@/components/ui/Icon";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-on-background px-6 text-center">
      <Icon name="travel_explore" size={48} className="text-outline" />
      <h1 className="font-headline-lg text-headline-lg text-on-surface">{t("title")}</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant max-w-md">
        {t("description")}
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary font-label-caps text-label-caps uppercase hover:bg-on-primary-fixed-variant transition-colors"
      >
        <Icon name="arrow_back" size={16} />
        {t("backHome")}
      </Link>
    </main>
  );
}
