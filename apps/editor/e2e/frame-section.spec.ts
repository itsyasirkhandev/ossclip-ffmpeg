import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Screenshots of every state of the section, for review (and as the
// click-through record R-35 asks for). Fixed temp path so a reviewer can
// find them without digging through Playwright's per-run folders.
const SHOTS = join(process.env.TEMP ?? process.env.TMPDIR ?? "/tmp", "ossclip-frame-shots");
mkdirSync(SHOTS, { recursive: true });

// 2x so the review screenshots are legible; the assertions below do not
// depend on it.
test.use({ deviceScaleFactor: 2 });

test("Background & frame: four tabs, three collapsible categories, one reset each", async ({ page }) => {
  await page.goto("/");
  // The section lives on the no-selection panel, which is what the editor
  // opens on.
  await expect(page.getByTestId("frame-section")).toBeVisible();

  // OFF: Background open by default, the other three categories not rendered
  // at all, and the hint saying what turns them on.
  await expect(page.getByTestId("frame-card-background-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("frame-off-hint")).toBeVisible();
  await expect(page.getByTestId("frame-card-padding")).toHaveCount(0);
  await expect(page.getByTestId("frame-card-shadow")).toHaveCount(0);
  await expect(page.getByTestId("frame-card-border")).toHaveCount(0);
  // Reference design's tab order: Wallpaper, Color, Gradient, Image.
  await expect(page.getByTestId("frame-tab-wallpaper")).toHaveText("Wallpaper");
  await expect(page.getByTestId("frame-tab-color")).toHaveText("Color");
  await expect(page.getByTestId("frame-tab-gradient")).toHaveText("Gradient");
  await expect(page.getByRole("button", { name: "Wallpaper" })).toBeVisible();
  await page.getByTestId("frame-section").screenshot({ path: join(SHOTS, "1-off.png") });

  // Turning a type on seeds the whole ScreenArc default set at once and
  // brings the three categories in, collapsed.
  await page.getByTestId("frame-tab-wallpaper").click();
  await expect(page.getByTestId("frame-off-hint")).toHaveCount(0);
  await expect(page.getByTestId("frame-wallpaper-grid")).toBeVisible();
  for (const card of ["padding", "shadow", "border"]) {
    await expect(page.getByTestId(`frame-card-${card}`)).toBeVisible();
    await expect(page.getByTestId(`frame-card-${card}-toggle`)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`frame-card-${card}-reset`)).toBeVisible();
  }
  await page.getByTestId("frame-section").screenshot({ path: join(SHOTS, "2-on-collapsed.png") });

  // PADDING: expands to one slider with an editable readout, and its own
  // reset puts the value back without touching the other groups.
  await page.getByTestId("frame-card-padding-toggle").click();
  await expect(page.getByTestId("frame-card-padding-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("slider-padding")).toBeVisible();
  await expect(page.getByTestId("slider-padding")).toHaveValue("5");
  await page.getByTestId("field-padding").fill("12");
  await expect(page.getByTestId("slider-padding")).toHaveValue("12");
  await page.getByTestId("frame-card-padding-reset").click();
  await expect(page.getByTestId("slider-padding")).toHaveValue("5");
  // Collapses again: the body goes, the reset stays reachable.
  await page.getByTestId("frame-card-padding-toggle").click();
  await expect(page.getByTestId("slider-padding")).toHaveCount(0);
  await expect(page.getByTestId("frame-card-padding-reset")).toBeVisible();
  await page.getByTestId("frame-card-padding-toggle").click();
  await page.getByTestId("frame-section").screenshot({ path: join(SHOTS, "3-padding.png") });

  // SHADOW: Blur, the Offset X/Y pair, Color, Opacity as a percentage.
  await page.getByTestId("frame-card-shadow-toggle").click();
  await expect(page.getByTestId("slider-shadowBlur")).toBeVisible();
  await expect(page.getByTestId("slider-shadowBlur")).toHaveValue("35");
  await expect(page.getByTestId("slider-shadowOffsetY")).toHaveValue("15");
  await expect(page.getByTestId("slider-shadowOpacity")).toHaveValue("80");
  await expect(page.getByTestId("field-shadowOpacity")).toHaveValue("80");
  await expect(page.getByTestId("frame-shadow-color-swatch")).toBeVisible();
  await page.getByTestId("field-shadowBlur").fill("99");
  await expect(page.getByTestId("slider-shadowBlur")).toHaveValue("99");
  await page.getByTestId("frame-card-shadow-reset").click();
  await expect(page.getByTestId("slider-shadowBlur")).toHaveValue("35");
  // The padding reset above/below must not be what fixed it: padding is
  // still 5 from its own reset, and its card is untouched by this one.
  await expect(page.getByTestId("slider-padding")).toHaveValue("5");
  await page.getByTestId("frame-section").screenshot({ path: join(SHOTS, "4-shadow.png") });

  // BORDER: Radius, Thickness, Color.
  await page.getByTestId("frame-card-border-toggle").click();
  await expect(page.getByTestId("slider-radius")).toBeVisible();
  await expect(page.getByTestId("slider-radius")).toHaveValue("16");
  await expect(page.getByTestId("slider-borderWidth")).toHaveValue("4");
  await expect(page.getByTestId("frame-border-color-swatch")).toBeVisible();
  await page.getByTestId("field-radius").fill("40");
  await expect(page.getByTestId("slider-radius")).toHaveValue("40");
  await page.getByTestId("frame-card-border-reset").click();
  await expect(page.getByTestId("slider-radius")).toHaveValue("16");
  await page.getByTestId("frame-section").screenshot({ path: join(SHOTS, "5-border.png") });

  // The footer's Remove is the way back to a plain full-bleed video: the key
  // goes, the hint returns, the three categories disappear with it.
  await page.getByTestId("frame-remove").click();
  await expect(page.getByTestId("frame-off-hint")).toBeVisible();
  await expect(page.getByTestId("frame-card-padding")).toHaveCount(0);
});
