import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { TrailerEmbed } from "./TrailerEmbed";

function iframe() {
  return document.querySelector("iframe");
}

it("renders no player until the trailer is opened (SSR and first paint agree)", () => {
  render(<TrailerEmbed videoKey="abc123" label="Watch trailer" title="Dune trailer" />);
  expect(screen.getByRole("button", { name: "Watch trailer" })).toBeInTheDocument();
  expect(iframe()).toBeNull();
});

it("embeds the privacy-enhanced YouTube player on click, with no autoplay", async () => {
  render(<TrailerEmbed videoKey="abc123" label="Watch trailer" title="Dune trailer" />);
  await userEvent.click(screen.getByRole("button", { name: "Watch trailer" }));

  const frame = iframe();
  expect(frame).not.toBeNull();
  // youtube-nocookie.com is the whole point of D-35's "privacy-enhanced": the standard
  // youtube.com embed sets tracking cookies on render, before anyone presses play.
  expect(frame?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123");
  expect(frame?.getAttribute("allow")).not.toContain("autoplay");
  expect(frame?.getAttribute("title")).toBe("Dune trailer");
});

it("percent-encodes the video key rather than interpolating it raw", async () => {
  render(<TrailerEmbed videoKey="a/b?c" label="Watch trailer" title="t" />);
  await userEvent.click(screen.getByRole("button", { name: "Watch trailer" }));
  expect(iframe()?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/a%2Fb%3Fc");
});

it("collapses the player again on a second click", async () => {
  render(<TrailerEmbed videoKey="abc123" label="Watch trailer" title="t" />);
  const button = screen.getByRole("button", { name: "Watch trailer" });
  await userEvent.click(button);
  expect(iframe()).not.toBeNull();
  await userEvent.click(button);
  expect(iframe()).toBeNull();
});

it("marks the toggle pressed while the player is open", async () => {
  render(<TrailerEmbed videoKey="abc123" label="Watch trailer" title="t" />);
  const button = screen.getByRole("button", { name: "Watch trailer" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
});
