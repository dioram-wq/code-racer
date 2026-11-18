import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, readPort } from "./port.js";

describe("readPort", () => {
  it("defaults when PORT is missing or empty", () => {
    expect(DEFAULT_PORT).toBe(3001);
    expect(readPort(undefined)).toBe(3001);
    expect(readPort("")).toBe(3001);
  });

  it("accepts an integer from 0 to 65535", () => {
    expect(readPort("0")).toBe(0);
    expect(readPort("3001")).toBe(3001);
    expect(readPort("65535")).toBe(65535);
  });

  it("rejects values that are not a usable port", () => {
    expect(() => readPort("nope")).toThrow(Error);
    expect(() => readPort("-1")).toThrow(/PORT must be an integer/);
    expect(() => readPort("1.5")).toThrow(/PORT must be an integer/);
    expect(() => readPort("65536")).toThrow(/PORT must be an integer/);
    expect(() => readPort(" 3001")).toThrow(/PORT must be an integer/);
  });
});
