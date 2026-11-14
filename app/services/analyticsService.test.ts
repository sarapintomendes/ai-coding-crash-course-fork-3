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

import { getInstructorEarnings, getCourseDrillDown } from "./analyticsService";

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

      const teamSales = testDb
        .insert(schema.teams)
        .values({})
        .returning()
        .get();
      testDb
        .insert(schema.coupons)
        .values({
          teamId: teamSales.id,
          courseId: base.course.id,
          code: "TEAM-SPLIT-1",
          purchaseId: teamPurchase.id,
        })
        .run();

      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.direct).toBe(4000);
      expect(earnings.teamSales).toBe(7500);
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
          teamSales: 0,
          direct: 4000,
        },
        {
          courseId: quietCourse.id,
          title: "Quiet Course",
          total: 0,
          teamSales: 0,
          direct: 0,
        },
      ]);
    });

    it("returns zeros when the instructor has no purchases", () => {
      const earnings = getInstructorEarnings(base.instructor.id, null, null);

      expect(earnings.total).toBe(0);
      expect(earnings.teamSales).toBe(0);
      expect(earnings.direct).toBe(0);
    });
  });

  describe("getCourseDrillDown", () => {
    function addStudent(email: string) {
      return testDb
        .insert(schema.users)
        .values({ name: email, email, role: schema.UserRole.Student })
        .returning()
        .get();
    }

    function addEnrollment(userId: number, courseId: number, enrolledAt: string) {
      testDb
        .insert(schema.enrollments)
        .values({ userId, courseId, enrolledAt })
        .run();
    }

    it("returns null for a course owned by another instructor", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other-instructor@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const drillDown = getCourseDrillDown(
        otherInstructor.id,
        base.course.id
      );

      expect(drillDown).toBeNull();
    });

    it("counts new enrollments per week, Monday to Sunday, for this course only", () => {
      const a = addStudent("a@example.com");
      const b = addStudent("b@example.com");
      const c = addStudent("c@example.com");

      // 2026-11-02 is a Monday; 2026-11-08 is the Sunday of the same week.
      addEnrollment(a.id, base.course.id, "2026-11-02T09:00:00.000Z");
      addEnrollment(b.id, base.course.id, "2026-11-08T23:00:00.000Z");
      // The following Monday starts a new week.
      addEnrollment(c.id, base.course.id, "2026-11-09T08:00:00.000Z");
      // Another course's enrollments must not leak in.
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course-drill",
          description: "Someone else's course",
          salesCopy: "## Other",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      addEnrollment(a.id, otherCourse.id, "2026-11-03T09:00:00.000Z");

      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown?.enrollmentCount).toBe(3);
      expect(drillDown?.weeklyEnrollments).toEqual([
        { weekStart: "2026-11-02", count: 2 },
        { weekStart: "2026-11-09", count: 1 },
      ]);
    });

    it("reports the average rating and the number of ratings", () => {
      const a = addStudent("rate-a@example.com");
      const b = addStudent("rate-b@example.com");
      testDb
        .insert(schema.courseRatings)
        .values([
          { userId: a.id, courseId: base.course.id, rating: 4 },
          { userId: b.id, courseId: base.course.id, rating: 5 },
        ])
        .run();

      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown?.rating).toEqual({ average: 4.5, count: 2 });
    });

    it("returns an empty state when the course has no ratings or enrollments", () => {
      const drillDown = getCourseDrillDown(base.instructor.id, base.course.id);

      expect(drillDown).toEqual({
        courseId: base.course.id,
        title: "Test Course",
        enrollmentCount: 0,
        rating: { average: null, count: 0 },
        weeklyEnrollments: [],
      });
    });
  });
});
