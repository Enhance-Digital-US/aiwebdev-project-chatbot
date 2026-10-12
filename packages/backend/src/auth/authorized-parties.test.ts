import { describe, expect, it } from "vitest";
import { parseAuthorizedParties } from "./authorized-parties";

describe("parseAuthorizedParties", () => {
  it("returns [] when unset or blank", () => {
    expect(parseAuthorizedParties(undefined)).toEqual([]);
    expect(parseAuthorizedParties("")).toEqual([]);
    expect(parseAuthorizedParties(" , ,")).toEqual([]);
  });

  it("parses a single origin", () => {
    expect(parseAuthorizedParties("https://chatbot.course-projects.ai-web.dev")).toEqual([
      "https://chatbot.course-projects.ai-web.dev",
    ]);
  });

  it("splits on commas and trims whitespace", () => {
    expect(
      parseAuthorizedParties(" https://chatbot.course-projects.ai-web.dev , http://localhost:5173 ")
    ).toEqual(["https://chatbot.course-projects.ai-web.dev", "http://localhost:5173"]);
  });

  it("normalizes trailing slashes, paths, and host casing to the bare origin", () => {
    expect(parseAuthorizedParties("https://Chatbot.Course-Projects.ai-web.dev/")).toEqual([
      "https://chatbot.course-projects.ai-web.dev",
    ]);
    expect(parseAuthorizedParties("http://localhost:5173/some/path")).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("drops default ports and de-duplicates", () => {
    expect(
      parseAuthorizedParties("https://a.example:443,https://a.example,https://a.example/")
    ).toEqual(["https://a.example"]);
  });

  it("throws on entries that are not absolute http(s) URLs", () => {
    expect(() => parseAuthorizedParties("chatbot.course-projects.ai-web.dev")).toThrow();
    expect(() => parseAuthorizedParties("mailto:someone@example.com")).toThrow(
      /not an http\(s\) origin/
    );
  });
});
