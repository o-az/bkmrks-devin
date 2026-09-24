import { describe, expect, it } from "vitest";
import { parseCookieInput, validCredentials } from "../src/lib/credentials";

const token = "0123456789abcdef0123456789abcdef01234567";
const ct0 = "f".repeat(64);

describe("parseCookieInput", () => {
  it("extracts both values from a pasted cookie header", () => {
    expect(parseCookieInput(`guest_id=1; auth_token=${token}; ct0=${ct0}; lang=en`, "")).toEqual({ authToken: token, ct0 });
  });

  it("passes raw values through trimmed", () => {
    expect(parseCookieInput(` ${token} `, `${ct0}\n`)).toEqual({ authToken: token, ct0 });
  });

  it("validates", () => {
    expect(validCredentials({ authToken: token, ct0 })).toBeNull();
    expect(validCredentials({ authToken: "short", ct0 })).toMatch(/auth_token/);
    expect(validCredentials({ authToken: token, ct0: token })).toMatch(/different/);
  });
});
