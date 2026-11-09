import { describe, expect, it } from "vitest";
import { accountInitials } from "./initials";

describe("accountInitials", () => {
  it("takes the first and last word of a full name", () => {
    expect(accountInitials("Tom Boone")).toBe("TB");
  });

  /** A middle name must not displace the surname — the last word is the one people expect. */
  it("skips middle names rather than taking the first two words", () => {
    expect(accountInitials("Mary Jane Watson")).toBe("MW");
  });

  it("gives a single letter for a single word", () => {
    expect(accountInitials("Tom")).toBe("T");
  });

  it("uppercases a lowercase name", () => {
    expect(accountInitials("tom boone")).toBe("TB");
  });

  it("ignores stray whitespace", () => {
    expect(accountInitials("  Tom   Boone  ")).toBe("TB");
  });

  // `display_name` defaults to the address on a fresh account, so this is a common input.
  it("handles a name that is really an email address", () => {
    expect(accountInitials("tom@tomboone.com")).toBe("T");
  });

  describe("falling back to the email", () => {
    it("uses the local part when the name is blank", () => {
      expect(accountInitials("", "tom@tomboone.com")).toBe("T");
    });

    it("uses it when the name is only whitespace", () => {
      expect(accountInitials("   ", "tom@tomboone.com")).toBe("T");
    });

    it("uses it when the name is missing entirely", () => {
      expect(accountInitials(null, "tom@tomboone.com")).toBe("T");
      expect(accountInitials(undefined, "tom@tomboone.com")).toBe("T");
    });

    /** An address beginning with punctuation would otherwise give an avatar reading ".". */
    it("skips leading punctuation to find a real character", () => {
      expect(accountInitials("", ".hidden@example.com")).toBe("H");
    });

    it("accepts a digit when that is what the address starts with", () => {
      expect(accountInitials("", "7bridges@example.com")).toBe("7");
    });
  });

  it("falls back to a placeholder when there is nothing to work with", () => {
    expect(accountInitials("", "")).toBe("?");
    expect(accountInitials(null, null)).toBe("?");
  });

  /** `charAt(0)` would return half a surrogate pair here and render as a broken glyph. */
  it("keeps an astral first character whole", () => {
    expect(accountInitials("𝐓om Boone")).toBe("𝐓B");
  });

  it("handles a non-Latin name", () => {
    expect(accountInitials("Ольга Иванова")).toBe("ОИ");
  });
});
