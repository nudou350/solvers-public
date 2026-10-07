import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";

/** Anúncio de licença usada ausente (vendido, cancelado), revenda desligada ou API fora do ar. */
export function ListingMissing({ reason }: { reason: "gone" | "disabled" | "unavailable" }) {
  const t = useTranslations("checkout.listingMissing");
  return (
    <section className="wrap" style={{ paddingTop: 56, paddingBottom: 72 }}>
      {reason === "unavailable" ? (
        <Empty icon="warning" title={t("unavailable.title")} action={<Button href="/resale">{t("unavailable.action")}</Button>}>
          {t("unavailable.text")}
        </Empty>
      ) : reason === "disabled" ? (
        <Empty icon="tag" title={t("disabled.title")} action={<Button href="/">{t("disabled.action")}</Button>}>
          {t("disabled.text")}
        </Empty>
      ) : (
        <Empty icon="tag" title={t("gone.title")} action={<Button href="/resale">{t("gone.action")}</Button>}>
          {t("gone.text")}
        </Empty>
      )}
    </section>
  );
}
