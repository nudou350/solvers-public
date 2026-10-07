import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export default async function NotFound() {
  const t = await getTranslations("common.notFound");
  return (
    <section className="wrap sec">
      <Empty icon="search" title={t("title")} action={<Button href="/">{t("home")}</Button>}>
        {t("body")}
      </Empty>
    </section>
  );
}
