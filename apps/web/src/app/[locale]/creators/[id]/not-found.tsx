import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export default async function CreatorNotFound() {
  const t = await getTranslations("catalog");
  return (
    <section className="wrap sec">
      <Empty icon="user" title={t("creator.notFoundTitle")} action={<Button href="/">{t("page.explore")}</Button>}>
        {t("creator.notFoundBody")}
      </Empty>
    </section>
  );
}
