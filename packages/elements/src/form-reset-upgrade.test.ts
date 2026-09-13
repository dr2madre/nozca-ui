import { screen } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";

/** The restore runs one task after the reset event; wait past it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// Server-rendered markup reaches the browser as plain attributes, with the
// definitions arriving later: the upgrade is where the DOM defaults are
// written. The import below is deliberately inside the test, after the markup,
// so this is that order and not the reverse.
describe("form reset after a server-rendered upgrade", () => {
  it("takes its defaults from the markup, and restores them", async () => {
    const user = userEvent.setup();
    document.body.innerHTML = `
      <form data-testid="host">
        <ds-text-field label="F" name="f" value="Ada"></ds-text-field>
        <ds-select label="S" name="s" value="pear">
          <option value="apple">Apple</option>
          <option value="pear">Pear</option>
        </ds-select>
        <button type="reset">Reset</button>
      </form>`;
    const form = screen.getByTestId("host") as HTMLFormElement;

    expect(
      customElements.get("ds-text-field"),
      "the definitions must arrive after",
    ).toBeUndefined();
    await import("./define");

    const input = () => screen.getByRole("textbox", { name: "F" }) as HTMLInputElement;
    const select = () => screen.getByRole("combobox", { name: "S" }) as HTMLSelectElement;

    expect(input().defaultValue, "the markup's value is the DOM default").toBe("Ada");
    expect(
      [...select().options]
        .filter((option) => option.defaultSelected)
        .map((option) => option.value),
      "the markup's selection is the DOM default",
    ).toEqual(["pear"]);

    await user.clear(input());
    await user.type(input(), "Grace");
    await user.selectOptions(select(), "apple");
    expect(new FormData(form).get("f")).toBe("Grace");

    form.reset();
    await settled();

    expect(new FormData(form).get("f")).toBe("Ada");
    expect(new FormData(form).get("s")).toBe("pear");
    expect(
      document.querySelector("ds-text-field")!.getAttribute("value"),
      "the element's own copy came back",
    ).toBe("Ada");
  });
});
