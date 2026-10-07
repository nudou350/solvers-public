import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

// Mesmo texto para quem não é admin e para um endereço que não existe: a área não revela que está aqui.
export default async function AdminNotFound() {
  const t = await getTranslations("common.notFound");
  return (
    <section className="wrap sec">
      <Empty icon="search" title={t("title")} action={<Button href="/">{t("home")}</Button>}>
        {t("body")}
      </Empty>
    </section>
  );
}
