import { describe, it, expect } from "vitest";
import { landingPathForRole } from "./landing";
import { UserRole } from "~/db/schema";

describe("landingPathForRole", () => {
  it("sends instructors to the analytics page", () => {
    expect(landingPathForRole(UserRole.Instructor)).toBe("/instructor/analytics");
  });

  it("sends students to the courses page", () => {
    expect(landingPathForRole(UserRole.Student)).toBe("/courses");
  });

  it("sends admins to the courses page", () => {
    expect(landingPathForRole(UserRole.Admin)).toBe("/courses");
  });
});
