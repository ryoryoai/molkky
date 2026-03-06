import { expect, test } from "@playwright/test";

test("can create a room from top page", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "新規ルーム作成" }).click();

  await expect(page).toHaveURL(/\/room\/[^#/?]+#edit=/);
  await expect(page.getByRole("heading", { name: /Room:/ })).toBeVisible();
  await expect(page.getByText(/create room failed/i)).toHaveCount(0);
});

test("can create a room with manual game name", async ({ page }) => {
  await page.goto("/");

  const manualGameName = `game-${Date.now()}`;
  await page.getByLabel("ゲーム名（任意）").fill(manualGameName);
  await page.getByRole("button", { name: "新規ルーム作成" }).click();

  const encodedRoomId = encodeURIComponent(manualGameName);
  await expect(page).toHaveURL(new RegExp(`/room/${encodedRoomId}#edit=`));
  await expect(page.getByRole("heading", { name: /Room:/ })).toBeVisible();
});
