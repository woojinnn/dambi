import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SetInput } from "./SetInput";

/** Controlled wrapper mirroring the real parent: feeds onChange back as `values`.
 *  The comma-eats-itself bug only manifests when values round-trips back into the
 *  input, so the harness MUST feed it back. */
function Harness({ initial = [] as string[] }) {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <>
      <SetInput values={values} onChange={setValues} placeholder="set" />
      <output data-testid="parsed">{JSON.stringify(values)}</output>
    </>
  );
}

describe("SetInput", () => {
  it("retains a trailing comma+space while typing (regression: comma no longer eats itself)", () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText("set") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "DOGE" } });
    expect(input.value).toBe("DOGE");

    // The bug: with `value={values.join(", ")}` the trailing comma was dropped
    // on this very keystroke (["DOGE",""] -> filter -> ["DOGE"] -> "DOGE").
    fireEvent.change(input, { target: { value: "DOGE," } });
    expect(input.value).toBe("DOGE,");

    fireEvent.change(input, { target: { value: "DOGE, " } });
    expect(input.value).toBe("DOGE, ");

    fireEvent.change(input, { target: { value: "DOGE, kPEPE" } });
    expect(input.value).toBe("DOGE, kPEPE");

    fireEvent.change(input, { target: { value: "DOGE, kPEPE, kSHIB" } });
    expect(input.value).toBe("DOGE, kPEPE, kSHIB");

    // ...and the committed model is clean (no empty tail).
    expect(screen.getByTestId("parsed").textContent).toBe(
      JSON.stringify(["DOGE", "kPEPE", "kSHIB"]),
    );
  });

  it("seeds the draft from initial values", () => {
    render(<Harness initial={["DOGE", "kPEPE"]} />);
    const input = screen.getByPlaceholderText("set") as HTMLInputElement;
    expect(input.value).toBe("DOGE, kPEPE");
  });

  it("re-syncs the draft when values change externally (revert)", () => {
    function RevertHarness() {
      const [values, setValues] = useState<string[]>(["DOGE", "kPEPE"]);
      return (
        <>
          <SetInput values={values} onChange={setValues} placeholder="set" />
          <button onClick={() => setValues(["BTC"])}>revert</button>
        </>
      );
    }
    render(<RevertHarness />);
    const input = screen.getByPlaceholderText("set") as HTMLInputElement;
    expect(input.value).toBe("DOGE, kPEPE");

    fireEvent.click(screen.getByText("revert"));
    expect(input.value).toBe("BTC");
  });
});
