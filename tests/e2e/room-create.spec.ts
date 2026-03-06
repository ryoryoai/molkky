import { expect, test } from "@playwright/test";

test("can create a room from top page", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "新規ルーム作成" }).click();

  await expect(page).toHaveURL(/\/room\/[^#/?]+#edit=/);
  await expect(page.getByRole("heading", { name: /Room:/ })).toBeVisible();
  await expect(page.getByText(/create room failed/i)).toHaveCount(0);
});
