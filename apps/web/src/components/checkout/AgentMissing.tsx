import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

/** Especialista ausente (slug errado) ou API fora do ar. */
export function AgentMissing({ error }: { error: "not_found" | "unavailable" | null }) {
  const t = useTranslations("checkout.agentMissing");
  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 72 }}>
      {error === "unavailable" ? (
        <Empty icon="warning" title={t("unavailable.title")} action={<Button href="/">{t("unavailable.action")}</Button>}>
          {t("unavailable.text")}
        </Empty>
      ) : (
        <Empty icon="search" title={t("notFound.title")} action={<Button href="/">{t("notFound.action")}</Button>}>
          {t("notFound.text")}
        </Empty>
      )}
    </section>
  );
}
