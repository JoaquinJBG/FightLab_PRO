import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

function Sample() {
  const t = useTranslations("common");
  return <p>{t("loading")}</p>;
}

describe("useTranslations", () => {
  it.each([
    ["es", es, "Cargando…"],
    ["en", en, "Loading…"],
  ])("renderiza en %s", (locale, messages, expected) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Sample />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
