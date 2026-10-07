import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

export default async function AgentNotFound() {
  const t = await getTranslations("catalog.page");
  return (
    <section className="wrap sec">
      <Empty icon="search" title={t("notFoundTitle")} action={<Button href="/">{t("explore")}</Button>}>
        {t("notFoundBody")}
      </Empty>
    </section>
  );
}
