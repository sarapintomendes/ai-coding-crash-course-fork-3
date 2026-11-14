import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getInstructorEarnings } from "./analyticsService";

function addPurchase(
  userId: number,
  courseId: number,
  amountPaid: number,
  createdAt = "2026-11-01T10:00:00.000Z"
) {
  return testDb
    .insert(schema.purchases)
    .values({ userId, courseId, amountPaid, country: null, createdAt })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getInstructorEarnings", () => {
    it("sums gross amount paid across the instructor's course purchases", () => {
      addPurchase(base.user.id, base.course.id, 4000);
      addPurchase(base.user.id, base.course.id, 2500);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(6500);
    });

    it("counts only purchases made within the date range", () => {
      addPurchase(base.user.id, base.course.id, 4000, "2026-11-01T10:00:00.000Z");
      addPurchase(base.user.id, base.course.id, 9999, "2026-09-01T10:00:00.000Z");

      const earnings = getInstructorEarnings(
        base.instructor.id,
        "2026-10-15T00:00:00.000Z",
        "2026-11-14T23:59:59.999Z"
      );

      expect(earnings.total).toBe(4000);
    });

    it("separates team/coupon purchases from direct sales", () => {
      addPurchase(base.user.id, base.course.id, 4000);
      const teamPurchase = addPurchase(base.user.id, base.course.id, 7500);

      const team = testDb
        .insert(schema.teams)
        .values({})
        .returning()
        .get();
      testDb
        .insert(schema.coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "TEAM-SPLIT-1",
          purchaseId: teamPurchase.id,
        })
        .run();

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.direct).toBe(4000);
      expect(earnings.team).toBe(7500);
      expect(earnings.total).toBe(11500);
    });

    it("excludes purchases on other instructors' courses", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course",
          description: "Someone else's course",
          salesCopy: "## Other",
          instructorId: otherInstructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      addPurchase(base.user.id, base.course.id, 4000);
      addPurchase(base.user.id, otherCourse.id, 9999);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(4000);
    });

    it("breaks earnings down per course, including courses with no sales", () => {
      const quietCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Quiet Course",
          slug: "quiet-course",
          description: "No sales yet",
          salesCopy: "## Quiet",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      addPurchase(base.user.id, base.course.id, 4000);

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.byCourse).toEqual([
        {
          courseId: base.course.id,
          title: "Test Course",
          total: 4000,
          team: 0,
          direct: 4000,
        },
        {
          courseId: quietCourse.id,
          title: "Quiet Course",
          total: 0,
          team: 0,
          direct: 0,
        },
      ]);
    });

    it("returns zeros when the instructor has no purchases", () => {
      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(0);
      expect(earnings.team).toBe(0);
      expect(earnings.direct).toBe(0);
    });
  });
});
