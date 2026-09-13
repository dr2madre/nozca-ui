import { expect, test, type Page } from "@playwright/test";
import { VUE_BASE } from "../playwright.config";

// The elements harness is client-rendered, which is the render that shows
// these defects: server-rendered markup carries defaults of its own and hides
// them. The page lives on the same Vite server as the Vue one.
const ELEMENTS_BASE = VUE_BASE.replace("harness.html", "elements-harness.html");

const payload = (page: Page) =>
  page.evaluate(() => {
    const form = document.querySelector("[data-testid='reset-form']") as HTMLFormElement;
    const data = new FormData(form);
    const keys = [...new Set(data.keys())];
    return Object.fromEntries(keys.map((key) => [key, data.getAll(key).join("|")]));
  });

/**
 * The defaults the DOM itself carries. This is the layer the component's own
 * restore hides: with it missing, a reset still looks right here and goes
 * wrong on a page whose script never runs.
 */
const domDefaults = (page: Page) =>
  page.evaluate(() => {
    const form = document.querySelector("[data-testid='reset-form']") as HTMLFormElement;
    const named = (selector: string) =>
      [...form.querySelectorAll<HTMLInputElement>(selector)]
        .filter((el) => el.defaultChecked)
        .map((el) => `${el.name}=${el.value}`)
        .sort();
    return {
      // Filtered by property, not by attribute: a text field with no `type`
      // on the host carries no `type` attribute either, and is still text.
      text: [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
        .filter((el) => el.name && (el instanceof HTMLTextAreaElement || el.type === "text"))
        .map((el) => `${el.name}=${el.defaultValue}`)
        .sort(),
      checked: named("input[type=checkbox], input[type=radio]"),
      selected: [...form.querySelectorAll<HTMLOptionElement>("select option")]
        .filter((option) => option.defaultSelected)
        .map((option) => option.value),
    };
  });

const reports = async (page: Page) =>
  Number(/Reports: (\d+)/.exec((await page.getByTestId("reset-readout").textContent()) ?? "")?.[1]);

/** These inputs are painted over, so the label is what a person clicks. */
const press = (control: ReturnType<Page["getByRole"]>) =>
  control.locator("xpath=ancestor::label[1]").click();

const edit = async (page: Page) => {
  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("Grace");
  await press(page.getByRole("checkbox", { name: "Subscribe" }));
  await press(page.getByRole("switch", { name: "Notifications" }));
  await page.getByLabel("Fruit").selectOption("apple");
  await press(page.getByRole("radio", { name: "Large" }));
  await press(page.getByRole("checkbox", { name: "Caper" }));
  await page.getByRole("combobox", { name: "City" }).click();
  await page.getByRole("option", { name: "London" }).click();
  await page.getByRole("combobox", { name: "Languages" }).click();
  await page.getByRole("option", { name: "English" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Notes" }).fill("Edited");
  // Take focus off the last field. A text control commits on blur, and that
  // native change is the user's edit, not the reset: counting it afterwards
  // would blame the reset for what the click before it did.
  await page.getByRole("heading", { level: 1 }).click();
};

const MOUNTED = {
  resetName: "Ada",
  resetSubscribe: "on",
  resetNotify: "on",
  resetFruit: "pear",
  resetSize: "small",
  resetToppings: "olive",
  resetCity: "milan",
  resetLangs: "it",
  resetNotes: "None",
};

test.beforeEach(async ({ page }) => {
  await page.goto(ELEMENTS_BASE);
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
});

test("a reset restores payload and page, and reports nothing", async ({ page }) => {
  expect(await payload(page)).toEqual(MOUNTED);

  const defaults = await domDefaults(page);
  expect(defaults.text, "the DOM must carry the text defaults").toEqual([
    "resetName=Ada",
    "resetNotes=None",
  ]);
  expect(defaults.checked, "the DOM must carry the checked defaults").toEqual([
    "resetNotify=on",
    "resetSize=small",
    "resetSubscribe=on",
    "resetToppings=olive",
  ]);
  expect(defaults.selected, "the DOM must carry the selected option").toEqual(["pear"]);

  await edit(page);
  const edited = await payload(page);
  expect(edited).not.toEqual(MOUNTED);
  expect(await domDefaults(page), "the DOM defaults must not follow the edits").toEqual(defaults);
  expect(edited.resetName).toBe("Grace");
  // Both start on and the edit turns them off: a default of "off" would be
  // the same whether or not the DOM carries one.
  expect(edited.resetSubscribe).toBeUndefined();
  expect(edited.resetNotify).toBeUndefined();
  expect(edited.resetCity).toBe("london");
  const reported = await reports(page);
  expect(reported, "the edits themselves must have been reported").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Reset the form" }).click();
  // The components' restore follows the browser's by one task.
  await page.waitForTimeout(50);

  expect(await payload(page)).toEqual(MOUNTED);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Subscribe" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "City" })).toHaveValue("Milan");
  await expect(page.getByTestId("reset-readout")).toContainText("Resets: 1");
  expect(await reports(page), "a reset is not a user change").toBe(reported);
});

test("a cancelled reset restores nothing", async ({ page }) => {
  await page.evaluate(() => {
    document
      .querySelector("[data-testid='reset-form']")!
      .addEventListener("reset", (event) => event.preventDefault());
  });

  await edit(page);
  const edited = await payload(page);

  await page.getByRole("button", { name: "Reset the form" }).click();
  await page.waitForTimeout(50);

  expect(await payload(page), "preventDefault must leave the edits alone").toEqual(edited);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Grace");
});

test("the page's own choice becomes the default a reset restores", async ({ page }) => {
  await edit(page);

  // Handed back while the control still holds it, the very value the user
  // chose is an echo and not a new default (ADR 0012): the reset undoes it.
  await page.evaluate(() => {
    document.querySelector("ds-select")!.setAttribute("value", "apple");
  });
  await page.getByRole("button", { name: "Reset the form" }).click();
  await page.waitForTimeout(50);
  expect((await payload(page)).resetFruit, "an echo became the default").toBe("pear");

  // Chosen by the page, after the reset took that value off the control: now
  // it is a choice, and the next reset lands on it.
  await page.evaluate(() => {
    document.querySelector("ds-text-field")!.setAttribute("value", "Hopper");
    document.querySelector("ds-select")!.setAttribute("value", "apple");
  });
  await page.getByRole("button", { name: "Reset the form" }).click();
  await page.waitForTimeout(50);

  const after = await payload(page);
  expect(after.resetName).toBe("Hopper");
  expect(after.resetFruit).toBe("apple");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Hopper");
});
