import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutcomeReceipt, TypingBubble } from "@/components/WorkSignal";

describe("ask loading signals", () => {
  it("announces live work as a typing bubble with three dots", () => {
    const { container } = render(
      <TypingBubble label="Jentera is working on this…" />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Jentera is working on this…",
    );
    expect(container.querySelectorAll(".typing i")).toHaveLength(3);
  });

  it("turns completed work into an actionable evidence receipt", () => {
    const openActivity = vi.fn();
    render(
      <OutcomeReceipt
        title="Work complete"
        outcome="Prepared the weekly update."
        audience="Private workspace"
        evidence="Used 3 confirmed business facts"
        statusLabel="Done"
        actionLabel="View in Activity"
        onAction={openActivity}
      />,
    );

    expect(
      screen.getByText("Used 3 confirmed business facts"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View in Activity" }));
    expect(openActivity).toHaveBeenCalledOnce();
  });
});
